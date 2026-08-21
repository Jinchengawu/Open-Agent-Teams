export interface ResilientCallResult {
  success: boolean;
  error?: string | null;
  statusCode?: number;
}

export interface ResiliencePolicy {
  maxAttempts: number;
  retryBudgetMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
}

export interface ResilientCallEvidence<T> {
  result: T;
  attempts: number;
  delaysMs: number[];
  circuitState: 'closed' | 'open' | 'half-open';
}

export interface ExplicitFallback<T extends ResilientCallResult> {
  /** Stable, server-owned policy identifier used in audit evidence. */
  policyId: string;
  /** Fallback circuit and retry scope; must not reuse the primary key. */
  key: string;
  operation: (attempt: number) => Promise<T>;
}

export interface ResilientFallbackEvidence<T extends ResilientCallResult> {
  result: T;
  route: 'primary' | 'fallback';
  policyId?: string;
  primary: ResilientCallEvidence<T>;
  fallback?: ResilientCallEvidence<T>;
}

export class ResilienceRejectedError extends Error {
  constructor(readonly code: 'CIRCUIT_OPEN' | 'RETRY_BUDGET_EXHAUSTED', message: string) {
    super(message);
  }
}

interface CircuitRecord {
  failures: number;
  openedAt: number | null;
}

const DEFAULT_POLICY: ResiliencePolicy = {
  maxAttempts: 3,
  retryBudgetMs: 30_000,
  baseDelayMs: 250,
  maxDelayMs: 5_000,
  circuitFailureThreshold: 5,
  circuitOpenMs: 30_000,
};

function statusFromError(error: string | null | undefined): number | undefined {
  const match = error?.match(/(?:HTTP\s+|status[=: ]+)(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

export function isRetryableCallFailure(result: ResilientCallResult): boolean {
  if (result.success) return false;
  const status = result.statusCode ?? statusFromError(result.error);
  if (status === 429 || (status !== undefined && status >= 500 && status <= 599)) return true;
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|network|fetch failed/i.test(result.error ?? '');
}

export class ResilientCallExecutor {
  private readonly circuits = new Map<string, CircuitRecord>();
  private readonly policy: ResiliencePolicy;

  constructor(
    policy: Partial<ResiliencePolicy> = {},
    private readonly dependencies: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      random?: () => number;
    } = {},
  ) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    if (this.policy.maxAttempts < 1 || this.policy.retryBudgetMs < 0) {
      throw new Error('invalid resilience policy');
    }
  }

  getCircuitState(key: string): 'closed' | 'open' | 'half-open' {
    const record = this.circuits.get(key);
    if (!record?.openedAt) return 'closed';
    const now = (this.dependencies.now ?? Date.now)();
    return now - record.openedAt >= this.policy.circuitOpenMs ? 'half-open' : 'open';
  }

  async execute<T extends ResilientCallResult>(key: string, operation: (attempt: number) => Promise<T>): Promise<ResilientCallEvidence<T>> {
    const initialState = this.getCircuitState(key);
    if (initialState === 'open') {
      throw new ResilienceRejectedError('CIRCUIT_OPEN', `circuit is open for ${key}`);
    }

    const startedAt = (this.dependencies.now ?? Date.now)();
    const delaysMs: number[] = [];
    let lastResult: T | undefined;
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      try {
        lastResult = await operation(attempt);
      } catch (error) {
        lastResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as T;
      }

      if (lastResult.success) {
        this.circuits.delete(key);
        return { result: lastResult, attempts: attempt, delaysMs, circuitState: 'closed' };
      }

      if (!isRetryableCallFailure(lastResult) || attempt === this.policy.maxAttempts) {
        this.recordFailure(key);
        return { result: lastResult, attempts: attempt, delaysMs, circuitState: this.getCircuitState(key) };
      }

      const exponential = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.round(exponential * (0.5 + (this.dependencies.random ?? Math.random)() * 0.5));
      const elapsed = (this.dependencies.now ?? Date.now)() - startedAt;
      if (elapsed + jittered > this.policy.retryBudgetMs) {
        this.recordFailure(key);
        throw new ResilienceRejectedError('RETRY_BUDGET_EXHAUSTED', `retry budget exhausted for ${key}`);
      }
      delaysMs.push(jittered);
      await (this.dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(jittered);
    }
    throw new Error('unreachable');
  }

  /**
   * Runs a fallback only when the caller supplies a stable server policy and
   * the primary returned a retryable infrastructure failure after exhausting
   * its own attempts. Circuit-open/budget rejection and business failures stay
   * fail-closed instead of silently changing execution routes.
   */
  async executeWithFallback<T extends ResilientCallResult>(
    primaryKey: string,
    primaryOperation: (attempt: number) => Promise<T>,
    fallback?: ExplicitFallback<T>,
  ): Promise<ResilientFallbackEvidence<T>> {
    const primary = await this.execute(primaryKey, primaryOperation);
    if (primary.result.success || !isRetryableCallFailure(primary.result) || !fallback) {
      return { result: primary.result, route: 'primary', primary };
    }
    if (!fallback.policyId.trim()) throw new Error('fallback policyId is required');
    if (!fallback.key.trim() || fallback.key === primaryKey) {
      throw new Error('fallback key must be non-empty and distinct from primary key');
    }
    const fallbackEvidence = await this.execute(fallback.key, fallback.operation);
    return {
      result: fallbackEvidence.result,
      route: 'fallback',
      policyId: fallback.policyId,
      primary,
      fallback: fallbackEvidence,
    };
  }

  private recordFailure(key: string): void {
    const record = this.circuits.get(key) ?? { failures: 0, openedAt: null };
    record.failures += 1;
    if (record.failures >= this.policy.circuitFailureThreshold) {
      record.openedAt = (this.dependencies.now ?? Date.now)();
    }
    this.circuits.set(key, record);
  }
}
