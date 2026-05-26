export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowStepDefinition {
  agentId: string;
  order: number;
  inputTemplate: string;
  description: string;
  requiresPreviousOutput: boolean;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepDefinition[];
}

export interface WorkflowRecord {
  id: string;
  session_id: string;
  template: string;
  status: WorkflowStatus;
  current_step: number;
  context: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStepRecord {
  id: number;
  workflow_id: string;
  agent_id: string;
  step_order: number;
  input: string;
  output: string;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
}
