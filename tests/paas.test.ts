import assert from 'assert';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';

import { paasStore } from '../server/store.ts';
import { dockerRunner } from '../server/docker-runner.ts';
import { deploymentQueue } from '../server/queue.ts';
import { encryptValue, decryptValue, maskValue, verifyGitHubSignature, slugify } from '../server/crypto.ts';

async function runTestSuite() {
  console.log('========================================');
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

  // 1. Environment Variable Encryption & Masking
  await test('AES-256-GCM encryption, decryption, and masking', () => {
    const rawSecret = 'postgresql://admin:super_secret_password@db.internal:5432/app';
    const encrypted = encryptValue(rawSecret);
    assert.notStrictEqual(encrypted, rawSecret);
    assert.strictEqual(encrypted.split(':').length, 3); // iv:tag:data

    const decrypted = decryptValue(encrypted);
    assert.strictEqual(decrypted, rawSecret);

    const masked = maskValue(rawSecret);
    assert.ok(masked.startsWith('••••'));
    assert.ok(!masked.includes('super_secret_password'));
  });

  // 2. Slugify DNS compatibility
  await test('DNS-compatible slug generation', () => {
    assert.strictEqual(slugify('My Super Application 123!'), 'my-super-application-123');
    assert.strictEqual(slugify('__Test--App__'), 'test-app');
  });

  // 3. GitHub Webhook HMAC Signature Validation
  await test('GitHub Webhook HMAC-SHA256 signature verification', () => {
    const secret = 'my_test_webhook_secret_key_123';
    const payload = JSON.stringify({ ref: 'refs/heads/main', repository: { name: 'app' } });
    
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const validHeader = `sha256=${hmac}`;
    const invalidHeader = `sha256=0000000000000000000000000000000000000000000000000000000000000000`;

    assert.strictEqual(verifyGitHubSignature(payload, validHeader, secret), true);
    assert.strictEqual(verifyGitHubSignature(payload, invalidHeader, secret), false);
    assert.strictEqual(verifyGitHubSignature(payload, undefined, secret), false);
  });

  // 4. Project Creation & Store
  let testProject: any;
  await test('Project creation and persistence', () => {
    testProject = paasStore.createProject({
      name: 'Integration Test App',
      repositoryUrl: 'https://github.com/test-owner/test-app.git',
      branch: 'main',
      buildType: 'DOCKERFILE',
      internalPort: 8080,
      healthPath: '/health',
      autoDeploy: true,
    });

    assert.ok(testProject.id);
    assert.strictEqual(testProject.slug, 'integration-test-app');
    assert.strictEqual(testProject.repositoryOwner, 'test-owner');
    assert.strictEqual(testProject.repositoryName, 'test-app');
    assert.strictEqual(testProject.status, 'STOPPED');
  });

  // 5. Environment Variables in Project
  await test('Setting and retrieving project environment variables', () => {
    paasStore.setEnvVar(testProject.id, 'API_KEY', 'sk_live_9988776655');
    const envs = paasStore.getEnvVars(testProject.id);
    assert.strictEqual(envs.length, 1);
    assert.strictEqual(envs[0].key, 'API_KEY');
    assert.strictEqual(decryptValue(envs[0].encryptedValue), 'sk_live_9988776655');
  });

  // 6. Successful Deployment Pipeline & Zero-Downtime Transition
  let initialDeployment: any;
  await test('Successful deployment execution -> LIVE state', async () => {
    initialDeployment = paasStore.createDeployment(testProject.id, 'commit-aaa111', 'Initial commit');
    assert.strictEqual(initialDeployment.status, 'QUEUED');

    const success = await dockerRunner.executeDeployment(testProject, initialDeployment);
    assert.strictEqual(success, true);

    const updated = paasStore.getDeployment(initialDeployment.id);
    assert.strictEqual(updated?.status, 'LIVE');
    assert.strictEqual(updated?.healthPassed, true);

    const updatedProj = paasStore.getProject(testProject.id);
    assert.strictEqual(updatedProj?.status, 'LIVE');
    assert.strictEqual(updatedProj?.currentDeploymentId, initialDeployment.id);

    // Verify logs were generated
    const logs = paasStore.getLogs(initialDeployment.id);
    assert.ok(logs.length > 5);
    assert.ok(logs.some(l => l.message.includes('Health check PASSED')));
  });

  // 7. Health Check Failure & Zero-Downtime Preservation of Old Container
  await test('Health check failure leaves previous LIVE deployment running (Zero-Downtime)', async () => {
    const failedDeployment = paasStore.createDeployment(testProject.id, 'commit-bbb222', 'Broken commit with failing health check');
    
    // Simulate health check failure
    const success = await dockerRunner.executeDeployment(testProject, failedDeployment, {
      simulateFailure: 'health',
    });

    assert.strictEqual(success, false);

    const depState = paasStore.getDeployment(failedDeployment.id);
    assert.strictEqual(depState?.status, 'HEALTH_CHECK_FAILED');
    assert.strictEqual(depState?.healthPassed, false);

    // CRITICAL: Project currentDeploymentId MUST NOT be broken; old deployment must still be current!
    const projState = paasStore.getProject(testProject.id);
    assert.strictEqual(projState?.currentDeploymentId, initialDeployment.id);
    assert.strictEqual(projState?.status, 'LIVE');
  });

  // 8. Docker Build Failure handling
  await test('Docker build failure sets BUILD_FAILED status cleanly', async () => {
    const buildFailDep = paasStore.createDeployment(testProject.id, 'commit-ccc333', 'Syntax error in dockerfile');
    const success = await dockerRunner.executeDeployment(testProject, buildFailDep, {
      simulateFailure: 'build',
    });

    assert.strictEqual(success, false);
    const depState = paasStore.getDeployment(buildFailDep.id);
    assert.strictEqual(depState?.status, 'BUILD_FAILED');
    assert.ok(depState?.errorMessage?.includes('build failed'));
  });

  // 9. Rollback without rebuilding Git repository
  await test('Rollback reuses pre-built image and transitions LIVE', async () => {
    const rollbackDep = paasStore.createDeployment(testProject.id, initialDeployment.commitSha, 'Rollback to initial release');
    const success = await dockerRunner.executeDeployment(testProject, rollbackDep, {
      isRollback: true,
      reuseImageName: initialDeployment.imageName,
    });

    assert.strictEqual(success, true);
    const depState = paasStore.getDeployment(rollbackDep.id);
    assert.strictEqual(depState?.status, 'LIVE');

    const logs = paasStore.getLogs(rollbackDep.id);
    assert.ok(logs.some(l => l.message.includes('[ROLLBACK] Reusing pre-built Docker image')));
  });

  // 10. Webhook Idempotency Check
  await test('Webhook idempotency deduplicates duplicate push events', () => {
    const key = `${testProject.id}:commit-xyz999:refs/heads/main`;
    assert.strictEqual(paasStore.isWebhookProcessed(key), false);
    paasStore.markWebhookProcessed(key);
    assert.strictEqual(paasStore.isWebhookProcessed(key), true);
  });

  // 11. Project Deletion
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
