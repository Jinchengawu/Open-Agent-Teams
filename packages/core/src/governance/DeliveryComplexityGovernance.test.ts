import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DeliveryGovernancePolicyError,
  assessDeliveryExecutionChange,
  assessDeliveryGovernance,
  resolveDeliveryMode,
} from './DeliveryComplexityGovernance.js';

test('delivery governance prevents an oversized task graph from being forced into one delivery run', () => {
    const assessment = assessDeliveryGovernance({
      stage: 'task_graph',
      profile: { scope: 2, uncertainty: 1, coupling: 2, risk: 1, verification: 2 },
      confidence: 0.95,
      independentOutcomeCount: 1,
      repositoryCount: 1,
      roleAgentCount: 3,
      estimatedTaskCount: 13,
      criticalPathLength: 4,
      hasUnifiedCompletionDefinition: true,
      hasExternalDependencies: false,
      hasIrreversibleChange: false,
    });

  assert.equal(assessment.recommendedMode, 'program');
  assert.throws(() => resolveDeliveryMode(assessment, 'standard'), DeliveryGovernancePolicyError);
});

test('delivery governance keeps risk gates independent from the aggregate index', () => {
    const assessment = assessDeliveryGovernance({
      stage: 'prd',
      profile: { scope: 0, uncertainty: 0, coupling: 0, risk: 2, verification: 1 },
      confidence: 0.9,
      independentOutcomeCount: 1,
      repositoryCount: 1,
      roleAgentCount: 1,
      estimatedTaskCount: 1,
      criticalPathLength: 1,
      hasUnifiedCompletionDefinition: true,
      hasExternalDependencies: false,
      hasIrreversibleChange: false,
    });

  assert.equal(assessment.index, 3);
  assert.equal(assessment.recommendedMode, 'standard');
  assert.ok(assessment.riskOverrides.includes('human_approval'));
  assert.throws(() => resolveDeliveryMode(assessment, 'quick'), DeliveryGovernancePolicyError);
});

test('delivery governance requires replanning when execution work grows by more than twenty percent', () => {
    const decision = assessDeliveryExecutionChange({
      baselineTaskCount: 10,
      currentTaskCount: 13,
      addedAcceptanceGoal: false,
      introducedSystemBoundary: false,
      introducedHighRiskDependency: false,
    });

  assert.equal(decision.replanRequired, true);
  assert.equal(decision.growthRatio, 0.3);
});
