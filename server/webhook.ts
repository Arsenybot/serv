import { Request, Response } from 'express';
import { paasStore } from './store.ts';
import { deploymentQueue } from './queue.ts';
import { verifyGitHubSignature } from './crypto.ts';
import { WebhookEventPayload } from './types.ts';

export function handleGitHubWebhook(req: Request, res: Response) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
  const eventType = req.headers['x-github-event'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string | undefined;

  // 1. Signature validation (if secret is configured)
  if (secret) {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const isValid = verifyGitHubSignature(rawBody, signatureHeader, secret);
    if (!isValid) {
      console.warn(`[Webhook] Invalid HMAC signature for delivery ${deliveryId}`);
      return res.status(401).json({ error: 'Invalid HMAC SHA-256 signature' });
    }
  }

  // Handle ping event (sent by GitHub when webhook is initially created)
  if (eventType === 'ping') {
    return res.status(200).json({ message: 'Pong! Webhook successfully received and verified.' });
  }

  // Only handle push events
  if (eventType && eventType !== 'push') {
    return res.status(200).json({ message: `Ignored non-push event: ${eventType}` });
  }

  const payload = req.body as WebhookEventPayload;
  if (!payload || !payload.repository) {
    return res.status(400).json({ error: 'Malformed webhook payload: missing repository' });
  }

  const repoFullName = payload.repository.full_name || '';
  const [owner, name] = repoFullName.split('/');

  // Find project by repository
  let project = paasStore.getProjectByRepo(owner || '', name || payload.repository.name);
  if (!project) {
    // Try matching by clone URL
    const all = paasStore.getProjects();
    project = all.find(p => 
      p.repositoryUrl.includes(payload.repository?.name || '') ||
      p.slug === payload.repository?.name
    );
  }

  if (!project) {
    return res.status(404).json({
      error: `No registered project found for repository ${repoFullName || payload.repository.name}`,
    });
  }

  if (!project.autoDeploy) {
    return res.status(200).json({
      message: `Project ${project.name} has autoDeploy disabled. Webhook ignored.`,
    });
  }

  // 2. Branch Filtering
  const targetBranch = `refs/heads/${project.branch}`;
  if (payload.ref && payload.ref !== targetBranch) {
    return res.status(200).json({
      message: `Push was to ${payload.ref}, but project is configured for branch ${project.branch}. Ignored.`,
    });
  }

  // Commit info
  const commitSha = payload.head_commit?.id || payload.after || `sha-${Date.now().toString(16)}`;
  const commitMessage = payload.head_commit?.message || 'Update from GitHub push';
  const authorName = payload.head_commit?.author?.name || 'GitHub User';

  // 3. Idempotency Check
  const idempotencyKey = `${project.id}:${commitSha}:${payload.ref || project.branch}`;
  if (paasStore.isWebhookProcessed(idempotencyKey)) {
    return res.status(200).json({
      message: `Commit ${commitSha.slice(0, 7)} already processed for project ${project.name}. Deduplicated.`,
    });
  }
  paasStore.markWebhookProcessed(idempotencyKey);

  // 4. Create deployment record and enqueue
  const deployment = paasStore.createDeployment(project.id, commitSha, commitMessage, authorName);
  const job = deploymentQueue.enqueueDeploy(project.id, deployment.id);

  console.log(`[Webhook] Enqueued deployment ${deployment.id} for project ${project.name} (Commit: ${commitSha.slice(0, 7)})`);

  return res.status(200).json({
    success: true,
    message: `Deployment queued for project ${project.name}`,
    projectId: project.id,
    deploymentId: deployment.id,
    jobId: job.id,
    commitSha: commitSha.slice(0, 7),
  });
}
