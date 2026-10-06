import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { paasStore } from './server/store.ts';
import { dockerRunner, isDockerSocketAvailable } from './server/docker-runner.ts';
import { deploymentQueue } from './server/queue.ts';
import { handleGitHubWebhook } from './server/webhook.ts';
import { checkGitHubRepo, createGitHubWebhook } from './server/github.ts';
import { decryptValue } from './server/crypto.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Body parser with raw body retention for GitHub HMAC signature validation
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Server-Sent Events (SSE) clients for real-time live events and log streaming
const sseClients: Set<Response> = new Set();

function broadcastEvent(type: string, data: any) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
      if (typeof (client as any).flush === 'function') {
        (client as any).flush();
      }
    } catch {
      sseClients.delete(client);
    }
  }
}

// Hook into paasStore events to broadcast to all connected UI clients
paasStore.on('project_updated', project => broadcastEvent('project_updated', project));
paasStore.on('project_deleted', id => broadcastEvent('project_deleted', { id }));
paasStore.on('deployment_created', dep => broadcastEvent('deployment_created', dep));
paasStore.on('deployment_updated', dep => broadcastEvent('deployment_updated', dep));
paasStore.on('log_added', log => broadcastEvent('log_added', log));
paasStore.on('stats_updated', stats => broadcastEvent('stats_updated', stats));

// SSE endpoint
app.get('/api/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(': connected\n\n');
  sseClients.add(res);

  // Keep connection alive with periodic heartbeats every 15s
  const keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});


// System Health & Engine Status
app.get('/api/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dockerSocketAvailable: await isDockerSocketAvailable(),
    uptime: process.uptime(),
    version: '1.0.0',
  });
});

app.get('/api/system/status', async (_req: Request, res: Response) => {
  const projects = paasStore.getProjects();
  const liveCount = projects.filter(p => p.status === 'LIVE').length;
  const buildingCount = projects.filter(p => p.status === 'BUILDING').length;
  const failedCount = projects.filter(p => p.status === 'FAILED' || p.status === 'CRASHED').length;

  res.json({
    dockerAvailable: await isDockerSocketAvailable(),
    traefikDomain: process.env.TRAEFIK_DOMAIN || 'localhost',
    cloudflareActive: Boolean(process.env.CLOUDFLARE_TUNNEL_TOKEN),
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
    webhookSecretConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    totalProjects: projects.length,
    liveProjects: liveCount,
    buildingProjects: buildingCount,
    failedProjects: failedCount,
    maxDeploymentsLimit: process.env.MAX_DEPLOYMENTS_PER_PROJECT || '10',
  });
});

// ==========================================
// PROJECTS API
// ==========================================

// GET /api/projects
app.get('/api/projects', (_req: Request, res: Response) => {
  res.json(paasStore.getProjects());
});

// POST /api/projects
app.post('/api/projects', async (req: Request, res: Response) => {
  const {
    name,
    repositoryUrl,
    branch,
    buildType,
    dockerfilePath,
    buildCommand,
    startCommand,
    internalPort,
    healthPath,
    domain,
    autoDeploy,
    envVars,
    triggerInitialDeploy,
  } = req.body;

  if (!name || !repositoryUrl) {
    return res.status(400).json({ error: 'Name and repositoryUrl are required' });
  }

  // Check name uniqueness
  const existing = paasStore.getProjectByName(name);
  if (existing) {
    return res.status(409).json({ error: `A project with name "${name}" already exists` });
  }

  const project = paasStore.createProject({
    name,
    repositoryUrl,
    branch: branch || 'main',
    buildType,
    dockerfilePath,
    buildCommand,
    startCommand,
    internalPort: internalPort ? parseInt(internalPort, 10) : 3000,
    healthPath: healthPath || '/health',
    domain,
    autoDeploy: autoDeploy ?? true,
  });

  // Save environment variables if provided
  if (Array.isArray(envVars)) {
    for (const ev of envVars) {
      if (ev.key && ev.value) {
        paasStore.setEnvVar(project.id, ev.key, ev.value);
      }
    }
  }

  // Attempt automatic GitHub Webhook setup if GITHUB_TOKEN is available
  let webhookNotice = 'Add webhook manually using URL: /api/webhooks/github';
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_WEBHOOK_SECRET) {
    const publicHost = process.env.APP_URL || `http://${project.domain}`;
    const webhookUrl = `${publicHost}/api/webhooks/github`;
    const whResult = await createGitHubWebhook(
      project.repositoryOwner,
      project.repositoryName,
      webhookUrl,
      process.env.GITHUB_WEBHOOK_SECRET
    );
    if (whResult.success) {
      webhookNotice = 'GitHub webhook configured automatically!';
    } else {
      webhookNotice = whResult.message;
    }
  }

  // Initial deployment if requested
  let initialDeployment = null;
  if (triggerInitialDeploy) {
    const dep = paasStore.createDeployment(
      project.id,
      'init-' + Math.random().toString(16).slice(2, 9),
      'Initial deployment upon project creation',
      'LocalPaaS'
    );
    deploymentQueue.enqueueDeploy(project.id, dep.id);
    initialDeployment = dep;
  }

  res.status(201).json({
    project,
    initialDeployment,
    webhookNotice,
  });
});

// GET /api/projects/:id
app.get('/api/projects/:id', (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(project);
});

// PUT /api/projects/:id
app.put('/api/projects/:id', (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const {
    branch,
    buildType,
    dockerfilePath,
    buildCommand,
    startCommand,
    internalPort,
    healthPath,
    domain,
    autoDeploy,
    cpuLimit,
    memoryLimit,
  } = req.body;

  const updated = paasStore.updateProject(project.id, {
    branch: branch ?? project.branch,
    buildType: buildType ?? project.buildType,
    dockerfilePath: dockerfilePath ?? project.dockerfilePath,
    buildCommand: buildCommand ?? project.buildCommand,
    startCommand: startCommand ?? project.startCommand,
    internalPort: internalPort ? parseInt(internalPort, 10) : project.internalPort,
    healthPath: healthPath ?? project.healthPath,
    domain: domain ?? project.domain,
    autoDeploy: autoDeploy ?? project.autoDeploy,
    cpuLimit: cpuLimit ?? project.cpuLimit,
    memoryLimit: memoryLimit ?? project.memoryLimit,
  });

  res.json(updated);
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Stop container before deletion
  dockerRunner.stopProject(project);
  paasStore.deleteProject(req.params.id);
  res.json({ success: true, message: `Project ${project.name} deleted successfully` });
});

// ==========================================
// MANUAL CONTROLS
// ==========================================

// POST /api/projects/:id/deploy
app.post('/api/projects/:id/deploy', (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const commitSha = req.body.commitSha || Math.random().toString(16).slice(2, 10) + 'ab90ef';
  const commitMessage = req.body.commitMessage || 'Manual redeploy from LocalPaaS dashboard';
  const simulateFailure = req.body.simulateFailure; // optional: 'build' | 'start' | 'health'

  const deployment = paasStore.createDeployment(project.id, commitSha, commitMessage, 'LocalPaaS Admin');
  const job = deploymentQueue.enqueueDeploy(project.id, deployment.id, { simulateFailure });

  res.json({
    success: true,
    message: 'Deployment job queued',
    deployment,
    jobId: job.id,
  });
});

// POST /api/projects/:id/restart
app.post('/api/projects/:id/restart', async (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await dockerRunner.restartProject(project);
  res.json({ success: true, message: `Container for ${project.name} restarted` });
});

// POST /api/projects/:id/stop
app.post('/api/projects/:id/stop', async (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await dockerRunner.stopProject(project);
  res.json({ success: true, message: `Container for ${project.name} stopped` });
});

// POST /api/projects/:id/start
app.post('/api/projects/:id/start', async (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await dockerRunner.startProject(project);
  res.json({ success: true, message: `Container for ${project.name} started` });
});

// POST /api/projects/:id/rollback/:deploymentId
app.post('/api/projects/:id/rollback/:deploymentId', (req: Request, res: Response) => {
  const project = paasStore.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const targetDeployment = paasStore.getDeployment(req.params.deploymentId);
  if (!targetDeployment) {
    return res.status(404).json({ error: 'Target deployment not found' });
  }

  if (targetDeployment.status !== 'LIVE' && !targetDeployment.imageName) {
    return res.status(400).json({ error: 'Cannot rollback to a non-successful deployment' });
  }

  const job = deploymentQueue.enqueueRollback(project.id, targetDeployment.id);
  res.json({
    success: true,
    message: `Rollback job queued to restore deployment ${targetDeployment.id}`,
    jobId: job.id,
  });
});

// ==========================================
// DEPLOYMENTS & LOGS API
// ==========================================

// GET /api/projects/:id/deployments
app.get('/api/projects/:id/deployments', (req: Request, res: Response) => {
  const deployments = paasStore.getDeploymentsForProject(req.params.id);
  res.json(deployments);
});

// GET /api/deployments/:id
app.get('/api/deployments/:id', (req: Request, res: Response) => {
  const deployment = paasStore.getDeployment(req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }
  res.json(deployment);
});

// GET /api/deployments/:id/logs
app.get('/api/deployments/:id/logs', (req: Request, res: Response) => {
  const logs = paasStore.getLogs(req.params.id);
  res.json(logs);
});

// GET /api/projects/:id/stats
app.get('/api/projects/:id/stats', (req: Request, res: Response) => {
  const stats = paasStore.getStats(req.params.id);
  res.json(stats);
});

// ==========================================
// ENVIRONMENT VARIABLES API
// ==========================================

// GET /api/projects/:id/env
app.get('/api/projects/:id/env', (req: Request, res: Response) => {
  const envs = paasStore.getEnvVars(req.params.id);
  // By default, return masked values for security!
  const reveal = req.query.reveal === 'true';
  const result = envs.map(e => ({
    id: e.id,
    projectId: e.projectId,
    key: e.key,
    value: reveal ? decryptValue(e.encryptedValue) : e.maskedValue,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  res.json(result);
});

// POST /api/projects/:id/env
app.post('/api/projects/:id/env', (req: Request, res: Response) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'Key and value are required' });
  }

  const env = paasStore.setEnvVar(req.params.id, key.trim(), String(value));
  res.status(201).json({
    id: env.id,
    key: env.key,
    maskedValue: env.maskedValue,
  });
});

// PUT /api/projects/:id/env/:key
app.put('/api/projects/:id/env/:key', (req: Request, res: Response) => {
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: 'Value is required' });
  }

  const env = paasStore.setEnvVar(req.params.id, req.params.key, String(value));
  res.json({
    id: env.id,
    key: env.key,
    maskedValue: env.maskedValue,
  });
});

// DELETE /api/projects/:id/env/:key
app.delete('/api/projects/:id/env/:key', (req: Request, res: Response) => {
  const deleted = paasStore.deleteEnvVar(req.params.id, req.params.key);
  if (!deleted) {
    return res.status(404).json({ error: 'Variable not found' });
  }
  res.json({ success: true, message: `Variable ${req.params.key} deleted` });
});

// ==========================================
// GITHUB INTEGRATION & WEBHOOKS
// ==========================================

// POST /api/webhooks/github
app.post('/api/webhooks/github', handleGitHubWebhook);

// Check GitHub repo & auto-detect stack
app.post('/api/github/check-repo', async (req: Request, res: Response) => {
  const { repoUrl } = req.body;
  if (!repoUrl) {
    return res.status(400).json({ error: 'Repository URL is required' });
  }
  const result = await checkGitHubRepo(repoUrl);
  res.json(result);
});

// Interactive Webhook Simulator for Testing
app.post('/api/webhooks/simulate', (req: Request, res: Response) => {
  const { projectId, branch, commitSha, commitMessage, simulateFailure } = req.body;
  const project = paasStore.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const sha = commitSha || Math.random().toString(16).slice(2, 9) + '7c89f';
  const msg = commitMessage || 'feat: automated deployment test via simulator';

  const dep = paasStore.createDeployment(project.id, sha, msg, 'GitHub Simulator');
  const job = deploymentQueue.enqueueDeploy(project.id, dep.id, { simulateFailure });

  res.json({
    success: true,
    message: `Simulated GitHub Push Webhook trigger for ${project.name} (${project.branch})`,
    deploymentId: dep.id,
    jobId: job.id,
    commitSha: sha,
  });
});

// ==========================================
// VITE DEV MIDDLEWARE / STATIC ASSETS
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LocalPaaS deployment server listening on http://0.0.0.0:${PORT}`);
    console.log(`GitHub Webhook endpoint active at /api/webhooks/github`);
  });
}

startServer().catch(err => {
  console.error('Fatal startup error in LocalPaaS server:', err);
  process.exit(1);
});
