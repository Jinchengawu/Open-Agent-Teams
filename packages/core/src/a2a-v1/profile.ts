import { A2A_V1_PROTOCOL_VERSION, type A2AV1ObjectKind } from './types.js';

/**
 * A deliberately bounded compatibility target for DAT-C2-001/002.
 *
 * This is not a claim of full A2A v1 conformance. Transport bindings,
 * operations, persistence, streaming, production push wiring, security schemes and
 * official SDK interoperability remain separate delivery gates.
 */
export const A2A_V1_CONFORMANCE_PROFILE = Object.freeze({
  id: 'dev-agent-teams-a2a-v1-core-contract',
  protocolVersion: A2A_V1_PROTOCOL_VERSION,
  maturity: 'contract-slice' as const,
  fullComplianceClaimed: false as const,
  representation: 'ProtoJSON-compatible field names' as const,
  supportedObjects: Object.freeze([
    'task',
    'message',
    'part',
    'artifact',
    'agentCard',
  ] satisfies A2AV1ObjectKind[]),
  validatedFieldsByObject: Object.freeze({
    task: ['id', 'contextId', 'status', 'artifacts', 'history', 'metadata'],
    message: ['messageId', 'contextId', 'taskId', 'role', 'parts', 'metadata', 'extensions', 'referenceTaskIds'],
    part: ['text', 'raw', 'url', 'data', 'metadata', 'filename', 'mediaType'],
    artifact: ['artifactId', 'name', 'description', 'parts', 'metadata', 'extensions'],
    agentCard: [
      'name',
      'description',
      'supportedInterfaces',
      'version',
      'documentationUrl',
      'capabilities',
      'defaultInputModes',
      'defaultOutputModes',
      'skills',
      'iconUrl',
    ],
  }),
  availableInfrastructure: Object.freeze([
    'sqlite-task-snapshot-repository',
    'tenant-scoped-inbox-dedupe',
    'transactional-outbox-storage',
    'tenant-scoped-leased-outbox-dispatcher',
    'in-process-send-stream-get-list-cancel-subscribe-transport',
    'sqlite-persistent-task-event-cursor',
    'http-sse-send-stream-and-task-subscribe',
    'agent-card-truthfulness-validation',
    'framework-agnostic-authenticated-http-json-handler',
    'hermes-team-pipeline-runtime-adapter-ports',
    'official-js-sdk-1.0.1-model-fixture-interoperability',
    'bounded-jsonrpc-send-stream-get-list-cancel-subscribe-binding',
    'opt-in-scoped-push-config-and-durable-delivery',
    'scoped-opaque-task-list-pagination',
    'hmac-protected-task-list-cursor',
    'semantic-rest-error-envelope',
    'explicit-a2a-version-rejection',
    'http-json-and-sse-content-negotiation',
    'list-task-timestamp-history-and-artifact-projection',
    'server-owned-callback-policy-and-ssrf-denial',
  ]),
  excludedCapabilities: Object.freeze([
    'transport-bindings',
    'official-http-binding-conformance',
    'server-operations',
    'official-push-binding-conformance',
    'json-rpc-binding',
    'grpc-binding',
    'production-push-worker-wiring',
    'extended-agent-card',
    'agent-card-signatures',
    'security-scheme-negotiation',
    'production-runtime-adapter-wiring',
    'official-sdk-interoperability',
    'default-public-a2a-network-endpoint',
  ]),
  normativeReference: 'https://github.com/a2aproject/A2A/blob/v1.0.0/specification/a2a.proto',
});
