import { z } from 'zod';
import {
  A2A_V1_PROTOCOL_VERSION,
  A2A_V1_TASK_STATES,
  type A2AV1ObjectKind,
  type A2AV1ValidationResult,
} from './types.js';

const nonEmpty = z.string().trim().min(1);
const metadataSchema = z.record(z.unknown());
const extensionUris = z.array(z.string().url());

export const a2aV1PartSchema = z.object({
  text: z.string().optional(),
  raw: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
  url: z.string().url().optional(),
  data: z.unknown().optional(),
  metadata: metadataSchema.optional(),
  filename: nonEmpty.optional(),
  mediaType: nonEmpty.optional(),
}).passthrough().superRefine((part, context) => {
  const contentFields = ['text', 'raw', 'url', 'data'].filter((field) => Object.hasOwn(part, field));
  if (contentFields.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['content'],
      message: 'Part must contain exactly one of text, raw, url, or data',
    });
  }
});

export const a2aV1MessageSchema: z.ZodTypeAny = z.object({
  messageId: nonEmpty,
  contextId: nonEmpty.optional(),
  taskId: nonEmpty.optional(),
  role: z.enum(['ROLE_UNSPECIFIED', 'ROLE_USER', 'ROLE_AGENT']),
  parts: z.array(a2aV1PartSchema).min(1),
  metadata: metadataSchema.optional(),
  extensions: extensionUris.optional(),
  referenceTaskIds: z.array(nonEmpty).optional(),
}).passthrough().superRefine((message, context) => {
  if (message.role === 'ROLE_AGENT' && !message.contextId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contextId'],
      message: 'ROLE_AGENT messages require contextId in the A2A v1 data model',
    });
  }
});

export const a2aV1ArtifactSchema = z.object({
  artifactId: nonEmpty,
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(a2aV1PartSchema).min(1),
  metadata: metadataSchema.optional(),
  extensions: extensionUris.optional(),
}).passthrough();

export const a2aV1TaskStatusSchema = z.object({
  state: z.enum(A2A_V1_TASK_STATES),
  message: a2aV1MessageSchema.optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
}).passthrough();

export const a2aV1TaskSchema = z.object({
  id: nonEmpty,
  contextId: nonEmpty.optional(),
  status: a2aV1TaskStatusSchema,
  artifacts: z.array(a2aV1ArtifactSchema).optional(),
  history: z.array(a2aV1MessageSchema).optional(),
  metadata: metadataSchema.optional(),
}).passthrough().superRefine((task, context) => {
  const artifactIds = (task.artifacts ?? []).map((artifact) => artifact.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts'],
      message: 'artifactId must be unique within a Task',
    });
  }
});

const a2aV1AgentInterfaceSchema = z.object({
  url: z.string().url(),
  protocolBinding: nonEmpty,
  tenant: nonEmpty.optional(),
  protocolVersion: z.literal(A2A_V1_PROTOCOL_VERSION),
}).passthrough();

const a2aV1AgentSkillSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  description: nonEmpty,
  tags: z.array(nonEmpty).min(1),
  examples: z.array(nonEmpty).optional(),
  inputModes: z.array(nonEmpty).optional(),
  outputModes: z.array(nonEmpty).optional(),
}).passthrough();

export const a2aV1AgentCardSchema = z.object({
  name: nonEmpty,
  description: nonEmpty,
  supportedInterfaces: z.array(a2aV1AgentInterfaceSchema).min(1),
  version: nonEmpty,
  documentationUrl: z.string().url().optional(),
  capabilities: z.object({
    streaming: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    extendedAgentCard: z.boolean().optional(),
  }).passthrough(),
  defaultInputModes: z.array(nonEmpty).min(1),
  defaultOutputModes: z.array(nonEmpty).min(1),
  skills: z.array(a2aV1AgentSkillSchema),
  iconUrl: z.string().url().optional(),
}).passthrough();

const schemas = {
  task: a2aV1TaskSchema,
  message: a2aV1MessageSchema,
  part: a2aV1PartSchema,
  artifact: a2aV1ArtifactSchema,
  agentCard: a2aV1AgentCardSchema,
} satisfies Record<A2AV1ObjectKind, z.ZodTypeAny>;

export function validateA2AV1(kind: A2AV1ObjectKind, value: unknown): A2AV1ValidationResult {
  const result = schemas[kind].safeParse(value);
  if (result.success) return { valid: true, issues: [] };
  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
