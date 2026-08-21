import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { A2AV1JsonRpcHandler, InProcessA2AV1Transport, SqliteA2AV1Repository } from './index.js';

test('bounded JSON-RPC v1 handler maps core operations and fails Push closed', async () => {
  const database = new Database(':memory:');
  try {
    const transport = new InProcessA2AV1Transport(new SqliteA2AV1Repository(database));
    transport.registerAgent({
      tenantId: 'tenant-a', agentId: 'agent-a',
      agentCard: { name: 'A', description: 'test', version: '1', supportedInterfaces: [{ url: 'in-process://agent-a', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }], capabilities: { streaming: true, pushNotifications: false }, defaultInputModes: ['text/plain'], defaultOutputModes: ['application/json'], skills: [] },
      handler: async (input) => ({ id: input.taskId, contextId: input.contextId, status: { state: 'TASK_STATE_WORKING' }, history: [input.message], artifacts: [], metadata: { devAgentTeams: { agentId: 'agent-a' } } }),
    });
    const handler = new A2AV1JsonRpcHandler({
      transport, cursorSigningKey: 'open-jsonrpc-test-key',
      authenticate: async () => ({ tenantId: 'tenant-a', projectId: 'project-a', principalId: 'principal-a' }),
    });
    const call = (method: string, params: Record<string, unknown>, id: number) => handler.handle({
      method: 'POST', path: '/a2a/v1/agents/agent-a/jsonrpc',
      headers: { 'A2A-Version': '1.0', 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id, method, params },
    });
    const sent = await call('SendMessage', { message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'run' }] } }, 1);
    const taskId = (sent.body as { result: { task: { id: string } } }).result.task.id;
    assert.equal((await call('GetTask', { id: taskId }, 2)).status, 200);
    assert.equal(((await call('ListTasks', {}, 3)).body as { result: { totalSize: number } }).result.totalSize, 1);
    assert.equal(((await call('CancelTask', { id: taskId }, 4)).body as { result: { status: { state: string } } }).result.status.state, 'TASK_STATE_CANCELED');
    assert.equal(((await call('CreateTaskPushNotificationConfig', {}, 5)).body as { error: { code: number } }).error.code, -32003);
  } finally { database.close(); }
});
