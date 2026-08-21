export type DeliveryMode = 'quick' | 'standard' | 'program';
export type DeliveryWorkLevel = 'delivery_run' | 'program';

export interface ComplexityProfile {
  scope: 0 | 1 | 2 | 3;
  uncertainty: 0 | 1 | 2 | 3;
  coupling: 0 | 1 | 2 | 3;
  risk: 0 | 1 | 2 | 3;
  verification: 0 | 1 | 2 | 3;
}

export interface DeliveryGovernanceAssessment {
  stage: 'intake' | 'prd' | 'task_graph' | 'execution';
  profile: ComplexityProfile;
  index: number;
  confidence: number;
  workLevel: DeliveryWorkLevel;
  recommendedMode: DeliveryMode;
  reasons: string[];
  riskOverrides: string[];
  nextAction: 'discovery_only' | 'execute' | 'plan_program';
}

export interface DeliveryGovernanceFacts {
  stage: DeliveryGovernanceAssessment['stage'];
  profile: ComplexityProfile;
  confidence: number;
  independentOutcomeCount: number;
  repositoryCount: number;
  roleAgentCount: number;
  estimatedTaskCount: number;
  criticalPathLength: number;
  hasUnifiedCompletionDefinition: boolean;
  hasExternalDependencies: boolean;
  hasIrreversibleChange: boolean;
  requiresIndependentRepositoryReleases?: boolean;
}

export interface DeliveryExecutionChange {
  baselineTaskCount: number;
  currentTaskCount: number;
  addedAcceptanceGoal: boolean;
  introducedSystemBoundary: boolean;
  introducedHighRiskDependency: boolean;
}

export interface DeliveryReplanDecision {
  replanRequired: boolean;
  growthRatio: number;
  reasons: string[];
}

export class DeliveryGovernancePolicyError extends Error {
  readonly code = 'DELIVERY_GOVERNANCE_POLICY_VIOLATION';
  readonly statusCode = 422;
  readonly assessment: DeliveryGovernanceAssessment;

  constructor(message: string, assessment: DeliveryGovernanceAssessment) {
    super(message);
    this.name = 'DeliveryGovernancePolicyError';
    this.assessment = assessment;
  }
}

export function assessDeliveryGovernance(facts: DeliveryGovernanceFacts): DeliveryGovernanceAssessment {
  const index = Object.values(facts.profile).reduce<number>((sum, value) => sum + value, 0);
  const reasons: string[] = [];

  if (facts.profile.scope === 3) reasons.push('Scope=3，包含多个可独立发布的产品能力。');
  if (facts.independentOutcomeCount > 1) {
    reasons.push(`包含 ${facts.independentOutcomeCount} 个独立交付结果，需要拆分里程碑。`);
  }
  if (facts.estimatedTaskCount > 12) {
    reasons.push(`Task Graph 包含 ${facts.estimatedTaskCount} 个执行任务，超过单次 DeliveryRun 上限 12。`);
  }
  if (facts.criticalPathLength > 5) {
    reasons.push(`Task Graph 关键路径长度为 ${facts.criticalPathLength}，超过单次 DeliveryRun 上限 5。`);
  }
  if (facts.requiresIndependentRepositoryReleases) reasons.push('多个仓库或系统需要分别发布。');
  if (!facts.hasUnifiedCompletionDefinition) reasons.push('当前范围缺少统一、可验证的完成定义。');

  const isProgram = reasons.length > 0;
  const riskOverrides = facts.profile.risk >= 2
    ? ['security_review', 'specialized_verification', 'human_approval']
    : facts.profile.verification === 3
      ? ['specialized_verification', 'human_approval']
      : [];
  const isQuick = !isProgram
    && facts.confidence >= 0.7
    && facts.independentOutcomeCount === 1
    && facts.estimatedTaskCount >= 1
    && facts.estimatedTaskCount <= 3
    && facts.repositoryCount === 1
    && facts.roleAgentCount <= 2
    && index <= 4
    && facts.profile.risk <= 1
    && !facts.hasExternalDependencies
    && !facts.hasIrreversibleChange;

  if (!isProgram && isQuick) reasons.push('单一目标、任务有界、单仓库且无高风险覆盖，适合 Quick。');
  if (!isProgram && !isQuick) reasons.push('请求可在单次发布边界内完成，但不满足 Quick 的全部约束。');

  return {
    stage: facts.stage,
    profile: facts.profile,
    index,
    confidence: Math.min(1, Math.max(0, facts.confidence)),
    workLevel: isProgram ? 'program' : 'delivery_run',
    recommendedMode: isProgram ? 'program' : isQuick ? 'quick' : 'standard',
    reasons,
    riskOverrides,
    nextAction: isProgram ? 'plan_program' : facts.confidence < 0.7 ? 'discovery_only' : 'execute',
  };
}

export function resolveDeliveryMode(
  assessment: DeliveryGovernanceAssessment,
  requestedMode?: Exclude<DeliveryMode, 'program'>,
): DeliveryMode {
  if (assessment.workLevel === 'program') {
    if (requestedMode) {
      throw new DeliveryGovernancePolicyError('Program 不能降级为单个 DeliveryRun。', assessment);
    }
    return 'program';
  }
  if (requestedMode === 'quick' && assessment.riskOverrides.length > 0) {
    throw new DeliveryGovernancePolicyError('高风险门禁不能通过 Quick 模式绕过。', assessment);
  }
  return requestedMode ?? assessment.recommendedMode;
}

export function assessDeliveryExecutionChange(change: DeliveryExecutionChange): DeliveryReplanDecision {
  const growthRatio = change.baselineTaskCount > 0
    ? Number(((change.currentTaskCount - change.baselineTaskCount) / change.baselineTaskCount).toFixed(4))
    : change.currentTaskCount > 0 ? 1 : 0;
  const reasons: string[] = [];

  if (growthRatio > 0.2) {
    reasons.push(
      `执行任务从 ${change.baselineTaskCount} 增长到 ${change.currentTaskCount}，增长 ${Math.round(growthRatio * 100)}%，超过 20% 再规划阈值。`,
    );
  }
  if (change.addedAcceptanceGoal) reasons.push('执行期新增了验收目标。');
  if (change.introducedSystemBoundary) reasons.push('执行期出现了新的系统边界。');
  if (change.introducedHighRiskDependency) reasons.push('执行期出现了新的高风险依赖。');

  return { replanRequired: reasons.length > 0, growthRatio, reasons };
}
