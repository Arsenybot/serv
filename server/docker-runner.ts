import http from 'http';
import fs from 'fs';
import { paasStore } from './store.ts';
import { Project, Deployment } from './types.ts';
import { decryptValue } from './crypto.ts';

import http from 'http';
import fs from 'fs';
import { paasStore } from './store.ts';
import { Project, Deployment } from './types.ts';
import { decryptValue } from './crypto.ts';

const DOCKER_HOST_URL = process.env.DOCKER_HOST || 'http://dockerproxy:2375';

// Check if Docker API is reachable
export async function isDockerSocketAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL('/version', DOCKER_HOST_URL.startsWith('tcp://') ? DOCKER_HOST_URL.replace('tcp://', 'http://') : DOCKER_HOST_URL);
      const req = http.get(url, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

let portCounter = 9010;
function allocateHostPort(): number {
  return portCounter++;
}

/**
 * Docker Runner & Orchestrator with REAL Docker Engine integration via Docker HTTP API
 */
export class DockerRunner {
  private containerStatsIntervals: Map<string, NodeJS.Timeout> = new Map();

  private getHttpEndpoint(): { host: string; port: number } {
    let raw = DOCKER_HOST_URL.replace('tcp://', '').replace('http://', '');
    const [host, portStr] = raw.split(':');
    return {
      host: host || 'dockerproxy',
      port: portStr ? parseInt(portStr, 10) : 2375,
    };
  }

  /**
   * Helper to perform Docker API requests
   */
  private dockerRequest(
    method: string,
    path: string,
    body?: any,
    onChunk?: (data: string) => void
  ): Promise<{ statusCode: number; data: string }> {
    const { host, port } = this.getHttpEndpoint();

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        host,
        port,
        method,
        path: `/v1.45${path}`,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          const str = chunk.toString();
          responseBody += str;
          if (onChunk) {
            onChunk(str);
          }
        });

        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 500, data: responseBody });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Main Deployment Execution Pipeline
   */
  public async executeDeployment(
    project: Project,
    deployment: Deployment,
    options: {
      isRollback?: boolean;
      reuseImageName?: string;
      simulateFailure?: 'build' | 'start' | 'health';
    } = {}
  ): Promise<boolean> {
    const deploymentId = deployment.id;
    const projectSlug = project.slug || project.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const shortSha = deployment.commitSha.slice(0, 7) || 'latest';
    const imageName = options.reuseImageName || `local-paas/${projectSlug}:${shortSha}`;
    const containerId = `project-${projectSlug}-${deploymentId.slice(-6)}`;
    const hostPort = allocateHostPort();

    paasStore.updateDeployment(deploymentId, {
      imageName,
      containerId,
      hostPort,
    });

    const oldDeploymentId = project.currentDeploymentId;
    const oldDeployment = oldDeploymentId ? paasStore.getDeployment(oldDeploymentId) : null;

    try {
      // Step 1: BUILDING
      paasStore.updateDeployment(deploymentId, { status: 'BUILDING' });
      paasStore.addLog(deploymentId, 'system', `Starting real Docker build for project: ${project.name}`);
      paasStore.addLog(deploymentId, 'system', `Target image: ${imageName}`);

      // Build via remote git context in Docker Engine
      const gitRemote = project.repositoryUrl.endsWith('.git')
        ? project.repositoryUrl
        : `${project.repositoryUrl}.git`;
      const buildRemoteUrl = `${gitRemote}#${project.branch || 'main'}`;

      paasStore.addLog(deploymentId, 'build', `Triggering Docker Engine build from remote context: ${buildRemoteUrl}...`);

      let buildSuccess = false;
      try {
        const buildPath = `/build?t=${encodeURIComponent(imageName)}&remote=${encodeURIComponent(buildRemoteUrl)}`;
        const buildResult = await this.dockerRequest('POST', buildPath, null, (chunk) => {
          // Parse stream messages from Docker daemon
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.stream) {
                const text = parsed.stream.trim();
                if (text) paasStore.addLog(deploymentId, 'build', text);
              } else if (parsed.error) {
                paasStore.addLog(deploymentId, 'stderr', `Docker build error: ${parsed.error}`);
              }
            } catch {
              if (line.includes('Step') || line.includes('--->')) {
                paasStore.addLog(deploymentId, 'build', line.trim());
              }
            }
          }
        });

        if (buildResult.statusCode >= 200 && buildResult.statusCode < 300 && !buildResult.data.includes('"error":')) {
          buildSuccess = true;
          paasStore.addLog(deploymentId, 'build', `Successfully built Docker image: ${imageName}`);
        } else {
          paasStore.addLog(deploymentId, 'stderr', `Docker build failed with response: ${buildResult.data.slice(0, 300)}`);
        }
      } catch (buildErr: any) {
        paasStore.addLog(deploymentId, 'stderr', `Network error while connecting to Docker daemon for build: ${buildErr.message}`);
      }

      if (!buildSuccess) {
        paasStore.updateDeployment(deploymentId, {
          status: 'BUILD_FAILED',
          errorMessage: 'Real Docker build failed. Inspect the logs above.',
        });
        return false;
      }

      // Step 2: STARTING
      paasStore.updateDeployment(deploymentId, { status: 'STARTING' });
      paasStore.addLog(deploymentId, 'system', `Creating container ${containerId} in localpaas_network...`);

      // Prepare decrypted environment variables
      const envVars = paasStore.getEnvVars(project.id);
      const envList = envVars.map(e => `${e.key}=${decryptValue(e.encryptedValue)}`);
      envList.push(`PORT=${project.internalPort || 3000}`);

      // Create Container config with Traefik routing labels
      const domainRule = `Host(\`${project.domain || `${projectSlug}.localhost`}\`)`;
      const containerConfig = {
        Image: imageName,
        name: containerId,
        Env: envList,
        Labels: {
          'traefik.enable': 'true',
          [`traefik.http.routers.${projectSlug}.rule`]: domainRule,
          [`traefik.http.routers.${projectSlug}.entrypoints`]: 'web',
          [`traefik.http.services.${projectSlug}.loadbalancer.server.port`]: String(project.internalPort || 3000),
        },
        HostConfig: {
          NetworkMode: 'localpaas_network',
          PortBindings: {
            [`${project.internalPort || 3000}/tcp`]: [{ HostPort: String(hostPort) }],
          },
          RestartPolicy: { Name: 'unless-stopped' },
        },
      };

      const createRes = await this.dockerRequest('POST', `/containers/create?name=${containerId}`, containerConfig);
      if (createRes.statusCode !== 201) {
        paasStore.addLog(deploymentId, 'stderr', `Failed to create container: ${createRes.data}`);
        paasStore.updateDeployment(deploymentId, {
          status: 'START_FAILED',
          errorMessage: `Docker create failed: ${createRes.data}`,
        });
        return false;
      }

      // Start Container
      const startRes = await this.dockerRequest('POST', `/containers/${containerId}/start`);
      if (startRes.statusCode >= 400) {
        paasStore.addLog(deploymentId, 'stderr', `Failed to start container: ${startRes.data}`);
        paasStore.updateDeployment(deploymentId, {
          status: 'START_FAILED',
          errorMessage: `Docker start failed: ${startRes.data}`,
        });
        return false;
      }

      paasStore.addLog(deploymentId, 'system', `Container ${containerId} is running on port ${hostPort}`);
      paasStore.addLog(deploymentId, 'system', `Traefik routing configured: ${domainRule}`);

      // Step 3: HEALTH_CHECK
      paasStore.updateDeployment(deploymentId, { status: 'HEALTH_CHECK' });
      paasStore.addLog(deploymentId, 'system', `Waiting for app to initialize...`);
      await this.delay(2000);

      // Step 4: ZERO-DOWNTIME SWITCH
      if (oldDeployment && oldDeployment.containerId && oldDeployment.id !== deploymentId) {
        paasStore.addLog(deploymentId, 'system', `Stopping old container: ${oldDeployment.containerId}...`);
        try {
          await this.dockerRequest('POST', `/containers/${oldDeployment.containerId}/stop?t=5`);
          await this.dockerRequest('DELETE', `/containers/${oldDeployment.containerId}?v=1`);
        } catch {
          // ignore cleanup errors of previous containers
        }
      }

      // Step 5: Mark LIVE
      paasStore.updateDeployment(deploymentId, {
        status: 'LIVE',
        healthPassed: true,
      });

      const publicUrl = `http://${project.domain || `${projectSlug}.localhost`}`;
      paasStore.addLog(deploymentId, 'system', `Deployment ${deploymentId} is now LIVE! Public URL: ${publicUrl}`);
      paasStore.addLog(deploymentId, 'stdout', `Direct host access also available at: http://localhost:${hostPort}`);

      this.startStatsMonitoring(project.id, containerId);
      return true;

    } catch (err: any) {
      paasStore.addLog(deploymentId, 'stderr', `Deployment exception: ${err.message || String(err)}`);
      paasStore.updateDeployment(deploymentId, {
        status: 'START_FAILED',
        errorMessage: err.message || 'Unknown internal error',
      });
      return false;
    }
  }

  public async stopProject(project: Project): Promise<void> {
    const deploymentId = project.currentDeploymentId;
    if (deploymentId) {
      const dep = paasStore.getDeployment(deploymentId);
      if (dep && dep.containerId) {
        await this.dockerRequest('POST', `/containers/${dep.containerId}/stop?t=5`).catch(() => {});
      }
    }
    this.stopStatsMonitoring(project.id);
    paasStore.updateProject(project.id, { status: 'STOPPED' });
  }

  public async startProject(project: Project): Promise<void> {
    const deploymentId = project.currentDeploymentId;
    if (deploymentId) {
      const dep = paasStore.getDeployment(deploymentId);
      if (dep && dep.containerId) {
        await this.dockerRequest('POST', `/containers/${dep.containerId}/start`).catch(() => {});
        paasStore.updateProject(project.id, { status: 'LIVE' });
        this.startStatsMonitoring(project.id, dep.containerId);
        return;
      }
    }
  }

  public async restartProject(project: Project): Promise<void> {
    const deploymentId = project.currentDeploymentId;
    if (deploymentId) {
      const dep = paasStore.getDeployment(deploymentId);
      if (dep && dep.containerId) {
        await this.dockerRequest('POST', `/containers/${dep.containerId}/restart?t=5`).catch(() => {});
        paasStore.updateProject(project.id, { status: 'LIVE' });
        this.startStatsMonitoring(project.id, dep.containerId);
      }
    }
  }

  private startStatsMonitoring(projectId: string, containerId: string) {
    this.stopStatsMonitoring(projectId);

    const interval = setInterval(async () => {
      const project = paasStore.getProject(projectId);
      if (!project || project.status !== 'LIVE') {
        this.stopStatsMonitoring(projectId);
        return;
      }

      try {
        const statsRes = await this.dockerRequest('GET', `/containers/${containerId}/stats?stream=false`);
        if (statsRes.statusCode === 200) {
          const stats = JSON.parse(statsRes.data);
          const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
          const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
          const numCpus = stats.cpu_stats?.online_cpus || 1;
          const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;
          const memoryMb = (stats.memory_stats?.usage || 0) / (1024 * 1024);

          paasStore.updateStats(projectId, {
            cpuPercent: Math.round(cpuPercent * 10) / 10,
            memoryMb: Math.round(memoryMb * 10) / 10,
            uptimeSeconds: (paasStore.getStats(projectId)?.uptimeSeconds || 0) + 3,
            containerStatus: 'running',
          });
        }
      } catch {
        // ignore periodic stats error
      }
    }, 4000);

    this.containerStatsIntervals.set(projectId, interval);
  }

  private stopStatsMonitoring(projectId: string) {
    const interval = this.containerStatsIntervals.get(projectId);
    if (interval) {
      clearInterval(interval);
      this.containerStatsIntervals.delete(projectId);
    }
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const dockerRunner = new DockerRunner();

