import { createHash } from 'node:crypto';
import { validateA2AV1AgentCardTruthfulness } from './agent-card-truthfulness.js';
import { validateA2AV1 } from './schemas.js';
import type { SqliteA2AV1Repository } from './sqlite-repository.js';
import {
  A2A_V1_IMPLEMENTED_OPERATIONS,
  type A2AV1AgentHandler,
  type A2AV1CancelTaskCommand,
  type A2AV1GetTaskQuery,
  type A2AV1ListTasksQuery,
  type A2AV1SendMessageCommand,
  type A2AV1SubscribeTaskQuery,
  type A2AV1TaskStreamEvent,
  type A2AV1Transport,
  type A2AV1TransportCapabilities,
} from './transport.js';
import type { A2AV1AgentCard, A2AV1Message, A2AV1Task } from './types.js';

interface Registration {
  agentCard: A2AV1AgentCard;
  handler: A2AV1AgentHandler;
}

export class InProcessA2AV1Transport implements A2AV1Transport {
  readonly capabilities: A2AV1TransportCapabilities;

  private readonly registrations = new Map<string, Registration>();
  private readonly registrationFallbackTenantId?: string;
  private readonly subscriptionPollMs: number;

  constructor(
    private readonly repository: SqliteA2AV1Repository,
    options: { interfaceUrl?: string; registrationFallbackTenantId?: string; subscriptionPollMs?: number } = {},
  ) {
    this.registrationFallbackTenantId = options.registrationFallbackTenantId;
    this.subscriptionPollMs = options.subscriptionPollMs ?? 25;
    this.capabilities = Object.freeze({
      protocolVersion: '1.0',
      protocolBinding: 'IN_PROCESS',
      interfaceUrl: options.interfaceUrl ?? 'in-process://{agentId}',
      operations: A2A_V1_IMPLEMENTED_OPERATIONS,
      streaming: true,
      pushNotifications: false,
      subscribe: true,
    });
  }

  registerAgent(input: {
    tenantId: string;
    agentId: string;
    agentCard: A2AV1AgentCard;
    handler: A2AV1AgentHandler;
  }): () => void {
    const truth = validateA2AV1AgentCardTruthfulness({
      agentId: input.agentId,
      agentCard: input.agentCard,
      transportCapabilities: this.capabilities,
      exposedOperations: [...this.capabilities.operations],
    });
    if (!truth.valid) {
      throw new Error(`A2A AgentCard overclaims this Transport: ${truth.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    }
    const key = registrationKey(input.tenantId, input.agentId);
    if (this.registrations.has(key)) {
      throw new Error(`A2A Agent is already registered: ${input.tenantId}/${input.agentId}`);
    }
    this.registrations.set(key, { agentCard: structuredClone(input.agentCard), handler: input.handler });
    return () => this.registrations.delete(key);
  }

  async getAgentCard(tenantId: string, agentId: string): Promise<A2AV1AgentCard | undefined> {
    const card = this.registrations.get(registrationKey(tenantId, agentId))?.agentCard;
    return card ? structuredClone(card) : undefined;
  }

  async sendMessage(command: A2AV1SendMessageCommand): Promise<A2AV1Task> {
    const registration = this.requireRegistration(command.tenantId, command.agentId);
    const validation = validateA2AV1('message', command.message);
    if (!validation.valid) throw new Error(`A2A v1 Message is invalid: ${validation.issues.map((issue) => issue.path).join(', ')}`);
    if (command.message.role !== 'ROLE_USER') throw new Error('sendMessage requires ROLE_USER');
    if (command.message.taskId) throw new Error('This Transport slice supports new Task messages only');

    const stableSuffix = stableId(command.tenantId, command.agentId, command.idempotencyKey);
    const taskId = `a2a-task-${stableSuffix}`;
    const contextId = command.message.contextId || `a2a-context-${stableSuffix}`;
    const message: A2AV1Message = { ...command.message, contextId, taskId };
    const submitted: A2AV1Task = {
      id: taskId,
      contextId,
      status: { state: 'TASK_STATE_SUBMITTED' },
      history: [message],
      artifacts: [],
      metadata: { devAgentTeams: { agentId: command.agentId } },
    };
    const receipt = this.repository.acceptTaskSnapshot({
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      task: submitted,
    });
    if (!receipt.applied) {
      const existing = this.repository.getTask(command.tenantId, taskId);
      if (existing && existing.status.state !== 'TASK_STATE_SUBMITTED') return existing;
    }

    const handlerResult = await registration.handler({
      tenantId: command.tenantId,
      trustedProjectId: command.trustedProjectId,
      taskId,
      contextId,
      idempotencyKey: command.idempotencyKey,
      message,
    });
    const result: A2AV1Task = {
      ...handlerResult,
      metadata: {
        ...handlerResult.metadata,
        devAgentTeams: { agentId: command.agentId },
      },
    };
    assertHandlerTaskBinding(result, taskId, contextId);
    this.repository.acceptTaskSnapshot({
      tenantId: command.tenantId,
      idempotencyKey: `${command.idempotencyKey}:result`,
      task: result,
    });
    return structuredClone(result);
  }

  async *sendMessageStream(command: A2AV1SendMessageCommand): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined> {
    const task = await this.sendMessage(command);
    for (const event of this.repository.listTaskEvents({ tenantId: command.tenantId, taskId: task.id })) {
      yield { cursor: event.cursor, payload: { task: structuredClone(event.task) } };
    }
  }

  async getTask(query: A2AV1GetTaskQuery): Promise<A2AV1Task | undefined> {
    const task = this.repository.getTask(query.tenantId, query.taskId);
    return task ? structuredClone(task) : undefined;
  }

  async listTasks(query: A2AV1ListTasksQuery): Promise<A2AV1Task[]> {
    const states = query.states ? new Set(query.states) : undefined;
    return this.repository.listTasks(query.tenantId)
      .filter((task) => !query.agentId || taskAgentId(task) === query.agentId)
      .filter((task) => !query.contextId || task.contextId === query.contextId)
      .filter((task) => !states || states.has(task.status.state))
      .map((task) => structuredClone(task));
  }

  async cancelTask(command: A2AV1CancelTaskCommand): Promise<A2AV1Task> {
    const current = this.repository.getTask(command.tenantId, command.taskId);
    const registration = this.findRegistration(command.tenantId, command.agentId);
    if (!registration || !current || taskAgentId(current) !== command.agentId) {
      throw new Error(`A2A Task not found: ${command.tenantId}/${command.taskId}`);
    }
    if (current.status.state === 'TASK_STATE_CANCELED') return structuredClone(current);
    const cancelled: A2AV1Task = {
      ...current,
      status: { state: 'TASK_STATE_CANCELED' },
    };
    this.repository.acceptTaskSnapshot({
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      task: cancelled,
    });
    return cancelled;
  }

  async *subscribeTask(query: A2AV1SubscribeTaskQuery): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined> {
    const registration = this.findRegistration(query.tenantId, query.agentId);
    let current = this.repository.getTask(query.tenantId, query.taskId);
    if (!registration || !current || taskAgentId(current) !== query.agentId) {
      throw new Error(`A2A Task not found: ${query.tenantId}/${query.taskId}`);
    }
    let cursor = query.afterCursor ?? 0;
    while (!query.signal?.aborted) {
      const events = this.repository.listTaskEvents({
        tenantId: query.tenantId,
        taskId: query.taskId,
        afterCursor: cursor,
      });
      for (const event of events) {
        cursor = event.cursor;
        current = event.task;
        yield { cursor, payload: { task: structuredClone(event.task) } };
      }
      if (isTerminalTask(current)) return;
      if (!await waitForPoll(this.subscriptionPollMs, query.signal)) return;
    }
  }

  private requireRegistration(tenantId: string, agentId: string): Registration {
    const registration = this.findRegistration(tenantId, agentId);
    if (!registration) throw new Error(`A2A Agent is not registered: ${tenantId}/${agentId}`);
    return registration;
  }

  private findRegistration(tenantId: string, agentId: string): Registration | undefined {
    return this.registrations.get(registrationKey(tenantId, agentId))
      ?? (this.registrationFallbackTenantId
        ? this.registrations.get(registrationKey(this.registrationFallbackTenantId, agentId))
        : undefined);
  }
}

function registrationKey(tenantId: string, agentId: string): string {
  return `${tenantId}\0${agentId}`;
}

function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function assertHandlerTaskBinding(task: A2AV1Task, taskId: string, contextId: string): void {
  const validation = validateA2AV1('task', task);
  if (!validation.valid) throw new Error(`A2A Agent returned an invalid Task: ${validation.issues.map((issue) => issue.path).join(', ')}`);
  if (task.id !== taskId || task.contextId !== contextId) {
    throw new Error('A2A Agent returned a Task with a mismatched taskId or contextId');
  }
}

function taskAgentId(task: A2AV1Task): string | undefined {
  const metadata = task.metadata?.devAgentTeams;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    && typeof (metadata as Record<string, unknown>).agentId === 'string'
    ? String((metadata as Record<string, unknown>).agentId)
    : undefined;
}

function isTerminalTask(task: A2AV1Task): boolean {
  return ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']
    .includes(task.status.state);
}

function waitForPoll(milliseconds: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(true);
    }, milliseconds);
    timeout.unref?.();
    const abort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
