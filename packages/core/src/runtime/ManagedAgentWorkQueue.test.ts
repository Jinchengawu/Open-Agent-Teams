import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ManagedAgentWorkQueue } from './ManagedAgentWorkQueue.js';

test('requires an explicit agentId binding before a worker satisfies readiness', () => {
  const queue = new ManagedAgentWorkQueue();
  queue.heartbeat({ workerId: 'unscoped-worker' });

  assert.equal(queue.hasActiveWorker('dev-pm'), false);
  assert.equal(queue.hasActiveWorker('project-admin'), false);
  assert.equal(queue.hasActiveWorker('dev-backend'), false);

  queue.heartbeat({ workerId: 'planning-worker', agentIds: ['project-admin'] });
  assert.equal(queue.hasActiveWorker('project-admin'), true);
  assert.equal(queue.hasActiveWorker('dev-pm'), false);
});

test('copies immutable input Artifact references through enqueue and SQLite reload', async () => {
  const database = new Database(':memory:');
  try {
    const queue = new ManagedAgentWorkQueue({ database });
    queue.heartbeat({ workerId: 'planning-worker', agentIds: ['project-admin'] });
    const controller = new AbortController();
    const pending = queue.enqueueAndWait({
      agentId: 'project-admin', goal: 'project the accepted PRD', signal: controller.signal,
      inputArtifactRefs: [{
        surfaceId: 'discovery', artifactId: 'artifact-discovery-1', contentHash: 'a'.repeat(64),
      }],
    });
    const item = queue.list({ agentId: 'project-admin' })[0];
    assert.deepEqual(item.inputArtifactRefs, [{
      surfaceId: 'discovery', artifactId: 'artifact-discovery-1', contentHash: 'a'.repeat(64),
    }]);
    controller.abort();
    await pending;

    const reloaded = new ManagedAgentWorkQueue({ database });
    assert.deepEqual(reloaded.list({ agentId: 'project-admin' })[0].inputArtifactRefs, [{
      surfaceId: 'discovery', artifactId: 'artifact-discovery-1', contentHash: 'a'.repeat(64),
    }]);
  } finally {
    database.close();
  }
});
