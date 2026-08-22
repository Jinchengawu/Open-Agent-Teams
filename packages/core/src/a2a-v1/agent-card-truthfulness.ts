import { validateA2AV1 } from './schemas.js';
import type {
  A2AV1ImplementedOperation,
  A2AV1TransportCapabilities,
} from './transport.js';
import type { A2AV1AgentCard, A2AV1ValidationIssue, A2AV1ValidationResult } from './types.js';

export interface A2AV1AgentCardTruthInput {
  agentId: string;
  agentCard: A2AV1AgentCard;
  transportCapabilities: A2AV1TransportCapabilities;
  exposedOperations: A2AV1ImplementedOperation[];
}

/** Validates claims against the concrete adapter, not just protocol shape. */
export function validateA2AV1AgentCardTruthfulness(
  input: A2AV1AgentCardTruthInput,
): A2AV1ValidationResult {
  const shape = validateA2AV1('agentCard', input.agentCard);
  if (!shape.valid) return shape;
  const issues: A2AV1ValidationIssue[] = [];
  const capabilities = input.transportCapabilities;
  const matchingInterface = input.agentCard.supportedInterfaces.some((candidate) =>
    candidate.protocolVersion === capabilities.protocolVersion
      && candidate.protocolBinding === capabilities.protocolBinding
      && candidate.url === capabilities.interfaceUrl.replace('{agentId}', encodeURIComponent(input.agentId)));
  if (!matchingInterface) {
    issues.push({
      path: 'supportedInterfaces',
      message: 'AgentCard must expose this adapter binding, protocol version, and agent endpoint',
    });
  }
  if (input.agentCard.capabilities.streaming === true && !capabilities.streaming) {
    issues.push({ path: 'capabilities.streaming', message: 'Transport does not implement streaming' });
  }
  if (capabilities.streaming && input.agentCard.capabilities.streaming !== true) {
    issues.push({ path: 'capabilities.streaming', message: 'AgentCard must declare implemented streaming support' });
  }
  if (input.agentCard.capabilities.pushNotifications === true && !capabilities.pushNotifications) {
    issues.push({ path: 'capabilities.pushNotifications', message: 'Transport does not implement push notifications' });
  }
  if (input.agentCard.capabilities.extendedAgentCard === true) {
    issues.push({ path: 'capabilities.extendedAgentCard', message: 'This contract slice does not implement extended Agent Cards' });
  }
  const implemented = new Set(capabilities.operations);
  const unsupported = input.exposedOperations.filter((operation) => !implemented.has(operation));
  if (unsupported.length > 0) {
    issues.push({
      path: 'exposedOperations',
      message: `Endpoint manifest exposes unsupported operations: ${unsupported.join(', ')}`,
    });
  }
  const declared = new Set(input.exposedOperations);
  const missing = capabilities.operations.filter((operation) => !declared.has(operation));
  if (missing.length > 0) {
    issues.push({
      path: 'exposedOperations',
      message: `Endpoint manifest omits implemented operations: ${missing.join(', ')}`,
    });
  }
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}
