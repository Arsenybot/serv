import { paasStore } from './store.ts';
import { dockerRunner } from './docker-runner.ts';
import { Project, Deployment } from './types.ts';

export interface QueueJob {
  id: string;
  type: 'deploy' | 'rollback' | 'restart' | 'cleanup';
  projectId: string;
  deploymentId?: string;
  rollbackTargetDeploymentId?: string;
  simulateFailure?: 'build' | 'start' | 'health';
  createdAt: number;
}

export class DeploymentQueue {
  private queue: QueueJob[] = [];
  private activeJobsByProject: Map<string, QueueJob> = new Map();
  private isProcessing = false;

  constructor() {
    this.startWorkerLoop();
  }

  /**
   * Enqueue a new deployment job with concurrency lock and coalescing
   */
  public enqueueDeploy(
    projectId: string,
    deploymentId: string,
    options: { simulateFailure?: 'build' | 'start' | 'health' } = {}
  ): QueueJob {
    const job: QueueJob = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'deploy',
      projectId,
      deploymentId,
      simulateFailure: options.simulateFailure,
      createdAt: Date.now(),
    };

    // Coalescing: If there is already a queued (not yet active) deploy job for this project,
    // cancel the older queued deployment to prevent queue bloating!
    const existingQueuedIndex = this.queue.findIndex(
      j => j.projectId === projectId && j.type === 'deploy'
    );

    if (existingQueuedIndex >= 0) {
      const supersededJob = this.queue[existingQueuedIndex];
      if (supersededJob.deploymentId) {
        paasStore.updateDeployment(supersededJob.deploymentId, {
          status: 'CANCELLED',
          errorMessage: 'Superseded by newer incoming commit in queue (coalesced)',
        });
        paasStore.addLog(
          supersededJob.deploymentId,
          'system',
          'Deployment cancelled: a newer commit arrived in the queue before build started.'
        );
      }
      // Replace with new job
      this.queue[existingQueuedIndex] = job;
    } else {
      this.queue.push(job);
    }

    this.processNext();
    return job;
  }

  /**
   * Enqueue a rollback job
   */
  public enqueueRollback(projectId: string, targetDeploymentId: string): QueueJob {
    const target = paasStore.getDeployment(targetDeploymentId);
    if (!target) throw new Error('Target deployment for rollback not found');

    const newDep = paasStore.createDeployment(
      projectId,
      target.commitSha,
      `[ROLLBACK] Revert to deployment ${target.id.slice(-6)} (${target.commitSha.slice(0, 7)})`,
      'LocalPaaS Admin'
    );

    const job: QueueJob = {
      id: `job-rb-${Date.now()}`,
      type: 'rollback',
      projectId,
      deploymentId: newDep.id,
      rollbackTargetDeploymentId: targetDeploymentId,
      createdAt: Date.now(),
    };

    this.queue.push(job);
    this.processNext();
    return job;
  }

  /**
   * Clean up old deployments for a project, respecting retention rules:
   * Retain current active deployment and previous successful deployment!
   */
  public runCleanup(projectId: string) {
    const maxDeployments = parseInt(process.env.MAX_DEPLOYMENTS_PER_PROJECT || '10', 10);
    const deployments = paasStore.getDeploymentsForProject(projectId);
    const project = paasStore.getProject(projectId);

    if (deployments.length <= maxDeployments) return;

    const currentId = project?.currentDeploymentId;
    const successful = deployments.filter(d => d.status === 'LIVE');
    const previousSuccessfulId = successful.find(d => d.id !== currentId)?.id;

    // Prune deployments exceeding limit from the tail (oldest first)
    const candidates = deployments.slice(maxDeployments);
    for (const dep of candidates) {
      // NEVER delete current active deployment or previous successful deployment!
      if (dep.id === currentId || dep.id === previousSuccessfulId) {
        continue;
      }
      // Clean up metadata
      // (in production, docker rmi / docker rm occurs here)
    }
  }

  private startWorkerLoop() {
    setInterval(() => {
      this.processNext();
    }, 500);
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;

    // Find the next job whose project is NOT currently running an active deployment
    const eligibleIndex = this.queue.findIndex(
      job => !this.activeJobsByProject.has(job.projectId)
    );

    if (eligibleIndex === -1) {
      return; // All queued projects have an active job running; wait
    }

    const [job] = this.queue.splice(eligibleIndex, 1);
    this.activeJobsByProject.set(job.projectId, job);

    this.isProcessing = true;
    try {
      await this.executeJob(job);
    } finally {
      this.activeJobsByProject.delete(job.projectId);
      this.isProcessing = false;
      // Trigger cleanup
      this.runCleanup(job.projectId);
      // Check next
      setImmediate(() => this.processNext());
    }
  }

  private async executeJob(job: QueueJob): Promise<void> {
    const project = paasStore.getProject(job.projectId);
    if (!project) return;

    if (job.type === 'deploy') {
      if (!job.deploymentId) return;
      const deployment = paasStore.getDeployment(job.deploymentId);
      if (!deployment) return;

      await dockerRunner.executeDeployment(project, deployment, {
        simulateFailure: job.simulateFailure,
      });
    } else if (job.type === 'rollback') {
      if (!job.deploymentId || !job.rollbackTargetDeploymentId) return;
      const deployment = paasStore.getDeployment(job.deploymentId);
      const targetDeployment = paasStore.getDeployment(job.rollbackTargetDeploymentId);
      if (!deployment || !targetDeployment) return;

      await dockerRunner.executeDeployment(project, deployment, {
        isRollback: true,
        reuseImageName: targetDeployment.imageName,
      });
    }
  }
}

export const deploymentQueue = new DeploymentQueue();
