import type {
  A2AV1ClaimOutboxInput,
  A2AV1OutboxLease,
  SqliteA2AV1Repository,
} from './sqlite-repository.js';

export type A2AV1OutboxDelivery = (event: A2AV1OutboxLease) => Promise<void>;

export interface A2AV1DispatchOnceInput extends A2AV1ClaimOutboxInput {
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface A2AV1DispatchOnceResult {
  claimed: number;
  dispatched: number;
  retryScheduled: number;
  deadLettered: number;
}

export class A2AV1OutboxDispatcher {
  constructor(
    private readonly repository: SqliteA2AV1Repository,
    private readonly deliver: A2AV1OutboxDelivery,
  ) {}

  async dispatchOnce(input: A2AV1DispatchOnceInput): Promise<A2AV1DispatchOnceResult> {
    const leases = this.repository.claimPendingOutbox(input);
    const result: A2AV1DispatchOnceResult = {
      claimed: leases.length,
      dispatched: 0,
      retryScheduled: 0,
      deadLettered: 0,
    };
    for (const lease of leases) {
      try {
        await this.deliver(lease);
        if (this.repository.ackOutboxLease({
          tenantId: lease.tenantId,
          eventId: lease.id,
          workerId: lease.leaseOwner,
          leaseToken: lease.leaseToken,
          dispatchedAt: input.now,
        })) result.dispatched += 1;
      } catch (error) {
        const failure = this.repository.failOutboxLease({
          tenantId: lease.tenantId,
          eventId: lease.id,
          workerId: lease.leaseOwner,
          leaseToken: lease.leaseToken,
          failedAt: input.now,
          error: error instanceof Error ? error.message : String(error),
          baseDelayMs: input.baseDelayMs,
          maxDelayMs: input.maxDelayMs,
          maxAttempts: input.maxAttempts,
        });
        if (failure.status === 'retry-scheduled') result.retryScheduled += 1;
        if (failure.status === 'dead-lettered') result.deadLettered += 1;
      }
    }
    return result;
  }
}
