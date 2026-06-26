/**
 * Surface（面）实现
 *
 * 每个 Agent 是一个"面"，有明确的输入/输出契约。
 * 面的内部工作流由 Agent 自己执行，不对外暴露。
 *
 * 职责：
 * - 管理输入/输出契约
 * - 调用 Agent 执行内部工作流
 * - 处理出口关卡（Gate）
 * - 发布执行事件到 EventBus
 */

import { eventBus } from '../event/EventBus.js';
import type {
  SurfaceDefinition,
  SurfaceResult,
  SurfaceStatus,
  GateDefinition,
} from './types.js';
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';

export interface SurfaceExecuteOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  dryRun?: boolean;
}

/**
 * Surface（面）执行器
 */
export class Surface {
  private definition: SurfaceDefinition;
  private orchestrator: TeamOrchestrator;
  private inputArtifacts: Map<string, any> = new Map();

  constructor(def: SurfaceDefinition, orchestrator: TeamOrchestrator, sessionId?: string) {
    this.definition = def;
    this.orchestrator = orchestrator;
    this.sessionId = sessionId || `surface-${def.id}`;
  }

  private isAgentFailureOutput(output: string): boolean {
    const normalized = output.toLowerCase();
    return [
      'api call failed',
      'insufficient balance',
      'hermes 调用失败',
      'http 402',
      'http 401',
      'http 403',
      'rate limit',
      'quota exceeded',
    ].some((pattern) => normalized.includes(pattern));
  }

  private sessionId: string;

  /**
   * 获取面 ID
   */
  get id(): string {
    return this.definition.id;
  }

  /**
   * 获取面名称
   */
  get name(): string {
    return this.definition.name;
  }

  /**
   * 获取 Agent ID
   */
  get agent(): string {
    return this.definition.agent;
  }

  /**
   * 获取输入契约
   */
  get inputContract() {
    return this.definition.input;
  }

  /**
   * 获取输出契约
   */
  get outputContract() {
    return this.definition.output;
  }

  /**
   * 设置输入产物
   */
  setInput(key: string, value: any): void {
    this.inputArtifacts.set(key, value);
  }

  /**
   * 获取输入产物
   */
  getInput(key: string): any {
    return this.inputArtifacts.get(key);
  }

  /**
   * 获取所有输入产物键
   */
  getInputKeys(): string[] {
    return Array.from(this.inputArtifacts.keys());
  }

  /**
   * 检查输入是否满足契约
   */
  validateInput(): { valid: boolean; missing: string[] } {
    const required = this.definition.input?.required || [];
    const missing: string[] = [];

    for (const key of required) {
      if (!this.inputArtifacts.has(key)) {
        missing.push(key);
      }
    }

    return { valid: missing.length === 0, missing };
  }

  /**
   * 执行面
   *
   * 1. 验证输入契约
   * 2. 构建执行目标（包含输入上下文）
   * 3. 调用 Agent 执行
   * 4. 处理出口关卡
   * 5. 返回输出产物
   */
  async execute(options: SurfaceExecuteOptions = {}): Promise<SurfaceResult> {
    const startTime = Date.now();
    const result: SurfaceResult = {
      surfaceId: this.id,
      status: 'running',
      startedAt: startTime,
      logs: [],
    };

    try {
      if (options.signal?.aborted) {
        throw new Error('Surface execution cancelled before start');
      }

      // 1. 验证输入
      const validation = this.validateInput();
      if (!validation.valid) {
        throw new Error(`输入不满足契约，缺少: ${validation.missing.join(', ')}`);
      }

      // 发布面开始事件
      eventBus.emit({
        type: 'workflow.started',
        source: 'workflow',
        timestamp: Date.now(),
        payload: {
          workflowId: `surface-${this.id}`,
          taskId: this.name,
          surfaceId: this.id,
          agent: this.agent,
        },
      });

      // 2. 构建执行目标
      const goal = this.buildGoal(options);
      console.log(`[Surface] ${this.id} 执行: ${goal.substring(0, 100)}...`);

      // 3. 调用 Agent 执行
      const agentResult = await this.orchestrator.runAgent(this.agent, goal, this.sessionId, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? this.definition.timeout,
      });
      if (!agentResult.success) {
        throw new Error(`Agent ${this.agent} 执行失败: ${agentResult.output || 'unknown error'}`);
      }
      if (this.isAgentFailureOutput(agentResult.output || '')) {
        throw new Error(`Agent ${this.agent} 返回失败输出: ${agentResult.output}`);
      }

      // 4. 提取输出产物
      result.artifacts = {
        output: agentResult.output,
        ...this.extractArtifacts(agentResult.output),
      };
      result.tokenUsage = {
        input_tokens: agentResult.tokenUsage?.input_tokens || 0,
        output_tokens: agentResult.tokenUsage?.output_tokens || 0,
      };
      result.logs?.push(`Agent ${this.agent} 执行完成`);

      // 5. 处理出口关卡
      if (this.definition.gate) {
        const gateResult = await this.processGate(this.definition.gate);
        if (!gateResult.approved) {
          result.status = 'failed';
          result.error = `关卡未通过: ${gateResult.reason}`;
          return result;
        }
      }

      result.status = 'completed';
      result.completedAt = Date.now();

      // 发布面完成事件
      eventBus.emit({
        type: 'workflow.completed',
        source: 'workflow',
        timestamp: Date.now(),
        payload: {
          workflowId: `surface-${this.id}`,
          taskId: this.name,
          surfaceId: this.id,
          output: agentResult.output?.substring(0, 200),
          tokenUsage: result.tokenUsage,
        },
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const cancelled = options.signal?.aborted;
      result.status = cancelled ? 'cancelled' : 'failed';
      result.error = errorMsg;
      result.completedAt = Date.now();

      result.logs?.push(`错误: ${errorMsg}`);

      // 发布面失败/取消事件
      eventBus.emit({
        type: cancelled ? 'workflow.cancelled' : 'workflow.failed',
        source: 'workflow',
        timestamp: Date.now(),
        payload: {
          workflowId: `surface-${this.id}`,
          taskId: this.name,
          surfaceId: this.id,
          error: errorMsg,
        },
      });

      return result;
    }
  }

  /**
   * 构建执行目标（包含输入上下文）
   */
  private buildGoal(options: SurfaceExecuteOptions = {}): string {
    const workflow = this.definition.workflow;
    if (!workflow) {
      return `执行 ${this.name} 面`;
    }

    // 构建目标描述
    let goal = workflow.goal;

    if (options.dryRun) {
      goal = [
        'DRY-RUN MODE: Do not create, edit, delete, move, install, build, or run package-manager commands in the repository or filesystem. Produce markdown-only planning text in the response. If you would normally write files, describe the intended file paths and content summary instead.',
        '',
        goal,
      ].join('\n');
    }

    // 添加上下文输入
    const context = workflow.context || '';
    if (context) {
      goal += `\n\n上下文: ${context}`;
    }

    // 添加输入产物（截断长内容，避免 token 爆炸）
    if (this.inputArtifacts.size > 0) {
      goal += '\n\n输入产物:';
      for (const [key, value] of this.inputArtifacts) {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value);
        const preview = strValue.length > 2000 
          ? strValue.substring(0, 2000) + `... [${strValue.length} chars total, truncated]`
          : strValue;
        goal += `\n- ${key}: ${preview}`;
      }
    }

    // 处理循环反馈（__loop_feedback）
    const loopFeedback = this.inputArtifacts.get('__loop_feedback');
    if (loopFeedback) {
      goal += `\n\n⚠️ 这是第 ${loopFeedback.iteration || 1} 次修改迭代。\n`;
      goal += `上一轮反馈: ${loopFeedback.feedback || '请根据评审意见修改'}\n`;
      if (loopFeedback.previousResult) {
        const prevStr = typeof loopFeedback.previousResult === 'string' 
          ? loopFeedback.previousResult 
          : JSON.stringify(loopFeedback.previousResult).substring(0, 500);
        goal += `上一轮产物: ${prevStr}`;
      }
    }

    // 添加工作流步骤提示
    if (workflow.steps && workflow.steps.length > 0) {
      goal += '\n\n建议执行步骤:';
      workflow.steps.forEach((step, i) => {
        goal += `\n${i + 1}. ${step}`;
      });
    }

    return goal;
  }

  /**
   * 从 Agent 输出中提取产物
   */
  private extractArtifacts(output: string): Record<string, any> {
    const artifacts: Record<string, any> = {};

    // 将完整输出作为 "prd" 传递（供下游面使用）
    artifacts.prd = output;
    artifacts.output = output;

    // 尝试提取文档路径
    const docMatch = output.match(/文档已保存:\s*(.+)/);
    if (docMatch) {
      artifacts.document = docMatch[1];
    }

    // 尝试提取代码
    const codeMatch = output.match(/```[\s\S]*?```/);
    if (codeMatch) {
      artifacts.code = codeMatch[0];
    }

    // 尝试提取任务列表
    const taskMatch = output.match(/任务列表[\s\S]*?(?=\n\n|$)/);
    if (taskMatch) {
      artifacts.tasks = taskMatch[0];
    }

    return artifacts;
  }

  /**
   * 处理出口关卡
   */
  private async processGate(gate: GateDefinition): Promise<{ approved: boolean; reason?: string }> {
    console.log(`[Surface] ${this.id} 处理出口关卡: ${gate.type}`);

    switch (gate.type) {
      case 'auto':
        // 自动通过
        return { approved: true };

      case 'check':
        // 条件检查
        if (gate.condition) {
          console.log(`[Surface] 检查条件: ${gate.condition}`);
          // 简化版：暂时自动通过
          return { approved: true };
        }
        return { approved: true };

      case 'approve':
        // 需要审批
        if (gate.approvers && gate.approvers.length > 0) {
          console.log(`[Surface] 等待审批: ${gate.approvers.join(', ')}`);
          // 简化版：暂时自动通过
          return { approved: true };
        }
        return { approved: true };

      default:
        return { approved: true };
    }
  }
}

/**
 * 面工厂
 */
export function createSurface(
  definition: SurfaceDefinition,
  orchestrator: TeamOrchestrator,
  sessionId?: string,
): Surface {
  return new Surface(definition, orchestrator, sessionId);
}
