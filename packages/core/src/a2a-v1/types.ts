export const A2A_V1_PROTOCOL_VERSION = '1.0' as const;

export const A2A_V1_TASK_STATES = [
  'TASK_STATE_UNSPECIFIED',
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
] as const;

export type A2AV1TaskState = typeof A2A_V1_TASK_STATES[number];
export type A2AV1Role = 'ROLE_UNSPECIFIED' | 'ROLE_USER' | 'ROLE_AGENT';

export type A2AV1Part = {
  text?: string;
  raw?: string;
  url?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  filename?: string;
  mediaType?: string;
};

export interface A2AV1Message {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: A2AV1Role;
  parts: A2AV1Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

export interface A2AV1Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2AV1Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

export interface A2AV1TaskStatus {
  state: A2AV1TaskState;
  message?: A2AV1Message;
  timestamp?: string;
}

export interface A2AV1Task {
  id: string;
  contextId?: string;
  status: A2AV1TaskStatus;
  artifacts?: A2AV1Artifact[];
  history?: A2AV1Message[];
  metadata?: Record<string, unknown>;
}

export interface A2AV1AgentInterface {
  url: string;
  protocolBinding: string;
  tenant?: string;
  protocolVersion: typeof A2A_V1_PROTOCOL_VERSION;
}

export interface A2AV1AgentCard {
  name: string;
  description: string;
  supportedInterfaces: A2AV1AgentInterface[];
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    extendedAgentCard?: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
  documentationUrl?: string;
  iconUrl?: string;
}

export type A2AV1ObjectKind = 'task' | 'message' | 'part' | 'artifact' | 'agentCard';

export interface A2AV1ValidationIssue {
  path: string;
  message: string;
}

export type A2AV1ValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: A2AV1ValidationIssue[] };
