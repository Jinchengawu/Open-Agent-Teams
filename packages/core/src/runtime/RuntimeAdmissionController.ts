export interface RuntimeAdmissionLimits {
  maxGlobal?: number;
  maxPerAgent?: number;
  maxPerModel?: number;
  maxPerSession?: number;
  maxQueueDepth?: number;
  maxQueueWaitMs?: number;
}

export interface RuntimeAdmissionRequest {
  agentId: string;
  modelId?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface RuntimeAdmissionSnapshot {
  activeGlobal: number;
  queued: number;
  maxGlobal: number;
  maxPerAgent: number;
  maxPerModel: number;
  maxPerSession: number;
  maxQueueDepth: number;
  maxQueueWaitMs: number;
  activeByAgent: Record<string, number>;
  activeByModel: Record<string, number>;
  activeBySession: Record<string, number>;
}

type Release = () => void;

interface QueuedAdmission {
  request: RuntimeAdmissionRequest;
  resolve: (release: Release) => void;
  reject: (error: RuntimeAdmissionError) => void;
  abort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export class RuntimeAdmissionError extends Error {
  constructor(
    readonly code: 'INVALID_ADMISSION_LIMIT' | 'BACKPRESSURE_QUEUE_FULL' | 'ADMISSION_ABORTED' | 'ADMISSION_TIMED_OUT',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeAdmissionError';
  }
}

/** Shared bounded admission boundary for every Agent execution path. */
export class RuntimeAdmissionController {
  private readonly limits: Required<RuntimeAdmissionLimits>;
  private activeGlobal = 0;
  private readonly activeByAgent = new Map<string, number>();
  private readonly activeByModel = new Map<string, number>();
  private readonly activeBySession = new Map<string, number>();
  private readonly queue: QueuedAdmission[] = [];

  constructor(limits: RuntimeAdmissionLimits = {}) {
    this.limits = {
      maxGlobal: validatePositive('maxGlobal', limits.maxGlobal ?? 5),
      maxPerAgent: validatePositive('maxPerAgent', limits.maxPerAgent ?? 2),
      maxPerModel: validatePositive('maxPerModel', limits.maxPerModel ?? 3),
      maxPerSession: validatePositive('maxPerSession', limits.maxPerSession ?? 2),
      maxQueueDepth: validateNonNegative('maxQueueDepth', limits.maxQueueDepth ?? 100),
      maxQueueWaitMs: validatePositive('maxQueueWaitMs', limits.maxQueueWaitMs ?? 30_000),
    };
  }

  acquire(request: RuntimeAdmissionRequest): Promise<Release> {
    if (!request.agentId?.trim()) {
      return Promise.reject(new RuntimeAdmissionError('INVALID_ADMISSION_LIMIT', 'agentId is required'));
    }
    if (request.signal?.aborted) {
      return Promise.reject(new RuntimeAdmissionError('ADMISSION_ABORTED', 'Agent admission was aborted before enqueue'));
    }
    if (this.canAdmit(request)) return Promise.resolve(this.admit(request));
    if (this.queue.length >= this.limits.maxQueueDepth) {
      return Promise.reject(new RuntimeAdmissionError(
        'BACKPRESSURE_QUEUE_FULL',
        `Agent admission queue is full (${this.queue.length}/${this.limits.maxQueueDepth})`,
      ));
    }

    return new Promise<Release>((resolve, reject) => {
      const queued: QueuedAdmission = { request, resolve, reject };
      if (request.signal) {
        queued.abort = () => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) this.queue.splice(index, 1);
          if (queued.timeout) clearTimeout(queued.timeout);
          reject(new RuntimeAdmissionError('ADMISSION_ABORTED', 'Queued Agent admission was aborted'));
        };
        request.signal.addEventListener('abort', queued.abort, { once: true });
      }
      queued.timeout = setTimeout(() => {
        const index = this.queue.indexOf(queued);
        if (index < 0) return;
        this.queue.splice(index, 1);
        if (queued.abort && request.signal) request.signal.removeEventListener('abort', queued.abort);
        reject(new RuntimeAdmissionError(
          'ADMISSION_TIMED_OUT',
          `Agent admission exceeded the ${this.limits.maxQueueWaitMs}ms queue wait limit`,
        ));
      }, this.limits.maxQueueWaitMs);
      this.queue.push(queued);
    });
  }

  snapshot(): RuntimeAdmissionSnapshot {
    return {
      activeGlobal: this.activeGlobal,
      queued: this.queue.length,
      ...this.limits,
      activeByAgent: Object.fromEntries(this.activeByAgent),
      activeByModel: Object.fromEntries(this.activeByModel),
      activeBySession: Object.fromEntries(this.activeBySession),
    };
  }

  private canAdmit(request: RuntimeAdmissionRequest): boolean {
    if (this.activeGlobal >= this.limits.maxGlobal) return false;
    if ((this.activeByAgent.get(request.agentId) ?? 0) >= this.limits.maxPerAgent) return false;
    if (request.modelId && (this.activeByModel.get(request.modelId) ?? 0) >= this.limits.maxPerModel) return false;
    return !request.sessionId
      || (this.activeBySession.get(request.sessionId) ?? 0) < this.limits.maxPerSession;
  }

  private admit(request: RuntimeAdmissionRequest): Release {
    this.activeGlobal += 1;
    increment(this.activeByAgent, request.agentId);
    if (request.modelId) increment(this.activeByModel, request.modelId);
    if (request.sessionId) increment(this.activeBySession, request.sessionId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeGlobal -= 1;
      decrement(this.activeByAgent, request.agentId);
      if (request.modelId) decrement(this.activeByModel, request.modelId);
      if (request.sessionId) decrement(this.activeBySession, request.sessionId);
      this.drain();
    };
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const queued = this.queue[0];
      if (!this.canAdmit(queued.request)) return;
      this.queue.shift();
      if (queued.abort && queued.request.signal) queued.request.signal.removeEventListener('abort', queued.abort);
      if (queued.timeout) clearTimeout(queued.timeout);
      queued.resolve(this.admit(queued.request));
    }
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

function validatePositive(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RuntimeAdmissionError('INVALID_ADMISSION_LIMIT', `${name} must be a positive integer`);
  }
  return value;
}

function validateNonNegative(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RuntimeAdmissionError('INVALID_ADMISSION_LIMIT', `${name} must be a non-negative integer`);
  }
  return value;
}
