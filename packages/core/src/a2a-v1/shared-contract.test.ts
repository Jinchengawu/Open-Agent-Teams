import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  A2A_V1_CONFORMANCE_PROFILE,
  A2AV1DeliveryIdentityRegistry,
  evaluateA2ATaskTransition,
  validateA2AV1,
} from './index.js';
import { createA2AMessage } from '../a2a/index.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8'));
}

test('A2A v1 shared contract remains isolated from the legacy 0.3 namespace', () => {
  assert.equal(A2A_V1_CONFORMANCE_PROFILE.protocolVersion, '1.0');
  assert.equal(A2A_V1_CONFORMANCE_PROFILE.fullComplianceClaimed, false);
  assert.ok(A2A_V1_CONFORMANCE_PROFILE.availableInfrastructure.includes('official-js-sdk-1.0.1-model-fixture-interoperability'));
  assert.ok(A2A_V1_CONFORMANCE_PROFILE.availableInfrastructure.includes('sqlite-persistent-task-event-cursor'));
  assert.ok(!A2A_V1_CONFORMANCE_PROFILE.excludedCapabilities.includes('streaming'));
  assert.ok(A2A_V1_CONFORMANCE_PROFILE.excludedCapabilities.includes('push-notifications'));
  assert.ok(A2A_V1_CONFORMANCE_PROFILE.excludedCapabilities.includes('production-runtime-adapter-wiring'));
  assert.deepEqual(validateA2AV1('task', fixture('valid/task.json')), { valid: true, issues: [] });
  assert.equal(validateA2AV1('task', fixture('invalid/task-v03-state.json')).valid, false);
  assert.equal(evaluateA2ATaskTransition('TASK_STATE_COMPLETED', 'TASK_STATE_WORKING').allowed, false);
  assert.equal(createA2AMessage({ role: 'user', parts: [{ kind: 'text', text: 'legacy remains available' }] }).role, 'user');
});

test('A2A v1 identity registry rejects cross-kind reuse', () => {
  const registry = new A2AV1DeliveryIdentityRegistry();
  registry.bind({ deliveryTaskId: 'delivery-1', a2aTaskId: 'a2a-1', workflowId: 'workflow-1', attemptId: 'attempt-1' });
  assert.throws(() => registry.bind({
    deliveryTaskId: 'attempt-1', a2aTaskId: 'a2a-2', workflowId: 'workflow-2', attemptId: 'attempt-2',
  }), /ID kind/);
});
