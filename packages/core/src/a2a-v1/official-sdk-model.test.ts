import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AgentCard, Artifact, Message, Task } from '@a2a-js/sdk';
import { validateA2AV1 } from './index.js';

const cases = [
  ['message', Message, 'valid/message.json'],
  ['artifact', Artifact, 'valid/artifact.json'],
  ['task', Task, 'valid/task.json'],
  ['agentCard', AgentCard, 'valid/agent-card.json'],
] as const;

for (const [kind, sourceModel, fixtureName] of cases) {
  test(`official A2A JS SDK 1.0.1 round-trips the shared ${kind} fixture`, () => {
    const model = sourceModel as { fromJSON(value: unknown): unknown; toJSON(value: unknown): unknown };
    const value = JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${fixtureName}`, import.meta.url)), 'utf8'));
    const roundTrip = model.toJSON(model.fromJSON(value));
    assert.deepEqual(validateA2AV1(kind, roundTrip), { valid: true, issues: [] });
  });
}
