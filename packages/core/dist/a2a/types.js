/**
 * A2A domain model.
 *
 * This module intentionally models A2A semantics inside Open-Agent-Teams before
 * committing to any specific transport. In-process, HTTP, Redis, and NATS
 * transports should all carry these same domain objects.
 */
export function isA2ATask(value) {
    return 'status' in value && 'id' in value;
}
export function isTerminalA2ATaskState(state) {
    return state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected';
}
//# sourceMappingURL=types.js.map