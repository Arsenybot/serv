export type ProjectStatus = 'LIVE' | 'BUILDING' | 'FAILED' | 'STOPPED' | 'CRASHED';

export type DeploymentStatus =
  | 'QUEUED'
  | 'BUILDING'
  | 'STARTING'
  | 'HEALTH_CHECK'
  | 'LIVE'
  | 'BUILD_FAILED'
  | 'START_FAILED'
  | 'HEALTH_CHECK_FAILED'
  | 'CANCELLED';

export type BuildType = 'DOCKERFILE' | 'NODEJS' | 'PYTHON' | 'STATIC';

export interface Project {
  id: string;
  name: string;
  slug: string;
  repositoryUrl: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  buildType: BuildType;
  dockerfilePath: string;
  buildCommand?: string;
  startCommand?: string;
  internalPort: number;
  status: ProjectStatus;
  currentDeploymentId?: string;
  autoDeploy: boolean;
  cpuLimit: string;
  memoryLimit: string;
  healthPath: string;
  healthTimeout: number;
  healthInterval: number;
  healthRetries: number;
  domain: string;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  commitSha: string;
  commitMessage: string;
  author?: string;
  status: DeploymentStatus;
  startedAt: string;
  finishedAt?: string;
  imageName?: string;
  containerId?: string;
  hostPort?: number;
  traefikServiceName?: string;
  verificationRouterName?: string;
  verificationHost?: string;
  errorMessage?: string;
  healthPassed?: boolean;
}


export interface EnvironmentVariable {
  id: string;
  projectId: string;
  key: string;
  encryptedValue: string;
  maskedValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentLog {
  id: string;
  deploymentId: string;
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'build' | 'system';
  message: string;
}

export interface ProjectStats {
  projectId: string;
  cpuPercent: number;
  memoryMb: number;
  memoryLimitMb: number;
  networkRxKb: number;
  networkTxKb: number;
  restartCount: number;
  uptimeSeconds: number;
  containerStatus: string;
}

export interface WebhookEventPayload {
  ref?: string;
  after?: string;
  head_commit?: {
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
  };
  repository?: {
    name: string;
    full_name: string;
    clone_url: string;
    html_url: string;
    owner?: {
      name?: string;
      login?: string;
    };
  };
}
