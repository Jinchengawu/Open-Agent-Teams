import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  A2AV1HermesRuntimeAdapter,
  A2AV1HttpHandler,
  A2AV1OutboxDispatcher,
  A2AV1DeliveryIdentityRegistry,
  InProcessA2AV1Transport,
  SqliteA2AV1Repository,
  markA2AV1ArtifactsUntrusted,
} from './index.js';

test('SQLite store keeps tenant, inbox and transactional outbox boundaries', () => {
  const database = new Database(':memory:');
  try {
    const repository = new SqliteA2AV1Repository(database, { now: () => 1_000 });
    const command = {
      tenantId: 'tenant-a',
      idempotencyKey: 'submit-1',
      task: { id: 'task-1', contextId: 'context-1', status: { state: 'TASK_STATE_SUBMITTED' as const }, artifacts: [], history: [] },
    };
    const first = repository.acceptTaskSnapshot(command);
    assert.equal(repository.acceptTaskSnapshot(command).applied, false);
    assert.equal(repository.listPendingOutbox('tenant-a').length, 1);
    assert.equal(repository.getTask('tenant-b', 'task-1'), undefined);
    assert.equal(repository.listPendingOutbox('tenant-a')[0]?.id, first.outboxEventId);
  } finally {
    database.close();
  }
});

test('outbox dispatcher leases, retries and acknowledges through a delivery port', async () => {
  const database = new Database(':memory:');
  try {
    const repository = new SqliteA2AV1Repository(database);
    repository.acceptTaskSnapshot({
      tenantId: 'tenant-a', idempotencyKey: 'submit-1',
      task: { id: 'task-1', contextId: 'context-1', status: { state: 'TASK_STATE_SUBMITTED' }, artifacts: [], history: [] },
    });
    let deliveries = 0;
    const dispatcher = new A2AV1OutboxDispatcher(repository, async () => { deliveries += 1; });
    assert.deepEqual(await dispatcher.dispatchOnce({
      tenantId: 'tenant-a', workerId: 'worker-1', now: 1_000, leaseMs: 500,
      limit: 10, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000,
    }), { claimed: 1, dispatched: 1, retryScheduled: 0, deadLettered: 0 });
    assert.equal(deliveries, 1);
    assert.deepEqual(repository.listPendingOutbox('tenant-a'), []);
  } finally {
    database.close();
  }
});

test('in-process transport implements truthful send/get/list/cancel behavior', async () => {
  const database = new Database(':memory:');
  try {
    const transport = new InProcessA2AV1Transport(new SqliteA2AV1Repository(database));
    transport.registerAgent({
      tenantId: 'tenant-a', agentId: 'agent-a',
      agentCard: {
        name: 'Agent A', description: 'Shared v1 contract agent.', version: '0.1.0',
        supportedInterfaces: [{ url: 'in-process://agent-a', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }],
        capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
        defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [],
      },
      handler: async (request) => ({
        id: request.taskId, contextId: request.contextId,
        status: { state: 'TASK_STATE_WORKING' }, history: [request.message], artifacts: [],
      }),
    });
    const task = await transport.sendMessage({
      tenantId: 'tenant-a', agentId: 'agent-a', idempotencyKey: 'send-1',
      message: { messageId: 'message-1', role: 'ROLE_USER', parts: [{ text: 'work' }] },
    });
    assert.equal((await transport.getTask({ tenantId: 'tenant-a', taskId: task.id }))?.id, task.id);
    assert.deepEqual((await transport.listTasks({ tenantId: 'tenant-a', agentId: 'agent-a' })).map(({ id }) => id), [task.id]);
    assert.equal((await transport.cancelTask({
      tenantId: 'tenant-a', agentId: 'agent-a', taskId: task.id, idempotencyKey: 'cancel-1',
    })).status.state, 'TASK_STATE_CANCELED');
  } finally {
    database.close();
  }
});

test('durable task events resume from a monotonic tenant-scoped cursor', async () => {
  const database = new Database(':memory:');
  try {
    const repository = new SqliteA2AV1Repository(database);
    const base = {
      id: 'task-stream', contextId: 'context-stream', history: [], artifacts: [],
      metadata: { devAgentTeams: { agentId: 'agent-a' } },
    };
    repository.acceptTaskSnapshot({
      tenantId: 'tenant-a', idempotencyKey: 'stream-submit',
      task: { ...base, status: { state: 'TASK_STATE_SUBMITTED' } },
    });
    repository.acceptTaskSnapshot({
      tenantId: 'tenant-a', idempotencyKey: 'stream-working',
      task: { ...base, status: { state: 'TASK_STATE_WORKING' } },
    });
    const events = repository.listTaskEvents({ tenantId: 'tenant-a', taskId: base.id });
    assert.equal(events.length, 2);
    assert.ok(events[1]!.cursor > events[0]!.cursor);
    assert.deepEqual(repository.listTaskEvents({ tenantId: 'tenant-b', taskId: base.id }), []);

    const transport = new InProcessA2AV1Transport(repository, { subscriptionPollMs: 1 });
    transport.registerAgent({
      tenantId: 'tenant-a', agentId: 'agent-a',
      agentCard: {
        name: 'Agent A', description: 'Shared streaming agent.', version: '0.1.0',
        supportedInterfaces: [{ url: 'in-process://agent-a', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }],
        capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
        defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [],
      },
      handler: async () => ({ ...base, status: { state: 'TASK_STATE_WORKING' } }),
    });
    const subscription = transport.subscribeTask({
      tenantId: 'tenant-a', agentId: 'agent-a', taskId: base.id, afterCursor: events[0]!.cursor,
    });
    assert.equal((await subscription.next()).value?.payload.task.status.state, 'TASK_STATE_WORKING');
    await transport.cancelTask({ tenantId: 'tenant-a', agentId: 'agent-a', taskId: base.id, idempotencyKey: 'stream-cancel' });
    assert.equal((await subscription.next()).value?.payload.task.status.state, 'TASK_STATE_CANCELED');
    assert.equal((await subscription.next()).done, true);
  } finally {
    database.close();
  }
});

test('runtime adapter validates untrusted artifacts before calling the existing Hermes loop', async () => {
  let calls = 0;
  const adapter = new A2AV1HermesRuntimeAdapter({
    callAgent: async () => { calls += 1; return { success: true }; },
  }, new A2AV1DeliveryIdentityRegistry(), {
    maxArtifactBytes: 32,
    allowedMimeTypes: ['text/plain'],
    allowedUriProtocols: ['https:'],
  });
  await assert.rejects(adapter.execute({
    ids: { deliveryTaskId: 'delivery-1', a2aTaskId: 'a2a-1', workflowId: 'workflow-1', attemptId: 'attempt-1' },
    agentId: 'agent-a', goal: 'work',
    artifacts: markA2AV1ArtifactsUntrusted([{
      artifactId: 'unsafe', parts: [{ text: 'Bearer secret-token-value', mediaType: 'text/plain' }],
    }]),
  }), /secret/);
  assert.equal(calls, 0);
});

test('framework-agnostic HTTP handler fails auth closed before tenant-scoped reads', async () => {
  const database = new Database(':memory:');
  try {
    const transport = new InProcessA2AV1Transport(new SqliteA2AV1Repository(database));
    const denied = new A2AV1HttpHandler({
      transport, baseUrl: 'https://a2a.example.test', authenticate: async () => undefined,
      cursorSigningKey: 'open-shared-runtime-cursor-key',
    });
    assert.deepEqual(await denied.handle({ method: 'GET', path: '/a2a/v1/tasks/task-1', headers: {} }), {
      status: 401,
      body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'Authentication required', details: [] } },
    });
    const allowed = new A2AV1HttpHandler({
      transport, baseUrl: 'https://a2a.example.test',
      authenticate: async () => ({ tenantId: 'tenant-a', projectId: 'project-a', principalId: 'principal-a' }),
      cursorSigningKey: 'open-shared-runtime-cursor-key',
    });
    assert.equal((await allowed.handle({
      method: 'GET', path: '/a2a/v1/tasks/task-1', headers: { 'A2A-Version': '1.0' },
    })).status, 404);
  } finally {
    database.close();
  }
});

test('HTTP v1 binding negotiates media types and projects a signed ListTasks page', async () => {
  const database = new Database(':memory:');
  try {
    const repository = new SqliteA2AV1Repository(database);
    for (const [id, timestamp] of [['old', '2026-08-13T08:00:00.000Z'], ['new', '2026-08-13T10:00:00.000Z']] as const) {
      repository.acceptTaskSnapshot({
        tenantId: 'tenant-a', idempotencyKey: `list-${id}`,
        task: {
          id: `task-${id}`, contextId: 'context-list', status: { state: 'TASK_STATE_SUBMITTED', timestamp },
          history: [
            { messageId: `${id}-one`, role: 'ROLE_USER', parts: [{ text: 'one' }] },
            { messageId: `${id}-two`, role: 'ROLE_USER', parts: [{ text: 'two' }] },
          ],
          artifacts: [{ artifactId: `${id}-artifact`, parts: [{ text: 'result' }] }],
          metadata: { devAgentTeams: { agentId: 'agent-a' } },
        },
      });
    }
    const handler = new A2AV1HttpHandler({
      transport: new InProcessA2AV1Transport(repository), baseUrl: 'https://a2a.example.test',
      authenticate: async () => ({ tenantId: 'tenant-a', projectId: 'project-a', principalId: 'principal-a' }),
      cursorSigningKey: 'open-shared-runtime-cursor-key',
    });
    assert.equal((await handler.handle({
      method: 'GET', path: '/a2a/v1/agents/agent-a/tasks', headers: { accept: 'application/json' },
    })).status, 400);
    const response = await handler.handle({
      method: 'GET',
      path: '/a2a/v1/agents/agent-a/tasks?statusTimestampAfter=2026-08-13T09%3A00%3A00.000Z&historyLength=1&includeArtifacts=false&pageSize=1',
      headers: { 'A2A-Version': '1.0', accept: 'application/a2a+json' },
    });
    assert.equal(response.status, 200);
    const body = response.body as { tasks: Array<{ id: string; history?: unknown[]; artifacts?: unknown[] }> };
    assert.equal(body.tasks[0]?.id, 'task-new');
    assert.equal(body.tasks[0]?.history?.length, 1);
    assert.equal(body.tasks[0]?.artifacts, undefined);
  } finally {
    database.close();
  }
});
