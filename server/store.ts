import { EventEmitter } from 'events';
import crypto from 'crypto';
import { Project, Deployment, DeploymentLog, EnvironmentVariable, ProjectStats, type BuildType } from './types.ts';
import { encryptValue, maskValue, slugify } from './crypto.ts';

class PaasStore extends EventEmitter {
  private projects: Map<string, Project> = new Map();
  private deployments: Map<string, Deployment> = new Map();
  private logs: Map<string, DeploymentLog[]> = new Map(); // deploymentId -> logs
  private envVars: Map<string, EnvironmentVariable[]> = new Map(); // projectId -> envs
  private stats: Map<string, ProjectStats> = new Map();
  private webhookProcessedIds: Set<string> = new Set(); // idempotency

  constructor() {
    super();
    this.seedInitialData();
  }

  private seedInitialData() {
    const demoId = 'proj-demo-node-01';
    const slug = 'demo-node-app';
    const traefikDomain = process.env.TRAEFIK_DOMAIN || 'localhost';

    const demoProject: Project = {
      id: demoId,
      name: 'Demo Node App',
      slug: slug,
      repositoryUrl: 'https://github.com/my-account/demo-node-app',
      repositoryOwner: 'my-account',
      repositoryName: 'demo-node-app',
      branch: 'main',
      buildType: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
      internalPort: 8080,
      status: 'LIVE',
      currentDeploymentId: 'dep-demo-init',
      autoDeploy: true,
      cpuLimit: '1',
      memoryLimit: '512m',
      healthPath: '/health',
      healthTimeout: 5,
      healthInterval: 3,
      healthRetries: 10,
      domain: `${slug}.${traefikDomain}`,
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    };

    this.projects.set(demoId, demoProject);

    const initialDeployment: Deployment = {
      id: 'dep-demo-init',
      projectId: demoId,
      commitSha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
      commitMessage: 'feat: initial production release with /health readiness check',
      author: 'LocalPaaS Admin',
      status: 'LIVE',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      finishedAt: new Date(Date.now() - 3550000).toISOString(),
      imageName: `local-paas/${slug}:a1b2c3d`,
      containerId: `project-${slug}-a1b2c3d`,
      hostPort: 9001,
      healthPassed: true,
    };

    this.deployments.set(initialDeployment.id, initialDeployment);

    // Initial logs for the demo deployment
    const initialLogs: DeploymentLog[] = [
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3590000).toISOString(), stream: 'build', message: 'Pulling base image node:20-alpine...' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3585000).toISOString(), stream: 'build', message: 'Step 1/5 : WORKDIR /app' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3580000).toISOString(), stream: 'build', message: 'Step 2/5 : COPY package*.json ./' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3575000).toISOString(), stream: 'build', message: 'Step 3/5 : RUN npm install --omit=dev' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3570000).toISOString(), stream: 'build', message: 'Step 4/5 : COPY . .' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3565000).toISOString(), stream: 'build', message: 'Step 5/5 : EXPOSE 8080' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3560000).toISOString(), stream: 'build', message: `Successfully tagged local-paas/${slug}:a1b2c3d` },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3555000).toISOString(), stream: 'system', message: 'Starting container project-demo-node-app-a1b2c3d...' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3553000).toISOString(), stream: 'system', message: 'Executing health check HTTP GET http://localhost:9001/health...' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3551000).toISOString(), stream: 'system', message: 'Health check OK (status: 200). Traefik route updated to container project-demo-node-app-a1b2c3d.' },
      { id: crypto.randomUUID(), deploymentId: initialDeployment.id, timestamp: new Date(Date.now() - 3550000).toISOString(), stream: 'stdout', message: 'Demo Node Server listening on port 8080 (Ready)' },
    ];
    this.logs.set(initialDeployment.id, initialLogs);

    // Initial env vars
    const envVars: EnvironmentVariable[] = [
      {
        id: crypto.randomUUID(),
        projectId: demoId,
        key: 'NODE_ENV',
        encryptedValue: encryptValue('production'),
        maskedValue: maskValue('production'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        projectId: demoId,
        key: 'PORT',
        encryptedValue: encryptValue('8080'),
        maskedValue: maskValue('8080'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        projectId: demoId,
        key: 'DATABASE_URL',
        encryptedValue: encryptValue('postgres://demo_user:secretpass@postgres:5432/demodb'),
        maskedValue: maskValue('postgres://demo_user:secretpass@postgres:5432/demodb'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    this.envVars.set(demoId, envVars);

    // Initial stats
    this.stats.set(demoId, {
      projectId: demoId,
      cpuPercent: 2.4,
      memoryMb: 48.6,
      memoryLimitMb: 512,
      networkRxKb: 1420.5,
      networkTxKb: 3890.2,
      restartCount: 0,
      uptimeSeconds: 3550,
      containerStatus: 'running',
    });
  }

  // Idempotency check for GitHub push webhook
  public isWebhookProcessed(eventKey: string): boolean {
    return this.webhookProcessedIds.has(eventKey);
  }

  public markWebhookProcessed(eventKey: string) {
    this.webhookProcessedIds.add(eventKey);
    // Keep size bounded to last 10,000 events
    if (this.webhookProcessedIds.size > 10000) {
      const first = Array.from(this.webhookProcessedIds)[0];
      this.webhookProcessedIds.delete(first);
    }
  }

  // Projects
  public getProjects(): Project[] {
    return Array.from(this.projects.values()).sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  public getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  public getProjectByName(name: string): Project | undefined {
    return Array.from(this.projects.values()).find(
      p => p.name.toLowerCase() === name.toLowerCase() || p.slug === slugify(name)
    );
  }

  public getProjectByRepo(owner: string, repo: string): Project | undefined {
    return Array.from(this.projects.values()).find(
      p => p.repositoryOwner.toLowerCase() === owner.toLowerCase() && 
           p.repositoryName.toLowerCase() === repo.toLowerCase()
    );
  }

  public createProject(data: {
    name: string;
    repositoryUrl: string;
    branch?: string;
    buildType?: BuildType;
    dockerfilePath?: string;
    buildCommand?: string;
    startCommand?: string;
    internalPort?: number;
    healthPath?: string;
    domain?: string;
    autoDeploy?: boolean;
    cpuLimit?: string;
    memoryLimit?: string;
  }): Project {
    const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
    const slug = slugify(data.name);
    
    // Extract owner and repo from URL if present
    let repositoryOwner = 'unknown';
    let repositoryName = slug;
    try {
      const url = new URL(data.repositoryUrl.replace(/\.git$/, ''));
      const parts = url.pathname.replace(/^\//, '').split('/');
      if (parts.length >= 2) {
        repositoryOwner = parts[0];
        repositoryName = parts[1];
      }
    } catch {
      const parts = data.repositoryUrl.replace(/\.git$/, '').split(/[:/]/);
      if (parts.length >= 2) {
        repositoryOwner = parts[parts.length - 2];
        repositoryName = parts[parts.length - 1];
      }
    }

    const traefikDomain = process.env.TRAEFIK_DOMAIN || 'localhost';
    const projectDomain = data.domain || `${slug}.${traefikDomain}`;

    const project: Project = {
      id,
      name: data.name,
      slug,
      repositoryUrl: data.repositoryUrl,
      repositoryOwner,
      repositoryName,
      branch: data.branch || 'main',
      buildType: data.buildType || 'DOCKERFILE',
      dockerfilePath: data.dockerfilePath || 'Dockerfile',
      buildCommand: data.buildCommand,
      startCommand: data.startCommand,
      internalPort: data.internalPort || 3000,
      status: 'STOPPED',
      autoDeploy: data.autoDeploy ?? true,
      cpuLimit: data.cpuLimit || process.env.DEFAULT_CPU_LIMIT || '1',
      memoryLimit: data.memoryLimit || process.env.DEFAULT_MEMORY_LIMIT || '512m',
      healthPath: data.healthPath || '/health',
      healthTimeout: 5,
      healthInterval: 3,
      healthRetries: 10,
      domain: projectDomain,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.projects.set(id, project);
    this.emit('project_updated', project);
    return project;
  }

  public updateProject(id: string, updates: Partial<Project>): Project | undefined {
    const existing = this.projects.get(id);
    if (!existing) return undefined;

    const updated: Project = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.projects.set(id, updated);
    this.emit('project_updated', updated);
    return updated;
  }

  public deleteProject(id: string): boolean {
    const project = this.projects.get(id);
    if (!project) return false;

    // Remove all associated deployments, logs, env vars, stats
    const projectDeployments = this.getDeploymentsForProject(id);
    for (const dep of projectDeployments) {
      this.deployments.delete(dep.id);
      this.logs.delete(dep.id);
    }
    this.envVars.delete(id);
    this.stats.delete(id);
    this.projects.delete(id);

    this.emit('project_deleted', id);
    return true;
  }

  // Deployments
  public getDeploymentsForProject(projectId: string): Deployment[] {
    return Array.from(this.deployments.values())
      .filter(d => d.projectId === projectId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  public getDeployment(id: string): Deployment | undefined {
    return this.deployments.get(id);
  }

  public createDeployment(projectId: string, commitSha: string, commitMessage: string, author?: string): Deployment {
    const id = `dep-${crypto.randomUUID().slice(0, 8)}`;
    const deployment: Deployment = {
      id,
      projectId,
      commitSha,
      commitMessage,
      author: author || 'LocalPaaS Webhook',
      status: 'QUEUED',
      startedAt: new Date().toISOString(),
    };

    this.deployments.set(id, deployment);
    this.logs.set(id, []);
    
    // Update project state to BUILDING
    this.updateProject(projectId, { status: 'BUILDING' });
    this.emit('deployment_created', deployment);
    return deployment;
  }

  public updateDeployment(id: string, updates: Partial<Deployment>): Deployment | undefined {
    const existing = this.deployments.get(id);
    if (!existing) return undefined;

    const updated: Deployment = {
      ...existing,
      ...updates,
    };

    if (['LIVE', 'BUILD_FAILED', 'START_FAILED', 'HEALTH_CHECK_FAILED', 'CANCELLED'].includes(updated.status)) {
      if (!updated.finishedAt) {
        updated.finishedAt = new Date().toISOString();
      }
    }

    this.deployments.set(id, updated);
    this.emit('deployment_updated', updated);

    // If status became LIVE, mark project LIVE and set currentDeploymentId
    if (updated.status === 'LIVE') {
      this.updateProject(updated.projectId, {
        status: 'LIVE',
        currentDeploymentId: updated.id,
      });
    } else if (['BUILD_FAILED', 'START_FAILED', 'HEALTH_CHECK_FAILED', 'CANCELLED'].includes(updated.status)) {
      const project = this.getProject(updated.projectId);
      // Zero-downtime safety: if there's already a current active deployment that is LIVE,
      // restore project status back to LIVE because the old container is still running!
      if (project?.currentDeploymentId) {
        const currentDep = this.getDeployment(project.currentDeploymentId);
        if (currentDep && currentDep.status === 'LIVE') {
          this.updateProject(updated.projectId, { status: 'LIVE' });
        } else {
          this.updateProject(updated.projectId, { status: 'FAILED' });
        }
      } else {
        this.updateProject(updated.projectId, { status: 'FAILED' });
      }
    }

    return updated;
  }

  // Logs
  public addLog(deploymentId: string, stream: 'stdout' | 'stderr' | 'build' | 'system', message: string): DeploymentLog {
    const log: DeploymentLog = {
      id: crypto.randomUUID(),
      deploymentId,
      timestamp: new Date().toISOString(),
      stream,
      message,
    };

    let logList = this.logs.get(deploymentId);
    if (!logList) {
      logList = [];
      this.logs.set(deploymentId, logList);
    }
    logList.push(log);

    // Bound memory to last 5,000 log lines per deployment
    if (logList.length > 5000) {
      logList.shift();
    }

    this.emit('log_added', log);
    return log;
  }

  public getLogs(deploymentId: string): DeploymentLog[] {
    return this.logs.get(deploymentId) || [];
  }

  // Environment Variables
  public getEnvVars(projectId: string): EnvironmentVariable[] {
    return this.envVars.get(projectId) || [];
  }

  public setEnvVar(projectId: string, key: string, value: string): EnvironmentVariable {
    let list = this.envVars.get(projectId);
    if (!list) {
      list = [];
      this.envVars.set(projectId, list);
    }

    const encryptedValue = encryptValue(value);
    const masked = maskValue(value);

    const existingIndex = list.findIndex(e => e.key === key);
    if (existingIndex >= 0) {
      list[existingIndex] = {
        ...list[existingIndex],
        encryptedValue,
        maskedValue: masked,
        updatedAt: new Date().toISOString(),
      };
      return list[existingIndex];
    } else {
      const item: EnvironmentVariable = {
        id: crypto.randomUUID(),
        projectId,
        key,
        encryptedValue,
        maskedValue: masked,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(item);
      return item;
    }
  }

  public deleteEnvVar(projectId: string, key: string): boolean {
    const list = this.envVars.get(projectId);
    if (!list) return false;
    const initialLen = list.length;
    const filtered = list.filter(e => e.key !== key);
    this.envVars.set(projectId, filtered);
    return filtered.length < initialLen;
  }

  // Stats
  public getStats(projectId: string): ProjectStats {
    const existing = this.stats.get(projectId);
    if (existing) return existing;

    const defaultStats: ProjectStats = {
      projectId,
      cpuPercent: 0,
      memoryMb: 0,
      memoryLimitMb: 512,
      networkRxKb: 0,
      networkTxKb: 0,
      restartCount: 0,
      uptimeSeconds: 0,
      containerStatus: 'stopped',
    };
    this.stats.set(projectId, defaultStats);
    return defaultStats;
  }

  public updateStats(projectId: string, updates: Partial<ProjectStats>) {
    const current = this.getStats(projectId);
    const updated = { ...current, ...updates };
    this.stats.set(projectId, updated);
    this.emit('stats_updated', updated);
  }
}

export const paasStore = new PaasStore();
