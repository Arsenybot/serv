import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Traefik Dynamic Router Manager
 * Manages the single source of truth for production and verification routing using Traefik's File Provider.
 *
 * Architecture:
 * - Dynamic config directory: /etc/traefik/dynamic (or local fallback in /tmp/traefik_dynamic)
 * - Traefik watches this directory for real-time atomic updates.
 * - Each project has an isolated configuration file: `<projectSlug>.json`
 * - Production router (`<projectSlug>`) explicitly points to EXACTLY ONE deployment service.
 * - Verification router (`<projectSlug>-verify-<depShortId>`) points exclusively to the new deployment's service.
 * - OLD and NEW never share a load-balancing pool.
 */
export class TraefikDynamicManager {
  private dynamicDir: string;
  private inMemoryConfigs: Map<string, any> = new Map();

  constructor() {
    // Prefer Traefik's mounted dynamic directory, fallback to temp dir
    const defaultDynamicDir = '/etc/traefik/dynamic';
    if (fs.existsSync(defaultDynamicDir)) {
      this.dynamicDir = defaultDynamicDir;
    } else {
      const fallbackDir = path.join(os.tmpdir(), 'localpaas_traefik_dynamic');
      try {
        if (!fs.existsSync(fallbackDir)) {
          fs.mkdirSync(fallbackDir, { recursive: true });
        }
      } catch {
        // ignore
      }
      this.dynamicDir = fallbackDir;
    }
  }

  public getDynamicDir(): string {
    return this.dynamicDir;
  }

  private getConfigPath(projectSlug: string): string {
    return path.join(this.dynamicDir, `${projectSlug}.json`);
  }

  /**
   * Reads current configuration for a project from disk or memory
   */
  public getProjectConfig(projectSlug: string): any {
    const memory = this.inMemoryConfigs.get(projectSlug);
    if (memory) {
      return JSON.parse(JSON.stringify(memory));
    }

    const filePath = this.getConfigPath(projectSlug);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.inMemoryConfigs.set(projectSlug, parsed);
        return parsed;
      } catch {
        // ignore
      }
    }

    return {
      http: {
        routers: {},
        services: {},
      },
    };
  }

  /**
   * Writes the project dynamic configuration atomically
   */
  public writeProjectConfig(projectSlug: string, config: any): void {
    this.inMemoryConfigs.set(projectSlug, config);

    try {
      if (!fs.existsSync(this.dynamicDir)) {
        fs.mkdirSync(this.dynamicDir, { recursive: true });
      }

      const filePath = this.getConfigPath(projectSlug);
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (err: any) {
      // If filesystem write fails in restricted/test environment, in-memory copy is preserved
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[TraefikDynamicManager] Could not write dynamic config to ${this.dynamicDir}: ${err.message}`);
      }
    }
  }

  /**
   * Registers a new deployment service and its dedicated verification router.
   * At this stage, the production router is UNTOUCHED and still points to the old deployment (if any).
   */
  public registerDeployment(options: {
    projectSlug: string;
    deploymentId: string;
    containerId: string;
    internalPort: number;
    traefikDomain?: string;
  }): {
    traefikServiceName: string;
    verificationRouterName: string;
    verificationHost: string;
  } {
    const { projectSlug, deploymentId, containerId, internalPort } = options;
    const shortId = deploymentId.replace(/^dep-/, '').slice(0, 8);
    const traefikServiceName = `${projectSlug}-dep-${shortId}`;
    const verificationRouterName = `${projectSlug}-verify-${shortId}`;
    const traefikDomain = options.traefikDomain || process.env.TRAEFIK_DOMAIN || 'localhost';
    const verificationHost = `${projectSlug}-deploy-${shortId}.${traefikDomain}`;

    const config = this.getProjectConfig(projectSlug);

    // 1. Register deployment-specific service pointing ONLY to this container
    config.http.services = config.http.services || {};
    config.http.services[traefikServiceName] = {
      loadBalancer: {
        servers: [{ url: `http://${containerId}:${internalPort}` }],
      },
    };

    // 2. Register deployment-specific verification router pointing ONLY to this service
    config.http.routers = config.http.routers || {};
    config.http.routers[verificationRouterName] = {
      rule: `Host(\`${verificationHost}\`)`,
      entryPoints: ['web'],
      service: traefikServiceName,
    };

    this.writeProjectConfig(projectSlug, config);

    return {
      traefikServiceName,
      verificationRouterName,
      verificationHost,
    };
  }

  /**
   * Atomically switches the production router to point exclusively to the new deployment service.
   */
  public switchProductionRouter(options: {
    projectSlug: string;
    productionDomain: string;
    traefikServiceName: string;
  }): void {
    const { projectSlug, productionDomain, traefikServiceName } = options;
    const config = this.getProjectConfig(projectSlug);

    config.http.routers = config.http.routers || {};
    config.http.routers[projectSlug] = {
      rule: `Host(\`${productionDomain}\`)`,
      entryPoints: ['web'],
      service: traefikServiceName,
    };

    this.writeProjectConfig(projectSlug, config);
  }

  /**
   * Cleans up the verification router after verification and switch are complete.
   */
  public removeVerificationRouter(projectSlug: string, verificationRouterName: string): void {
    const config = this.getProjectConfig(projectSlug);
    if (config.http?.routers?.[verificationRouterName]) {
      delete config.http.routers[verificationRouterName];
      this.writeProjectConfig(projectSlug, config);
    }
  }

  /**
   * Removes a retired deployment service from Traefik
   */
  public removeDeploymentService(projectSlug: string, traefikServiceName: string): void {
    const config = this.getProjectConfig(projectSlug);
    if (config.http?.services?.[traefikServiceName]) {
      delete config.http.services[traefikServiceName];
      this.writeProjectConfig(projectSlug, config);
    }
  }

  /**
   * Completely cleans up project configuration from Traefik
   */
  public cleanupProject(projectSlug: string): void {
    this.inMemoryConfigs.delete(projectSlug);
    const filePath = this.getConfigPath(projectSlug);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  }
}

export const traefikDynamicManager = new TraefikDynamicManager();
