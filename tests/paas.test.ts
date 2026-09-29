import assert from 'assert';
import crypto from 'crypto';
import { encryptValue, decryptValue, maskSecret, verifyGitHubSignature, generateProjectSlug } from '../server/crypto.ts';
import { paasStore } from '../server/store.ts';
import { dockerRunner } from '../server/docker-runner.ts';
import { prepareSource } from '../server/source-preparer.ts';

// Set test environment to enable deterministic mock execution
process.env.NODE_ENV = 'test';
process.env.GITHUB_WEBHOOK_SECRET = 'test_webhook_secret_key_123';
process.env.ENCRYPTION_KEY = '01234567890123456789012345678901'; // 32 bytes

async function runTestSuite() {
  console.log('\n========================================');
  console.log('🚀 Running LocalPaaS Automated Test Suite');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      process.stdout.write(`• Testing: ${name}... `);
      await fn();
      console.log('✅ PASSED');
      passed++;
    } catch (err: any) {
      console.log('❌ FAILED');
      console.error('  Error:', err.message || err);
      failed++;
    }
  }

  // 1. Encryption & Decryption
  await test('AES-256-GCM encryption, decryption, and masking', () => {
    const secret = 'super-secret-token-value-xyz';
    const encrypted = encryptValue(secret);
    assert.notStrictEqual(encrypted, secret);
    assert.strictEqual(encrypted.includes(':'), true);

    const decrypted = decryptValue(encrypted);
    assert.strictEqual(decrypted, secret);

    const masked = maskSecret(secret);
    assert.strictEqual(masked.startsWith('••••'), true);
    assert.strictEqual(masked.endsWith('-xyz'), true);
  });

  // 2. DNS-compatible Slug Generation
  await test('DNS-compatible slug generation', () => {
    assert.strictEqual(generateProjectSlug('My Awesome App!'), 'my-awesome-app');
    assert.strictEqual(generateProjectSlug('App @ 2026 / Version 2.0'), 'app-2026-version-2-0');
    assert.strictEqual(generateProjectSlug('---special---'), 'special');
  });

  // 3. GitHub HMAC Webhook Signature Verification
  await test('GitHub Webhook HMAC-SHA256 signature verification', () => {
    const secret = 'test_webhook_secret_key_123';
    const payload = JSON.stringify({ ref: 'refs/heads/main', repository: { name: 'botsig' } });

    // Generate valid crypto signature
    const hmac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    const validSignature = `sha256=${hmac}`;

    assert.strictEqual(verifyGitHubSignature(payload, validSignature, secret), true);
    assert.strictEqual(verifyGitHubSignature(payload, 'sha256=invalidhashvalue000', secret), false);
    assert.strictEqual(verifyGitHubSignature(payload, undefined, secret), false);
  });

  // 4. Store Project Persistence
  const testProject = paasStore.createProject({
    name: 'BotSig Application',
    repositoryUrl: 'https://github.com/Arsenybot/botsig.git',
    branch: 'main',
    buildType: 'DOCKERFILE',
    internalPort: 3000,
    healthPath: '/api/health',
  });

  await test('Project creation and persistence', () => {
    assert.strictEqual(testProject.name, 'BotSig Application');
    assert.strictEqual(testProject.slug, 'botsig-application');
    assert.strictEqual(testProject.domain, 'botsig-application.localhost');
    assert.strictEqual(testProject.status, 'STOPPED');

    const fetched = paasStore.getProject(testProject.id);
    assert.strictEqual(fetched?.id, testProject.id);
  });

  // 5. Environment Variables
  await test('Setting and retrieving project environment variables', () => {
    paasStore.setEnvVar(testProject.id, 'BOT_TOKEN', '12345:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
    paasStore.setEnvVar(testProject.id, 'DATABASE_URL', 'postgres://user:pass@db:5432/app');

    const envs = paasStore.getEnvVars(testProject.id);
    assert.strictEqual(envs.length, 2);

    const tokenEnv = envs.find(e => e.key === 'BOT_TOKEN');
    assert.ok(tokenEnv);
    assert.strictEqual(decryptValue(tokenEnv!.encryptedValue), '12345:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
  });

  // 6. Test A: Successful Git clone -> Docker build -> Health -> Traefik -> LIVE
  await test('Test A: Successful deployment execution -> Health -> Traefik -> LIVE state', async () => {
    const deployment = paasStore.createDeployment(
      testProject.id,
      'commit-aaa111',
      'Initial release',
      'Arsenybot'
    );

    const success = await dockerRunner.executeDeployment(testProject, deployment);
    assert.strictEqual(success, true);

    const updatedProject = paasStore.getProject(testProject.id);
    assert.strictEqual(updatedProject?.status, 'LIVE');
    assert.strictEqual(updatedProject?.currentDeploymentId, deployment.id);

    const updatedDep = paasStore.getDeployment(deployment.id);
    assert.strictEqual(updatedDep?.status, 'LIVE');
    assert.strictEqual(updatedDep?.healthPassed, true);

    const logs = paasStore.getLogs(deployment.id);
    assert.ok(logs.some(l => l.message.includes('Ready signal received! Health check PASSED')));
    assert.ok(logs.some(l => l.message.includes('New deployment verified through Traefik')));
  });

  // 7. Test B: Git clone failure + Tarball fallback with exact SHA
  await test('Test B: Git clone failure falls back to Tarball with exact commit SHA', async () => {
    const tarballProject = paasStore.createProject({
      name: 'Tarball App',
      repositoryUrl: 'https://github.com/test-owner/test-app.git',
      branch: 'main',
    });

    const tarballDep = paasStore.createDeployment(tarballProject.id, 'c0ffee777888', 'Push via tarball');
    const success = await dockerRunner.executeDeployment(tarballProject, tarballDep, {
      forceTarballFallback: true,
    });

    assert.strictEqual(success, true);
    const depState = paasStore.getDeployment(tarballDep.id);
    assert.strictEqual(depState?.status, 'LIVE');
    assert.strictEqual(depState?.commitSha, 'c0ffee777888');

    const logs = paasStore.getLogs(tarballDep.id);
    assert.ok(logs.some(l => l.message.includes('Falling back to GitHub Tarball API')));
  });

  // 8. Test C: Docker build failure sets BUILD_FAILED cleanly without touching LIVE
  await test('Test C: Docker build failure sets BUILD_FAILED status cleanly', async () => {
    const failingDep = paasStore.createDeployment(
      testProject.id,
      'commit-bbb222',
      'Broken build commit',
      'Arsenybot'
    );

    const success = await dockerRunner.executeDeployment(testProject, failingDep, {
      simulateFailure: 'build',
    });

    assert.strictEqual(success, false);
    const depState = paasStore.getDeployment(failingDep.id);
    assert.strictEqual(depState?.status, 'BUILD_FAILED');
    assert.ok(depState?.errorMessage?.includes('build failed'));

    // Project should STILL be LIVE with previous deployment!
    const projState = paasStore.getProject(testProject.id);
    assert.strictEqual(projState?.status, 'LIVE');
  });

  // 9. Test D: Container health check failure leaves previous LIVE deployment running (Zero-Downtime)
  await test('Test D: Health check failure leaves previous LIVE deployment running (Zero-Downtime)', async () => {
    const failingDep = paasStore.createDeployment(
      testProject.id,
      'commit-ccc333',
      'Broken runtime commit',
      'Arsenybot'
    );

    const success = await dockerRunner.executeDeployment(testProject, failingDep, {
      simulateFailure: 'health',
    });

    assert.strictEqual(success, false);
    const depState = paasStore.getDeployment(failingDep.id);
    assert.strictEqual(depState?.status, 'HEALTH_CHECK_FAILED');
    assert.strictEqual(depState?.healthPassed, false);

    // Old deployment is STILL active!
    const projState = paasStore.getProject(testProject.id);
    assert.strictEqual(projState?.status, 'LIVE');
  });

  // 10. Test E: Traefik routing failure aborts deployment and keeps old LIVE untouched
  await test('Test E: Traefik routing verification failure leaves old LIVE untouched', async () => {
    const traefikFailDep = paasStore.createDeployment(
      testProject.id,
      'commit-eee555',
      'Traefik 502 test',
      'Arsenybot'
    );

    const success = await dockerRunner.executeDeployment(testProject, traefikFailDep, {
      simulateFailure: 'traefik',
    });

    assert.strictEqual(success, false);
    const depState = paasStore.getDeployment(traefikFailDep.id);
    assert.strictEqual(depState?.status, 'HEALTH_CHECK_FAILED');
    assert.ok(depState?.errorMessage?.includes('Traefik'));

    // Old deployment is STILL LIVE!
    const projState = paasStore.getProject(testProject.id);
    assert.strictEqual(projState?.status, 'LIVE');
  });

  // 11. Test F: Successful replacement stops old container and marks new as LIVE
  await test('Test F: Successful replacement stops old container and switches LIVE atomically', async () => {
    const currentDepId = paasStore.getProject(testProject.id)?.currentDeploymentId;
    assert.ok(currentDepId);

    const nextDep = paasStore.createDeployment(
      testProject.id,
      'commit-fff666',
      'Clean update',
      'Arsenybot'
    );

    const success = await dockerRunner.executeDeployment(testProject, nextDep);
    assert.strictEqual(success, true);
    assert.strictEqual(paasStore.getProject(testProject.id)?.currentDeploymentId, nextDep.id);
  });

  // 12. Test G: Manual startProject with health check
  await test('Test G: Manual startProject verifies health before setting LIVE', async () => {
    const startProj = paasStore.createProject({
      name: 'Start Test App',
      repositoryUrl: 'https://github.com/test-owner/test-app.git',
      branch: 'main',
    });

    const started = await dockerRunner.startProject(startProj);
    assert.strictEqual(started, true);
    assert.strictEqual(paasStore.getProject(startProj.id)?.status, 'LIVE');
  });

  // 13. Test H: Restart project uses unified zero-downtime health verification
  await test('Test H: Restart project uses unified zero-downtime health verification', async () => {
    const restarted = await dockerRunner.restartProject(testProject);
    assert.strictEqual(restarted, true);
    assert.strictEqual(paasStore.getProject(testProject.id)?.status, 'LIVE');
  });

  // 14. Test I: Tarball deployment identity preserves exact SHA (no random generation)
  await test('Test I: Tarball deployment identity preserves exact GitHub commit SHA', async () => {
    const res = await prepareSource({
      repositoryUrl: 'https://github.com/test-owner/test-app.git',
      branch: 'main',
      targetCommit: 'sha-strict-9999',
      onLog: () => {},
      forceTarballFallback: true,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.commitSha, 'sha-strict-9999');
    assert.strictEqual(res.sourceType, 'github-tarball');
  });

  // 15. Rollback Safety
  await test('Rollback reuses pre-built image and transitions LIVE', async () => {
    const rollbackDep = paasStore.createDeployment(
      testProject.id,
      'commit-aaa111',
      'Rollback to v1.0',
      'Admin',
      'ROLLBACK'
    );

    const success = await dockerRunner.executeDeployment(testProject, rollbackDep, {
      isRollback: true,
      reuseImageName: 'local-paas/botsig-application:commit-',
    });

    assert.strictEqual(success, true);
    assert.strictEqual(paasStore.getProject(testProject.id)?.currentDeploymentId, rollbackDep.id);
  });

  // 16. Webhook Idempotency
  await test('Webhook idempotency deduplicates duplicate push events', () => {
    const key = `${testProject.id}:commit-xyz999:refs/heads/main`;
    assert.strictEqual(paasStore.isWebhookProcessed(key), false);
    paasStore.markWebhookProcessed(key);
    assert.strictEqual(paasStore.isWebhookProcessed(key), true);
  });

  // 17. Git Retry & Failure handling
  await test('Git source preparation retry mechanism and failure handling', async () => {
    const brokenProject = paasStore.createProject({
      name: 'Broken Git Repo Project',
      repositoryUrl: 'https://github.com/non-existent-user-12345/non-existent-repo-99999.git',
      branch: 'main',
      buildType: 'DOCKERFILE',
    });

    const brokenDep = paasStore.createDeployment(brokenProject.id, 'abc0001', 'Test broken git');
    const success = await dockerRunner.executeDeployment(brokenProject, brokenDep);
    assert.strictEqual(success, false);

    const depState = paasStore.getDeployment(brokenDep.id);
    assert.strictEqual(depState?.status, 'BUILD_FAILED');
    assert.ok(depState?.errorMessage?.includes('Failed to fetch repository') || depState?.errorMessage?.includes('Could not resolve'));

    const logs = paasStore.getLogs(brokenDep.id);
    assert.ok(logs.some(l => l.message.includes('Attempt 1/3')));
    assert.ok(logs.some(l => l.message.includes('Attempt 3/3')));
  });

  // 18. Project Deletion
  await test('Project deletion cleans up metadata, deployments, and logs', () => {
    const deleted = paasStore.deleteProject(testProject.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(paasStore.getProject(testProject.id), undefined);
    assert.strictEqual(paasStore.getDeploymentsForProject(testProject.id).length, 0);
  });

  console.log('\n========================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
