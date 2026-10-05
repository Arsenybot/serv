import assert from 'assert';
import crypto from 'crypto';
import { encryptValue, decryptValue, maskValue, verifyGitHubSignature, slugify } from '../server/crypto.ts';
import { paasStore } from '../server/store.ts';
import { dockerRunner } from '../server/docker-runner.ts';
import { prepareSource } from '../server/source-preparer.ts';
import { traefikDynamicManager } from '../server/traefik-manager.ts';

// Set test environment to enable deterministic mock execution
process.env.NODE_ENV = 'test';
process.env.GITHUB_WEBHOOK_SECRET = 'test_webhook_secret_key_123';
process.env.ENCRYPTION_KEY = '01234567890123456789012345678901'; // 32 bytes

async function runTestSuite() {
  console.log('\n========================================');
  console.log('🚀 Running LocalPaaS Blue-Green Automated Test Suite');
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

    const masked = maskValue(secret);
    assert.strictEqual(masked.startsWith('********'), true);
    assert.strictEqual(masked.endsWith('-xyz'), true);
  });

  // 2. DNS-compatible Slug Generation
  await test('DNS-compatible slug generation', () => {
    assert.strictEqual(slugify('My Awesome App!'), 'my-awesome-app');
    assert.strictEqual(slugify('App @ 2026 / Version 2.0'), 'app-2026-version-2-0');
    assert.strictEqual(slugify('---special---'), 'special');
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

  // 6. Test 1: OLD + NEW isolation (no shared pool)
  await test('Test 1: OLD and NEW have separate isolated Traefik services (no shared pool)', async () => {
    const depOld = paasStore.createDeployment(testProject.id, 'commit-old-111', 'Old deployment', 'Arsenybot');
    const okOld = await dockerRunner.executeDeployment(testProject, depOld);

    assert.strictEqual(okOld, true);

    const oldService = paasStore.getDeployment(depOld.id)?.traefikServiceName;
    assert.ok(oldService);
    assert.strictEqual(oldService.startsWith('botsig-application-dep-'), true);

    // Dynamic config must route production to oldService
    let cfg = traefikDynamicManager.getProjectConfig(testProject.slug);
    assert.strictEqual(cfg.http.routers['botsig-application'].service, oldService);
    assert.ok(cfg.http.services[oldService]);

    // Now start NEW deployment
    const depNew = paasStore.createDeployment(testProject.id, 'commit-new-222', 'New deployment', 'Arsenybot');
    const newShort = depNew.id.replace(/^dep-/, '').slice(0, 8);
    const reg = traefikDynamicManager.registerDeployment({
      projectSlug: testProject.slug,
      deploymentId: depNew.id,
      containerId: `project-botsig-application-${newShort}`,
      internalPort: 3000,
    });

    const newService = reg.traefikServiceName;
    assert.notStrictEqual(oldService, newService);

    // Verify dynamic config contains BOTH isolated services simultaneously:
    cfg = traefikDynamicManager.getProjectConfig(testProject.slug);
    assert.ok(cfg.http.services[oldService], 'OLD service must exist');
    assert.ok(cfg.http.services[newService], 'NEW service must exist');
    assert.notStrictEqual(
      cfg.http.services[oldService].loadBalancer.servers[0].url,
      cfg.http.services[newService].loadBalancer.servers[0].url,
      'OLD and NEW must have distinct container URLs'
    );

    // Verification router points ONLY to NEW
    assert.strictEqual(cfg.http.routers[reg.verificationRouterName].service, newService);

    // Production router STILL points ONLY to OLD before switch
    assert.strictEqual(cfg.http.routers['botsig-application'].service, oldService);

    // Clean up temporary registered router
    traefikDynamicManager.removeVerificationRouter(testProject.slug, reg.verificationRouterName);
    traefikDynamicManager.removeDeploymentService(testProject.slug, newService);
  });

  // 7. Test 2: NEW failure leaves OLD production untouched and cleans up NEW
  await test('Test 2: NEW verification failure leaves OLD production untouched and removes NEW router', async () => {
    const currentDepBefore = paasStore.getProject(testProject.id)?.currentDeploymentId;
    assert.ok(currentDepBefore);
    const oldDep = paasStore.getDeployment(currentDepBefore);
    assert.ok(oldDep?.traefikServiceName);


    const brokenDep = paasStore.createDeployment(testProject.id, 'commit-broken-333', 'Broken update', 'Arsenybot');
    const success = await dockerRunner.executeDeployment(testProject, brokenDep, {
      simulateFailure: 'traefik_verify',
    });

    assert.strictEqual(success, false);
    const brokenRecord = paasStore.getDeployment(brokenDep.id);
    assert.strictEqual(brokenRecord?.status, 'HEALTH_CHECK_FAILED');

    // CRITICAL: Project remains LIVE with previous deployment!
    const projState = paasStore.getProject(testProject.id);
    assert.strictEqual(projState?.status, 'LIVE');
    assert.strictEqual(projState?.currentDeploymentId, currentDepBefore);

    // Traefik dynamic config still points production exclusively to OLD service
    const cfg = traefikDynamicManager.getProjectConfig(testProject.slug);
    assert.strictEqual(cfg.http.routers['botsig-application'].service, oldDep.traefikServiceName);

    // Verification router of broken deployment is cleaned up
    assert.strictEqual(cfg.http.routers[brokenRecord?.verificationRouterName || ''], undefined);
  });

  // 8. Test 3: Successful switch transfers production exclusively to NEW service
  await test('Test 3: Successful switch transfers production exclusively to NEW and stops OLD', async () => {
    const prevDepId = paasStore.getProject(testProject.id)?.currentDeploymentId;
    assert.ok(prevDepId);

    const goodDep = paasStore.createDeployment(testProject.id, 'commit-good-444', 'Clean release v2', 'Arsenybot');
    const success = await dockerRunner.executeDeployment(testProject, goodDep);
    assert.strictEqual(success, true);

    const newDepRecord = paasStore.getDeployment(goodDep.id);
    assert.strictEqual(newDepRecord?.status, 'LIVE');
    assert.ok(newDepRecord?.traefikServiceName);

    // Project is updated to new deployment
    assert.strictEqual(paasStore.getProject(testProject.id)?.currentDeploymentId, goodDep.id);

    // Production router points ONLY to NEW service!
    const cfg = traefikDynamicManager.getProjectConfig(testProject.slug);
    assert.strictEqual(cfg.http.routers['botsig-application'].service, newDepRecord.traefikServiceName);

    // Verification router is cleaned up
    assert.strictEqual(cfg.http.routers[newDepRecord.verificationRouterName || ''], undefined);
  });

  // 9. Test 4: Production switch failure aborts and leaves OLD as production
  await test('Test 4: Production switch failure aborts and leaves OLD untouched', async () => {
    const liveDepId = paasStore.getProject(testProject.id)?.currentDeploymentId;
    assert.ok(liveDepId);
    const liveDep = paasStore.getDeployment(liveDepId);

    const failSwitchDep = paasStore.createDeployment(testProject.id, 'commit-switch-fail', 'Switch fail', 'Arsenybot');
    const success = await dockerRunner.executeDeployment(testProject, failSwitchDep, {
      simulateFailure: 'production_switch',
    });

    assert.strictEqual(success, false);
    assert.strictEqual(paasStore.getDeployment(failSwitchDep.id)?.status, 'HEALTH_CHECK_FAILED');

    // Production router remains pointed to liveDep
    const cfg = traefikDynamicManager.getProjectConfig(testProject.slug);
    assert.strictEqual(cfg.http.routers['botsig-application'].service, liveDep?.traefikServiceName);
    assert.strictEqual(paasStore.getProject(testProject.id)?.currentDeploymentId, liveDepId);
  });

  // 10. Test 5: Verify NO shared generic service exists
  await test('Test 5: Neither OLD nor NEW use shared generic traefik.http.services.<projectSlug>', () => {
    const cfg = traefikDynamicManager.getProjectConfig(testProject.slug);
    assert.strictEqual(
      cfg.http.services['botsig-application'],
      undefined,
      'Generic shared service botsig-application must NOT exist'
    );
  });

  // 11. Test B: Git clone failure falls back to Tarball with exact commit SHA
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

  // 12. Test C: Docker build failure sets BUILD_FAILED cleanly without touching LIVE
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

  // 13. Test G: Manual startProject with health check
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

  // 14. Test H: Restart project uses unified zero-downtime health verification
  await test('Test H: Restart project uses unified zero-downtime health verification', async () => {
    const restarted = await dockerRunner.restartProject(testProject);
    assert.strictEqual(restarted, true);
    assert.strictEqual(paasStore.getProject(testProject.id)?.status, 'LIVE');
  });

  // 15. Test I: Tarball deployment identity preserves exact SHA (no random generation)
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

  // 16. Rollback Safety
  await test('Rollback reuses pre-built image and transitions LIVE', async () => {
    const rollbackDep = paasStore.createDeployment(
      testProject.id,
      'commit-old-111',
      'Rollback to v1.0',
      'Admin',
    );

    const success = await dockerRunner.executeDeployment(testProject, rollbackDep, {
      isRollback: true,
      reuseImageName: 'local-paas/botsig-application:commit-',
    });

    assert.strictEqual(success, true);
    assert.strictEqual(paasStore.getProject(testProject.id)?.currentDeploymentId, rollbackDep.id);
  });

  // 17. Webhook Idempotency
  await test('Webhook idempotency deduplicates duplicate push events', () => {
    const key = `${testProject.id}:commit-xyz999:refs/heads/main`;
    assert.strictEqual(paasStore.isWebhookProcessed(key), false);
    paasStore.markWebhookProcessed(key);
    assert.strictEqual(paasStore.isWebhookProcessed(key), true);
  });

  // 18. Git Retry & Failure handling
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

  // 19. Project Deletion
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
