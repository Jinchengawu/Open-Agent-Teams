import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuntimeAdmissionController, RuntimeAdmissionError } from './RuntimeAdmissionController.js';

test('RuntimeAdmissionController enforces global, agent, model and session limits', async () => {
  const controller = new RuntimeAdmissionController({
    maxGlobal: 2,
    maxPerAgent: 1,
    maxPerModel: 2,
    maxPerSession: 1,
    maxQueueDepth: 4,
    maxQueueWaitMs: 1_000,
  });
  const releaseA = await controller.acquire({ agentId: 'a', modelId: 'm', sessionId: 's1' });
  const releaseB = await controller.acquire({ agentId: 'b', modelId: 'm', sessionId: 's2' });
  const waiting = controller.acquire({ agentId: 'a', modelId: 'm2', sessionId: 's3' });
  assert.equal(controller.snapshot().activeGlobal, 2);
  assert.equal(controller.snapshot().queued, 1);
  assert.deepEqual(controller.snapshot().activeByModel, { m: 2 });
  releaseA();
  const releaseC = await waiting;
  releaseB();
  releaseC();
  assert.equal(controller.snapshot().activeGlobal, 0);
});

test('RuntimeAdmissionController fails closed on invalid limits, overflow, timeout and abort', async () => {
  assert.throws(() => new RuntimeAdmissionController({ maxGlobal: 0 }), RuntimeAdmissionError);
  const controller = new RuntimeAdmissionController({
    maxGlobal: 1,
    maxPerAgent: 1,
    maxPerModel: 1,
    maxPerSession: 1,
    maxQueueDepth: 1,
    maxQueueWaitMs: 10,
  });
  const release = await controller.acquire({ agentId: 'a' });
  const timedOut = controller.acquire({ agentId: 'b' });
  await assert.rejects(controller.acquire({ agentId: 'c' }), { code: 'BACKPRESSURE_QUEUE_FULL' });
  await assert.rejects(timedOut, { code: 'ADMISSION_TIMED_OUT' });
  release();

  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    controller.acquire({ agentId: 'a', signal: abortController.signal }),
    { code: 'ADMISSION_ABORTED' },
  );
});
