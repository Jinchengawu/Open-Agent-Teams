export enum MessageType {
  TASK = 'task',
  RESULT = 'result',
  QUERY = 'query',
  RESPONSE = 'response',
  STATUS = 'status',
  ERROR = 'error',
  BROADCAST = 'broadcast',
}

export interface AgentMessageEnvelope {
  id: string;
  from: string;
  to: string;
  sessionId: string;
  type: MessageType;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

export interface AgentRegistration {
  id: string;
  label: string;
  host: string;
  port: number;
  capabilities: string[];
  healthEndpoint: string;
  messageEndpoint: string;
}
