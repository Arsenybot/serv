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
  errorMessage?: string;
  healthPassed?: boolean;
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

export interface EnvironmentVariable {
  id: string;
  projectId: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStatus {
  dockerAvailable: boolean;
  traefikDomain: string;
  cloudflareActive: boolean;
  githubTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  totalProjects: number;
  liveProjects: number;
  buildingProjects: number;
  failedProjects: number;
  maxDeploymentsLimit: string;
}
