import { isAbsolute, normalize } from 'node:path';
import { validateA2AV1 } from './schemas.js';
import type { A2AV1Artifact } from './types.js';

export interface A2AV1DeliveryExecutionIds {
  deliveryTaskId: string;
  a2aTaskId: string;
  workflowId: string;
  attemptId: string;
}

export interface A2AV1DeliveryIdentityBinding extends Omit<A2AV1DeliveryExecutionIds, 'attemptId'> {
  attemptIds: string[];
  domainReferences?: A2AV1DomainReferences;
}

export interface A2AV1DomainReferences {
  meetingId?: string;
  documentId?: string;
  kanbanTaskId?: string;
  workflowId?: string;
  managedArtifactId?: string;
}

export class A2AV1DeliveryIdentityRegistry {
  private readonly byDelivery = new Map<string, A2AV1DeliveryIdentityBinding>();
  private readonly byA2A = new Map<string, A2AV1DeliveryIdentityBinding>();
  private readonly byWorkflow = new Map<string, A2AV1DeliveryIdentityBinding>();
  private readonly attempts = new Map<string, A2AV1DeliveryIdentityBinding>();
  private readonly idKinds = new Map<string, keyof A2AV1DeliveryExecutionIds>();

  bind(ids: A2AV1DeliveryExecutionIds, domainReferences?: A2AV1DomainReferences): A2AV1DeliveryExecutionIds {
    const values = Object.values(ids);
    if (values.some((value) => !value?.trim())) throw new Error('All delivery execution identifiers are required');
    if (new Set(values).size !== values.length) throw new Error('Delivery execution identifiers must be distinct across ID kinds');
    for (const [kind, value] of Object.entries(ids) as Array<[keyof A2AV1DeliveryExecutionIds, string]>) {
      const existingKind = this.idKinds.get(value);
      if (existingKind && existingKind !== kind) {
        throw new Error(`Delivery identifier was reused as a different ID kind: ${value} (${existingKind} -> ${kind})`);
      }
    }
    const candidates = [
      this.byDelivery.get(ids.deliveryTaskId),
      this.byA2A.get(ids.a2aTaskId),
      this.byWorkflow.get(ids.workflowId),
    ].filter((binding): binding is A2AV1DeliveryIdentityBinding => Boolean(binding));
    const binding = candidates[0];
    if (candidates.some((candidate) => candidate !== binding)
      || (binding && !sameRootBinding(binding, ids))) {
      throw new Error('Delivery execution binding conflict');
    }
    const attemptBinding = this.attempts.get(ids.attemptId);
    if (attemptBinding && (!binding || attemptBinding !== binding)) {
      throw new Error(`attemptId is already bound to another delivery execution: ${ids.attemptId}`);
    }
    const root = binding ?? {
      deliveryTaskId: ids.deliveryTaskId,
      a2aTaskId: ids.a2aTaskId,
      workflowId: ids.workflowId,
      attemptIds: [],
      ...(domainReferences ? { domainReferences: { ...domainReferences } } : {}),
    };
    if (binding && domainReferences) {
      for (const [kind, value] of Object.entries(domainReferences)) {
        const current = binding.domainReferences?.[kind as keyof A2AV1DomainReferences];
        if (current && current !== value) throw new Error(`Domain identity binding conflict for ${kind}`);
      }
      binding.domainReferences = { ...binding.domainReferences, ...domainReferences };
    }
    if (!binding) {
      this.byDelivery.set(ids.deliveryTaskId, root);
      this.byA2A.set(ids.a2aTaskId, root);
      this.byWorkflow.set(ids.workflowId, root);
      this.idKinds.set(ids.deliveryTaskId, 'deliveryTaskId');
      this.idKinds.set(ids.a2aTaskId, 'a2aTaskId');
      this.idKinds.set(ids.workflowId, 'workflowId');
    }
    if (!attemptBinding) {
      root.attemptIds.push(ids.attemptId);
      this.attempts.set(ids.attemptId, root);
      this.idKinds.set(ids.attemptId, 'attemptId');
    }
    return { ...ids };
  }

  resolveByA2ATaskId(a2aTaskId: string): A2AV1DeliveryIdentityBinding | undefined {
    const binding = this.byA2A.get(a2aTaskId);
    return binding ? {
      ...binding,
      attemptIds: [...binding.attemptIds],
      ...(binding.domainReferences ? { domainReferences: { ...binding.domainReferences } } : {}),
    } : undefined;
  }
}

function sameRootBinding(binding: A2AV1DeliveryIdentityBinding, ids: A2AV1DeliveryExecutionIds): boolean {
  return binding.deliveryTaskId === ids.deliveryTaskId
    && binding.a2aTaskId === ids.a2aTaskId
    && binding.workflowId === ids.workflowId;
}

export interface A2AV1UntrustedArtifact {
  trust: 'untrusted';
  artifact: A2AV1Artifact;
}

export interface A2AV1ValidatedArtifact {
  trust: 'validated';
  artifact: A2AV1Artifact;
}

export interface A2AV1ArtifactAdmissionPolicy {
  maxArtifactBytes: number;
  allowedMimeTypes: readonly string[];
  allowedUriProtocols: readonly string[];
}

const DEFAULT_ADMISSION_POLICY: A2AV1ArtifactAdmissionPolicy = {
  maxArtifactBytes: 1_048_576,
  allowedMimeTypes: ['text/plain', 'application/json', 'application/octet-stream'],
  allowedUriProtocols: ['https:'],
};

export function markA2AV1ArtifactsUntrusted(artifacts: readonly A2AV1Artifact[]): A2AV1UntrustedArtifact[] {
  return artifacts.map((artifact) => ({ trust: 'untrusted', artifact: structuredClone(artifact) }));
}

export function admitA2AV1Artifacts(
  inputs: readonly A2AV1UntrustedArtifact[],
  policy: Partial<A2AV1ArtifactAdmissionPolicy> = {},
): A2AV1ValidatedArtifact[] {
  const effective = { ...DEFAULT_ADMISSION_POLICY, ...policy };
  const mimeTypes = new Set(effective.allowedMimeTypes);
  const protocols = new Set(effective.allowedUriProtocols);
  return inputs.map((input) => {
    if (input.trust !== 'untrusted') throw new Error('A2A input artifact must be explicitly marked untrusted');
    const shape = validateA2AV1('artifact', input.artifact);
    if (!shape.valid) throw new Error(`A2A input artifact is invalid: ${shape.issues.map((issue) => issue.path).join(', ')}`);
    let bytes = 0;
    for (const part of input.artifact.parts) {
      const mimeType = part.mediaType ?? (part.text !== undefined ? 'text/plain' : part.data !== undefined ? 'application/json' : 'application/octet-stream');
      if (!mimeTypes.has(mimeType)) throw new Error(`Artifact MIME is not allowed: ${mimeType}`);
      if (part.filename && unsafePath(part.filename)) throw new Error(`Artifact path is not allowed: ${part.filename}`);
      if (part.url) {
        let url: URL;
        try { url = new URL(part.url); } catch { throw new Error('Artifact URI is invalid'); }
        if (!protocols.has(url.protocol) || url.username || url.password) throw new Error(`Artifact URI protocol or credentials are not allowed: ${url.protocol}`);
      }
      const serialized = part.text ?? part.raw ?? (part.url ? part.url : JSON.stringify(part.data ?? ''));
      bytes += Buffer.byteLength(serialized, 'utf8');
      if (containsSecret(part)) throw new Error('Artifact contains a potential secret');
    }
    if (bytes > effective.maxArtifactBytes) throw new Error(`Artifact size exceeds ${effective.maxArtifactBytes} bytes`);
    return { trust: 'validated', artifact: structuredClone(input.artifact) };
  });
}

function unsafePath(value: string): boolean {
  const normalized = normalize(value).replaceAll('\\', '/');
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || normalized === '..' || normalized.startsWith('../');
}

function containsSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\bAKIA[0-9A-Z]{16}\b|(?:api[_-]?key|secret|password)\s*[=:]\s*["']?[^\s"']{8,}/i.test(text);
}

export class A2AV1UnsupportedRuntimeCapabilityError extends Error {
  readonly code = 'A2A_RUNTIME_CAPABILITY_UNSUPPORTED';
  constructor(capability: string) {
    super(`Runtime adapter capability is not supported: ${capability}`);
    this.name = 'A2AV1UnsupportedRuntimeCapabilityError';
  }
}

export interface A2AV1RuntimeAdapterCapabilities { cancel: boolean }

export interface A2AV1HermesLoopPort {
  callAgent(agentId: string, goal: string, options?: { sessionId?: string; signal?: AbortSignal }): Promise<unknown>;
}

export interface A2AV1TeamLoopPort {
  runTeam(goal: string, options?: { sessionId?: string; involvedAgents?: readonly string[] }): Promise<unknown>;
}

export interface A2AV1PipelineLoopPort {
  execute(pipelineId: string, initialInput?: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string }>;
  start?(pipelineId: string, initialInput?: Record<string, unknown>, options?: Record<string, unknown>): { id: string };
  cancel?(instanceId: string, reason?: string): Promise<void>;
}

interface BaseInvocation {
  ids: A2AV1DeliveryExecutionIds;
  goal: string;
  artifacts: A2AV1UntrustedArtifact[];
}

export class A2AV1HermesRuntimeAdapter {
  readonly capabilities = Object.freeze({ cancel: true });
  private readonly controllers = new Map<string, AbortController>();
  constructor(
    private readonly loop: A2AV1HermesLoopPort,
    private readonly identities: A2AV1DeliveryIdentityRegistry,
    private readonly policy: Partial<A2AV1ArtifactAdmissionPolicy> = {},
  ) {}

  async execute(input: BaseInvocation & { agentId: string }): Promise<{ ids: A2AV1DeliveryExecutionIds; result: unknown; admittedArtifacts: A2AV1ValidatedArtifact[] }> {
    const bound = this.identities.bind(input.ids);
    const admittedArtifacts = admitA2AV1Artifacts(input.artifacts, this.policy);
    const controller = new AbortController();
    if (this.controllers.has(bound.attemptId)) throw new Error(`attemptId is already running: ${bound.attemptId}`);
    this.controllers.set(bound.attemptId, controller);
    try {
      const result = await this.loop.callAgent(input.agentId, appendArtifacts(input.goal, admittedArtifacts), {
        sessionId: bound.workflowId,
        signal: controller.signal,
      });
      return { ids: bound, result, admittedArtifacts };
    } finally {
      this.controllers.delete(bound.attemptId);
    }
  }

  async cancel(attemptId: string): Promise<void> {
    const controller = this.controllers.get(attemptId);
    if (!controller) throw new Error(`Active Hermes attempt not found: ${attemptId}`);
    controller.abort(new Error('A2A delivery cancelled'));
  }
}

export class A2AV1TeamRuntimeAdapter {
  readonly capabilities = Object.freeze({ cancel: false });
  constructor(
    private readonly loop: A2AV1TeamLoopPort,
    private readonly identities: A2AV1DeliveryIdentityRegistry,
    private readonly policy: Partial<A2AV1ArtifactAdmissionPolicy> = {},
  ) {}

  async execute(input: BaseInvocation & { involvedAgents?: readonly string[] }): Promise<{ ids: A2AV1DeliveryExecutionIds; result: unknown; admittedArtifacts: A2AV1ValidatedArtifact[] }> {
    const bound = this.identities.bind(input.ids);
    const admittedArtifacts = admitA2AV1Artifacts(input.artifacts, this.policy);
    const result = await this.loop.runTeam(appendArtifacts(input.goal, admittedArtifacts), {
      sessionId: bound.workflowId,
      involvedAgents: input.involvedAgents,
    });
    return { ids: bound, result, admittedArtifacts };
  }

  async cancel(_attemptId: string): Promise<never> {
    throw new A2AV1UnsupportedRuntimeCapabilityError('cancel');
  }
}

export class A2AV1PipelineRuntimeAdapter {
  readonly capabilities: A2AV1RuntimeAdapterCapabilities;
  private readonly instanceByAttempt = new Map<string, string>();
  constructor(
    private readonly loop: A2AV1PipelineLoopPort,
    private readonly identities: A2AV1DeliveryIdentityRegistry,
    private readonly policy: Partial<A2AV1ArtifactAdmissionPolicy> = {},
  ) {
    this.capabilities = Object.freeze({ cancel: typeof loop.start === 'function' && typeof loop.cancel === 'function' });
  }

  async execute(input: BaseInvocation & { pipelineId: string }): Promise<{ ids: A2AV1DeliveryExecutionIds; result: unknown; admittedArtifacts: A2AV1ValidatedArtifact[] }> {
    const bound = this.identities.bind(input.ids);
    const admittedArtifacts = admitA2AV1Artifacts(input.artifacts, this.policy);
    const initialInput = {
      goal: input.goal,
      a2a: { ids: bound, artifacts: admittedArtifacts },
    };
    const result = this.capabilities.cancel
      ? this.loop.start!(input.pipelineId, initialInput, {})
      : await this.loop.execute(input.pipelineId, initialInput, {});
    this.instanceByAttempt.set(bound.attemptId, result.id);
    return { ids: bound, result, admittedArtifacts };
  }

  async cancel(attemptId: string): Promise<void> {
    if (!this.capabilities.cancel || !this.loop.cancel) throw new A2AV1UnsupportedRuntimeCapabilityError('cancel');
    const instanceId = this.instanceByAttempt.get(attemptId);
    if (!instanceId) throw new Error(`Pipeline instance for attempt not found: ${attemptId}`);
    await this.loop.cancel(instanceId, 'A2A delivery cancelled');
  }
}

function appendArtifacts(goal: string, artifacts: A2AV1ValidatedArtifact[]): string {
  if (artifacts.length === 0) return goal;
  return `${goal}\n\nValidated A2A input artifacts:\n${JSON.stringify(artifacts.map(({ artifact }) => artifact))}`;
}
