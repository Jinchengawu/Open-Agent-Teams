import type { A2AV1AgentCard, A2AV1Message, A2AV1Task, A2AV1TaskState } from './types.js';

export const A2A_V1_IMPLEMENTED_OPERATIONS = ['send', 'sendStream', 'get', 'list', 'cancel', 'subscribe'] as const;
export type A2AV1ImplementedOperation = typeof A2A_V1_IMPLEMENTED_OPERATIONS[number];

export interface A2AV1TransportCapabilities {
  protocolVersion: '1.0';
  protocolBinding: string;
  interfaceUrl: string;
  operations: readonly A2AV1ImplementedOperation[];
  streaming: boolean;
  pushNotifications: boolean;
  subscribe: boolean;
}

export interface A2AV1SendMessageCommand {
  tenantId: string;
  /** Set only by an authenticated server adapter; never copied from message metadata. */
  trustedProjectId?: string;
  agentId: string;
  idempotencyKey: string;
  message: A2AV1Message;
}

export interface A2AV1GetTaskQuery {
  tenantId: string;
  taskId: string;
}

export interface A2AV1ListTasksQuery {
  tenantId: string;
  agentId?: string;
  contextId?: string;
  states?: A2AV1TaskState[];
}

export interface A2AV1CancelTaskCommand {
  tenantId: string;
  agentId: string;
  taskId: string;
  idempotencyKey: string;
}

export interface A2AV1SubscribeTaskQuery {
  tenantId: string;
  agentId: string;
  taskId: string;
  afterCursor?: number;
  signal?: AbortSignal;
}

export interface A2AV1TaskStreamEvent {
  cursor: number;
  payload: { task: A2AV1Task };
}

export interface A2AV1Transport {
  readonly capabilities: A2AV1TransportCapabilities;
  getAgentCard(tenantId: string, agentId: string): Promise<A2AV1AgentCard | undefined>;
  sendMessage(command: A2AV1SendMessageCommand): Promise<A2AV1Task>;
  sendMessageStream(command: A2AV1SendMessageCommand): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined>;
  getTask(query: A2AV1GetTaskQuery): Promise<A2AV1Task | undefined>;
  listTasks(query: A2AV1ListTasksQuery): Promise<A2AV1Task[]>;
  cancelTask(command: A2AV1CancelTaskCommand): Promise<A2AV1Task>;
  subscribeTask(query: A2AV1SubscribeTaskQuery): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined>;
}

export interface A2AV1AgentHandlerRequest {
  tenantId: string;
  trustedProjectId?: string;
  taskId: string;
  contextId: string;
  idempotencyKey: string;
  message: A2AV1Message;
}

export type A2AV1AgentHandler = (request: A2AV1AgentHandlerRequest) => Promise<A2AV1Task>;
