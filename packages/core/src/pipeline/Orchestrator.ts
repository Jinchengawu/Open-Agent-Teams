/**
 * Pipeline Orchestrator（面编排器）
 *
 * 基于 DAG 的面编排引擎：
 * - 解析 Pipeline 定义（YAML）
 * - 构建面依赖图
 * - 按拓扑顺序执行（支持并行）
 * - 管理面之间的输入/输出传递
 * - 处理关卡、回滚、事件
 * - Pipeline 产物自动沉淀到知识中心
 * - 支持循环编排（CR→FE 反馈）
 * - 冲突解决（profile arbitration agent 仲裁）
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { eventBus } from '../event/EventBus.js';
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';
import type { WorkflowState, WorkflowStateManager, WorkflowStepState } from '../session/WorkflowStateManager.js';
import { Surface, createSurface } from './Surface.js';
import { pipelineInstanceToA2ATask } from '../a2a/converters.js';
import type {
  PipelineDefinition,
  PipelineInstance,
  PipelineStatus,
  PipelineExecutionConfig,
  SurfaceDefinition,
  Edge,
  SurfaceResult,
  PipelineExecuteOptions,
} from './types.js';
import type { KnowledgeCenter } from '../knowledge/KnowledgeCenter.js';
import type { DocumentManager, Task } from '../knowledge/DocumentManager.js';
import {
  validateManagedArtifactEnvelope,
  type ManagedArtifactEnvelope,
} from '../runtime/ManagedArtifactContract.js';
import {
  assessDeliveryGovernance,
  type ComplexityProfile,
  type DeliveryMode,
} from '../governance/DeliveryComplexityGovernance.js';

// ============================================================================
// 循环编排状态
// ============================================================================

interface LoopState {
  edgeKey: string;          // "from->to"
  count: number;            // 当前循环次数
  history: SurfaceResult[]; // 历史执行结果（用于对比）
  lastFeedback?: string;    // 上一次的反馈信息
}

// ============================================================================
// 冲突解决结果
// ============================================================================

interface ConflictResolution {
  resolved: boolean;        // 是否已解决
  winner?: string;          // 胜出面 ID
  merged?: Record<string, any>; // 合并后的产物
  reason: string;           // 解决理由
}

interface PipelineCoordinationBinding {
  projectId: string;
  taskIdsBySurface: Map<string, string>;
  taskNodeIdsBySurface: Map<string, string[]>;
  docIdsBySurface: Map<string, string>;
}

interface ProjectedImplementationTask {
  id: string;
  title: string;
  ownerAgent: string;
  dependsOn: string[];
  allowedPaths: string[];
  acceptanceIds: string[];
  expectedArtifactKind: string;
  expectedMutation: boolean;
}

interface SurfaceExecutionTarget {
  surfaceId: string;
  taskNode?: ProjectedImplementationTask;
  taskId?: string;
}

type PersistedPipelineContext = {
  kind?: 'pipeline';
  pipelineId?: string;
  pipelineName?: string;
  surfaceIds?: string[];
  coordination?: PipelineInstance['coordination'];
  metadata?: Record<string, unknown>;
  execution?: {
    dryRun?: boolean;
    surfaceTimeoutMs?: number;
  };
};

interface DryRunGuard {
  root: string;
  baseline: string[];
}

function isTerminalPipelineStatus(status: PipelineStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'rolled_back';
}

/**
 * Pipeline 编排器
 */
export class PipelineOrchestrator {
  private pipelines: Map<string, PipelineDefinition> = new Map();
  private instances: Map<string, PipelineInstance> = new Map();
  private teamOrchestrator: TeamOrchestrator;
  private stateManager?: WorkflowStateManager;
  private knowledgeCenter?: KnowledgeCenter;
  private documentManager?: DocumentManager;
  private loopStates: Map<string, Map<string, LoopState>> = new Map(); // instanceId -> edgeKey -> LoopState
  private controllers: Map<string, AbortController> = new Map();
  private coordinationBindings: Map<string, PipelineCoordinationBinding> = new Map();

  constructor(
    teamOrchestrator: TeamOrchestrator,
    stateManager?: WorkflowStateManager,
    knowledgeCenter?: KnowledgeCenter,
    documentManager?: DocumentManager,
  ) {
    this.teamOrchestrator = teamOrchestrator;
    this.stateManager = stateManager;
    this.knowledgeCenter = knowledgeCenter;
    this.documentManager = documentManager;
  }

  /**
   * 设置知识中心（运行时注入）
   */
  setKnowledgeCenter(kc: KnowledgeCenter): void {
    this.knowledgeCenter = kc;
  }

  /**
   * 设置 V2 文档管理器（运行时注入）
   */
  setDocumentManager(dm: DocumentManager): void {
    this.documentManager = dm;
  }

  /**
   * 加载 Pipeline 定义
   */
  loadPipeline(def: PipelineDefinition): void {
    this.pipelines.set(def.id, def);
    this.markInterruptedPipelineRuns(def.id);
    console.log(`[PipelineOrchestrator] Pipeline "${def.name}" (${def.id}) 已加载`);
  }

  /**
   * 卸载 Pipeline 定义。
   */
  unloadPipeline(pipelineId: string): boolean {
    const deleted = this.pipelines.delete(pipelineId);
    if (deleted) {
      console.log(`[PipelineOrchestrator] Pipeline "${pipelineId}" 已卸载`);
    }
    return deleted;
  }

  /**
   * 从 YAML 文件加载 Pipeline 定义。
   */
  async loadFromYaml(yamlPath: string): Promise<PipelineDefinition> {
    const yamlContent = await readFile(yamlPath, 'utf8');
    return this.loadFromYamlContent(yamlContent, yamlPath);
  }

  /**
   * 从 YAML 文本加载 Pipeline 定义。
   */
  loadFromYamlContent(yamlContent: string, source: string = 'inline-yaml'): PipelineDefinition {
    const parsed = parse(yamlContent);
    const pipeline = this.assertPipelineDefinition(parsed, source);
    this.loadPipeline(pipeline);
    return pipeline;
  }

  /**
   * 执行 Pipeline
   *
   * 1. 解析 DAG 依赖
   * 2. 按拓扑顺序执行面（支持循环边）
   * 3. 支持并行执行（无依赖的面同时运行）
   * 4. 传递输入/输出产物
   * 5. 产物自动沉淀到知识中心
   */
  async execute(
    pipelineId: string,
    initialInput?: Record<string, any>,
    options: PipelineExecuteOptions = {},
  ): Promise<PipelineInstance> {
    const { pipeline, instance, signal } = this.prepareRun(pipelineId, options);
    await this.runPipeline(pipeline, instance, initialInput, { ...options, signal });
    return instance;
  }

  /**
   * 后台启动 Pipeline，立即返回实例；调用方可轮询实例状态。
   */
  start(
    pipelineId: string,
    initialInput?: Record<string, any>,
    options: PipelineExecuteOptions = {},
  ): PipelineInstance {
    const { pipeline, instance, signal } = this.prepareRun(pipelineId, options);
    void this.runPipeline(pipeline, instance, initialInput, { ...options, signal }).catch((error) => {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      instance.status = signal.aborted ? 'cancelled' : 'failed';
      instance.error = errorMsg;
      instance.completedAt = Date.now();
      if (instance.status === 'cancelled') {
        this.stateManager?.cancel(instance.id, errorMsg);
      } else {
        this.stateManager?.fail(instance.id, errorMsg);
      }
    });
    return instance;
  }

  private prepareRun(
    pipelineId: string,
    options: PipelineExecuteOptions = {},
  ): { pipeline: PipelineDefinition; instance: PipelineInstance; signal: AbortSignal } {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline "${pipelineId}" 未找到`);
    }

    const now = Date.now();
    const instance: PipelineInstance = {
      id: `pipeline-${now}`,
      pipelineId,
      status: 'running',
      surfaceResults: new Map(),
      executionResults: new Map(),
      startedAt: now,
      workflowStateId: `pipeline-${now}`,
      metadata: options.metadata,
    };

    this.instances.set(instance.id, instance);
    this.loopStates.set(instance.id, new Map());
    this.stateManager?.createState(`Pipeline: ${pipeline.name}`, pipeline.surfaces.length, instance.id, {
      kind: 'pipeline',
      taskId: pipeline.name,
      pipelineId,
      pipelineName: pipeline.name,
      surfaceIds: pipeline.surfaces.map((surface) => surface.id),
      execution: {
        dryRun: options.dryRun ?? pipeline.context?.execution?.dryRun,
        surfaceTimeoutMs: options.surfaceTimeoutMs ?? pipeline.context?.execution?.surfaceTimeoutMs,
      },
      metadata: options.metadata,
    });
    this.createCoordinationBinding(pipeline, instance);

    const controller = new AbortController();
    const abortFromCaller = () => {
      controller.abort(options.signal?.reason || new Error('Pipeline cancelled by caller'));
    };
    if (options.signal?.aborted) {
      abortFromCaller();
    } else {
      options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }
    this.controllers.set(instance.id, controller);

    console.log(`[PipelineOrchestrator] Pipeline "${pipeline.name}" 开始执行 (instance: ${instance.id})`);

    // Without a state manager this remains an explicitly unscoped legacy path.
    if (!this.stateManager) eventBus.emit({
      type: 'workflow.started',
      source: 'workflow',
      timestamp: now,
      payload: {
        workflowId: instance.id,
        taskId: pipeline.name,
        pipelineId,
      },
    });

    return { pipeline, instance, signal: controller.signal };
  }

  private async runPipeline(
    pipeline: PipelineDefinition,
    instance: PipelineInstance,
    initialInput?: Record<string, any>,
    options: PipelineExecuteOptions = {},
  ): Promise<void> {
    const signal = options.signal;
    const dryRun = options.dryRun ?? pipeline.context?.execution?.dryRun;
    const dryRunGuard = dryRun ? this.createDryRunGuard() : undefined;

    try {
      // 构建 DAG 和执行顺序
      const dag = this.buildDAG(pipeline);
      const executionOrder = this.topologicalSort(dag);

      // 按批次执行（支持并行）
      for (let batchIndex = 0; batchIndex < executionOrder.length; batchIndex++) {
        this.throwIfCancelled(signal);
        const projectedBatches = this.projectImplementationBatches(
          pipeline,
          instance,
          executionOrder[batchIndex],
        );
        const batch = projectedBatches.flat();
        let hasFailure = false;

        for (const projectedBatch of projectedBatches) {
          console.log(`[PipelineOrchestrator] 执行批次: ${projectedBatch.map((target) =>
            target.taskNode ? `${target.surfaceId}:${target.taskNode.id}` : target.surfaceId
          ).join(', ') || '(无实现面)'}`);
          await Promise.all(projectedBatch.map((target) =>
            this.executeSurface(pipeline, target.surfaceId, instance, initialInput, options, target),
          ));
          this.throwIfCancelled(signal);
          this.assertDryRunNoRepositorySideEffects(dryRunGuard);
          hasFailure = projectedBatch.some((target) =>
            instance.surfaceResults.get(target.surfaceId)?.status === 'failed',
          );
          if (hasFailure) break;
        }

        if (hasFailure) {
          const failedTarget = batch.find((target) =>
            instance.surfaceResults.get(target.surfaceId)?.status === 'failed'
          );
          const failedSurface = failedTarget?.surfaceId;
          const failedResult = failedSurface ? instance.surfaceResults.get(failedSurface) : undefined;
          console.error(`[PipelineOrchestrator] 批次执行失败，Pipeline 终止`);
          instance.status = 'failed';
          instance.error = failedSurface
            ? `${failedSurface}: ${failedResult?.error || 'surface failed'}`
            : 'batch execution failed';
          break;
        }

        // 检查循环边：当前批次完成后，检查是否有循环边需要重新执行上游面
        const loopEdges = pipeline.edges.filter((e) => {
          const downstream = Array.isArray(e.to) ? e.to : [e.to];
          // 如果当前批次包含下游面，且该边是循环边
          return e.loop && downstream.some((toId) => batch.some((target) => target.surfaceId === toId));
        });

        for (const edge of loopEdges) {
          const downstreamId = Array.isArray(edge.to) ? edge.to[0] : edge.to;
          const downstreamResult = instance.surfaceResults.get(downstreamId);
          
          // 检查 gate 是否通过
          if (downstreamResult && !this.checkGatePassed(downstreamResult, edge)) {
            const edgeKey = `${edge.from}->${downstreamId}`;
            const loopState = this.getOrCreateLoopState(instance.id, edgeKey);
            const maxLoops = edge.maxLoops ?? 3;

            if (loopState.count >= maxLoops) {
              console.warn(`[PipelineOrchestrator] 循环边 ${edgeKey} 已达最大次数 (${maxLoops})，停止循环`);
              // 标记失败
              downstreamResult.status = 'failed';
              downstreamResult.error = `循环边 ${edgeKey} 超过最大次数 (${maxLoops})`;
              instance.surfaceResults.set(downstreamId, downstreamResult);
              instance.status = 'failed';
              break;
            }

            loopState.count++;
            loopState.history.push(downstreamResult);
            loopState.lastFeedback = this.extractGateFeedback(downstreamResult);

            console.log(`[PipelineOrchestrator] 循环边 ${edgeKey} 第 ${loopState.count}/${maxLoops} 次，重新执行上游面 ${edge.from}`);

            // 重新执行上游面（携带反馈）
            const feedbackArtifact = {
              feedback: loopState.lastFeedback,
              iteration: loopState.count,
              previousResult: downstreamResult.artifacts,
            };
            
            // 清除上游面的结果，重新执行
            instance.surfaceResults.delete(edge.from);
            await this.executeSurface(
              pipeline,
              edge.from,
              instance,
              {
                ...initialInput,
                __loop_feedback: feedbackArtifact,
              },
              options,
            );

            // 重新执行下游面
            instance.surfaceResults.delete(downstreamId);
            const newDownstreamResult = await this.executeSurface(pipeline, downstreamId, instance, initialInput, options);

            // 如果 gate 通过了，跳出循环
            if (this.checkGatePassed(newDownstreamResult, edge)) {
              console.log(`[PipelineOrchestrator] 循环边 ${edgeKey} 在第 ${loopState.count} 次通过`);
              break;
            }

            // 否则继续循环（下一轮 batch 处理会再次触发）
            // 但我们已经处理过了，这里需要手动调整 batchIndex 来重新检查
            // 实际上上面的代码已经重新执行了，所以不需要调整 batchIndex
            // 但我们需要确保后续流程知道 gate 已经通过了
          }
        }

        if (instance.status === 'failed') break;
      }

      if (instance.status !== 'failed' && instance.status !== 'cancelled') {
        this.assertDryRunNoRepositorySideEffects(dryRunGuard);
        instance.status = 'completed';
        instance.completedAt = Date.now();

        if (this.stateManager) this.stateManager.complete(instance.id, 'Pipeline 执行完成');
        else eventBus.emit({
          type: 'workflow.completed',
          source: 'workflow',
          timestamp: Date.now(),
          payload: {
            workflowId: instance.id,
            taskId: pipeline.name,
            pipelineId: pipeline.id,
            output: 'Pipeline 执行完成',
          },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      instance.status = signal?.aborted ? 'cancelled' : 'failed';
      instance.error = errorMsg;
      instance.completedAt = Date.now();

      if (this.stateManager) {
        if (signal?.aborted) this.stateManager.cancel(instance.id, errorMsg);
        else this.stateManager.fail(instance.id, errorMsg);
      } else eventBus.emit({
        type: signal?.aborted ? 'workflow.cancelled' : 'workflow.failed',
        source: 'workflow',
        timestamp: Date.now(),
        payload: {
          workflowId: instance.id,
          taskId: pipeline.name,
          pipelineId: pipeline.id,
          error: errorMsg,
        },
      });
    }

    this.finalizeDryRunGuard(dryRunGuard, instance);

    if (instance.status === 'cancelled') {
      this.blockUnfinishedSurfaceTasks(pipeline, instance);
      this.stateManager?.cancel(instance.id, instance.error || 'Pipeline cancelled');
    } else if (instance.status === 'failed') {
      this.blockUnfinishedSurfaceTasks(pipeline, instance);
      this.stateManager?.fail(instance.id, instance.error || 'Pipeline 执行失败');
    }
    if (instance.status === 'completed' || instance.status === 'cancelled' || instance.status === 'failed') {
      this.capturePipelineExperience(pipeline, instance);
    }

    // 清理循环状态
    this.loopStates.delete(instance.id);
    this.controllers.delete(instance.id);
  }

  /**
   * 获取 Pipeline 实例状态
   */
  getStatus(instanceId: string): PipelineInstance | null {
    return this.instances.get(instanceId) || this.restorePipelineInstance(instanceId);
  }

  /**
   * 列出所有实例（包括已完成和失败的）
   */
  listInstances(): PipelineInstance[] {
    const instances = new Map<string, PipelineInstance>();
    for (const instance of this.restorePipelineInstances()) {
      instances.set(instance.id, instance);
    }
    for (const instance of this.instances.values()) {
      instances.set(instance.id, instance);
    }
    return [...instances.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 将实例转换为可序列化对象
   */
  serializeInstance(instance: PipelineInstance): any {
    const surfaceResults: Record<string, SurfaceResult> = {};
    for (const [key, value] of instance.surfaceResults) {
      surfaceResults[key] = value;
    }
    const executionResults: Record<string, SurfaceResult> = {};
    for (const [key, value] of instance.executionResults ?? []) {
      executionResults[key] = value;
    }
    return {
      ...instance,
      surfaceResults,
      executionResults,
      coordination: this.serializeCoordinationBinding(instance.id) ?? instance.coordination,
      a2aTask: pipelineInstanceToA2ATask(instance),
    };
  }

  /**
   * 列出所有 Pipeline 定义
   */
  listPipelines(): PipelineDefinition[] {
    return [...this.pipelines.values()];
  }

  /**
   * 列出运行中的实例
   */
  listRunningInstances(): PipelineInstance[] {
    return this.listInstances().filter((i) => i.status === 'running');
  }

  /**
   * 暂停 Pipeline
   *
   * 当前 Pipeline Surface 执行由 Hermes 请求驱动，尚没有可安全挂起并恢复的
   * checkpoint 协议。这里明确拒绝，避免把内存状态改成 paused 但后台仍在执行。
   */
  async pause(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId) || this.restorePipelineInstance(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    throw new Error('Pipeline pause is not supported yet. Use cancel to stop the run safely.');
  }

  /**
   * 取消 Pipeline
   */
  async cancel(instanceId: string, reason: string = 'Pipeline cancelled'): Promise<void> {
    const liveInstance = this.instances.get(instanceId);
    const instance = liveInstance || this.restorePipelineInstance(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    if (instance.status === 'cancelled') {
      return;
    }
    if (isTerminalPipelineStatus(instance.status)) {
      throw new Error(`Pipeline ${instanceId} is already ${instance.status} and cannot be cancelled.`);
    }

    this.controllers.get(instanceId)?.abort(new Error(reason));
    instance.status = 'cancelled';
    instance.error = reason;
    instance.completedAt = Date.now();
    if (!liveInstance) {
      this.instances.set(instanceId, instance);
    }
    this.stateManager?.cancel(instanceId, reason);
    const pipeline = this.pipelines.get(instance.pipelineId);
    if (pipeline) {
      this.blockUnfinishedSurfaceTasks(pipeline, instance);
      this.capturePipelineExperience(pipeline, instance);
    }

    if (!this.stateManager) eventBus.emit({
      type: 'workflow.cancelled',
      source: 'workflow',
      timestamp: Date.now(),
      payload: {
        workflowId: instanceId,
        taskId: instance.pipelineId,
        error: reason,
      },
    });

    console.log(`[PipelineOrchestrator] Pipeline ${instanceId} 已取消: ${reason}`);
  }

  /**
   * 恢复 Pipeline
   *
   * 恢复需要 Surface 级 checkpoint/replay 协议。当前只能从持久化状态恢复只读投影，
   * 不能继续执行未完成的 Surface，因此明确拒绝。
   */
  async resume(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId) || this.restorePipelineInstance(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    throw new Error('Pipeline resume is not supported yet. Re-run the Pipeline from the desired input after reviewing recovered state.');
  }

  /**
   * 回滚到指定面
   *
   * 当前只能恢复状态投影，不能保证 Agent 外部副作用可逆。为避免假回滚，先明确拒绝。
   */
  async rollback(instanceId: string, surfaceId: string): Promise<void> {
    const instance = this.instances.get(instanceId) || this.restorePipelineInstance(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    const pipeline = this.pipelines.get(instance.pipelineId);
    if (!pipeline?.surfaces.some((surface) => surface.id === surfaceId)) {
      throw new Error(`面 ${surfaceId} 未定义`);
    }
    throw new Error('Pipeline rollback is not supported yet. Current dry-run guard can detect side effects, but cannot reverse them safely.');
  }

  /**
   * 冲突解决：profile arbitration agent 仲裁多 Agent 分歧
   * 
   * 当多个面产生冲突产物时，调用 profile arbitration agent 进行仲裁。
   * 适用于：
   * - 两个 Agent 对同一需求给出不同实现方案
   * - 代码审查与实现之间的冲突
   * - 多个测试 Agent 给出矛盾的测试结果
   */
  async resolveConflict(
    instanceId: string,
    surfaceIds: string[],
    conflictDescription: string,
  ): Promise<ConflictResolution> {
    console.log(`[PipelineOrchestrator] 冲突解决：${surfaceIds.join(' vs ')}`);
    
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { resolved: false, reason: '实例未找到' };
    }

    // 收集冲突面的产物
    const artifacts: Record<string, SurfaceResult> = {};
    for (const sid of surfaceIds) {
      const result = instance.surfaceResults.get(sid);
      if (result) {
        artifacts[sid] = result;
      }
    }

    // 构建仲裁请求
    const arbitrationGoal = `
你是团队仲裁 Agent，负责解决多 Agent 之间的冲突。

冲突描述：${conflictDescription}

冲突面：${surfaceIds.join(', ')}

请分析以下产物，决定最终方案：
${JSON.stringify(artifacts, null, 2)}

请给出：
1. 哪个面的方案更优（或是否需要合并）
2. 最终产物（merged output）
3. 理由

请以 JSON 格式返回：
{
  "winner": "面ID 或 'merged'",
  "merged": { ...最终产物... },
  "reason": "解决理由"
}
`;

    try {
      const arbitrationAgentId = this.teamOrchestrator.getArbitrationAgentId();
      const arbitrationResult = await this.teamOrchestrator.runAgent(arbitrationAgentId, arbitrationGoal, instanceId);
      const resultText = arbitrationResult.output;
      
      // 解析仲裁结果
      let resolution: ConflictResolution;
      try {
        const parsed = JSON.parse(resultText);
        resolution = {
          resolved: true,
          winner: parsed.winner,
          merged: parsed.merged,
          reason: parsed.reason || `${arbitrationAgentId} 仲裁结果`,
        };
      } catch {
        // 如果解析失败，使用原始输出作为理由
        resolution = {
          resolved: true,
          reason: `${arbitrationAgentId} 仲裁：${resultText.substring(0, 500)}`,
        };
      }

      // 将仲裁结果记录到知识中心
      if (this.knowledgeCenter) {
        this.knowledgeCenter.addDocument({
          title: `冲突解决: ${conflictDescription}`,
          content: `冲突面: ${surfaceIds.join(', ')}
仲裁结果: ${resolution.reason}
胜出: ${resolution.winner || 'merged'}
`,
          type: 'general',
          source: arbitrationAgentId,
          tags: ['conflict-resolution', 'arbitration', ...surfaceIds],
          metadata: {
            instanceId,
            surfaceIds,
            resolution,
            timestamp: Date.now(),
          },
        });
      }

      console.log(`[PipelineOrchestrator] 冲突已解决：${resolution.reason}`);
      return resolution;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[PipelineOrchestrator] 冲突解决失败: ${errorMsg}`);
      return { resolved: false, reason: `仲裁失败: ${errorMsg}` };
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 获取或创建循环状态
   */
  private getOrCreateLoopState(instanceId: string, edgeKey: string): LoopState {
    const instanceLoops = this.loopStates.get(instanceId);
    if (!instanceLoops) {
      const newState: LoopState = { edgeKey, count: 0, history: [] };
      this.loopStates.set(instanceId, new Map([[edgeKey, newState]]));
      return newState;
    }
    
    let state = instanceLoops.get(edgeKey);
    if (!state) {
      state = { edgeKey, count: 0, history: [] };
      instanceLoops.set(edgeKey, state);
    }
    return state;
  }

  /**
   * 检查 gate 是否通过
   */
  private checkGatePassed(result: SurfaceResult, _edge?: Edge): boolean {
    // 1. 如果面状态是 failed，gate 没通过
    if (result.status === 'failed') {
      return false;
    }
    
    // 2. 检查产物中的 gate 标记
    if (result.artifacts?.__gate_passed === false) {
      return false;
    }
    
    // 3. 检查产物中的评审标记（如 CR 的 review 结果）
    if (result.artifacts?.review) {
      const review = result.artifacts.review;
      if (typeof review === 'object') {
        if (review.approved === false || review.passed === false) {
          return false;
        }
      }
    }
    
    // 4. 检查是否有错误信息
    if (result.error) {
      return false;
    }
    
    return true;
  }

  /**
   * 提取 gate 反馈信息
   */
  private extractGateFeedback(result: SurfaceResult): string {
    if (result.error) {
      return result.error;
    }
    
    if (result.artifacts?.review) {
      const review = result.artifacts.review;
      if (typeof review === 'object') {
        return review.feedback || review.comments || JSON.stringify(review);
      }
      return String(review);
    }
    
    if (result.artifacts?.__gate_feedback) {
      return String(result.artifacts.__gate_feedback);
    }
    
    return 'Gate 未通过，请修改后重新提交';
  }

  /**
   * 将产物沉淀到知识中心
   */
  private sinkToKnowledgeCenter(
    surfaceId: string,
    surfaceName: string,
    agentId: string,
    result: SurfaceResult,
    instanceId: string,
  ): void {
    if (!result.artifacts) return;

    try {
      // 根据面类型决定文档类型
      const docType = this.inferDocType(surfaceId);
      
      // 提取产物内容
      const content = this.extractArtifactsContent(result.artifacts);
      if (!content) return;

      if (this.knowledgeCenter) {
        this.knowledgeCenter.addDocument({
          title: `${surfaceName} (${surfaceId}) - ${instanceId}`,
          content,
          type: docType,
          source: surfaceId,
          tags: ['pipeline-artifact', instanceId, surfaceId],
          metadata: {
            instanceId,
            surfaceId,
            surfaceName,
            status: result.status,
            tokenUsage: result.tokenUsage,
            timestamp: Date.now(),
          },
        });
      }

      const binding = this.coordinationBindings.get(instanceId);
      const taskId = binding?.taskIdsBySurface.get(surfaceId);
      const relatedTaskIds = binding ? Array.from(binding.taskIdsBySurface.values()) : [];
      const relatedDocIds = binding ? Array.from(binding.docIdsBySurface.values()) : [];

      if (this.documentManager) {
        const doc = this.documentManager.createDocument({
          title: `${surfaceName} (${surfaceId}) - ${instanceId}`,
          content,
          type: this.inferDocumentType(surfaceId),
          projectId: binding?.projectId,
          taskId,
          authorId: agentId,
          authorName: surfaceName,
          tags: ['pipeline-artifact', instanceId, surfaceId],
          relatedDocIds,
          relatedTaskIds,
          relatedAgentIds: [agentId],
          metadata: {
            instanceId,
            surfaceId,
            surfaceName,
            taskId,
            projectId: binding?.projectId,
            status: result.status,
            tokenUsage: result.tokenUsage,
            timestamp: Date.now(),
          },
        });
        binding?.docIdsBySurface.set(surfaceId, doc.id);
        const instance = this.instances.get(instanceId);
        if (instance) {
          instance.coordination = this.serializeCoordinationBinding(instanceId);
          this.persistInstanceContext(instance);
        }
      }

      console.log(`[PipelineOrchestrator] 产物已沉淀到知识中心: ${surfaceId}`);
    } catch (error) {
      console.warn(`[PipelineOrchestrator] 产物沉淀失败: ${error}`);
    }
  }

  /**
   * 推断文档类型
   */
  private inferDocType(surfaceId: string): 'prd' | 'code' | 'meeting' | 'report' | 'task' | 'general' {
    if (surfaceId.includes('prd') || surfaceId.includes('pd')) return 'prd';
    if (surfaceId.includes('code') || surfaceId.includes('fe') || surfaceId.includes('be')) return 'code';
    if (surfaceId.includes('meeting') || surfaceId.includes('review')) return 'meeting';
    if (surfaceId.includes('test') || surfaceId.includes('e2e') || surfaceId.includes('qc')) return 'report';
    if (surfaceId.includes('task') || surfaceId.includes('cr')) return 'task';
    return 'general';
  }

  /**
   * 推断 V2 文档类型
   */
  private inferDocumentType(surfaceId: string): 'prd' | 'tech_spec' | 'meeting' | 'report' | 'task' | 'general' | 'review' | 'code_review' {
    if (surfaceId.includes('discovery') || surfaceId.includes('prd') || surfaceId.includes('pd')) return 'prd';
    if (surfaceId.includes('planning') || surfaceId.includes('task')) return 'task';
    if (surfaceId.includes('meeting')) return 'meeting';
    if (surfaceId.includes('testing') || surfaceId.includes('test') || surfaceId.includes('e2e') || surfaceId.includes('qc')) return 'report';
    if (surfaceId.includes('review') || surfaceId.includes('cr')) return 'review';
    if (surfaceId.includes('frontend') || surfaceId.includes('backend') || surfaceId.includes('fe') || surfaceId.includes('be')) return 'tech_spec';
    return 'general';
  }

  /**
   * 提取产物内容
   */
  private extractArtifactsContent(artifacts: Record<string, any>): string {
    const parts: string[] = [];
    
    for (const [key, value] of Object.entries(artifacts)) {
      // 跳过内部标记
      if (key.startsWith('__')) continue;
      
      if (typeof value === 'string') {
        parts.push(`## ${key}\n${value}`);
      } else if (typeof value === 'object') {
        parts.push(`## ${key}\n${JSON.stringify(value, null, 2)}`);
      }
    }
    
    return parts.join('\n\n');
  }

  /**
   * 创建本次 Pipeline 的项目、任务、文档绑定脉络
   */
  private createCoordinationBinding(pipeline: PipelineDefinition, instance: PipelineInstance): void {
    if (!this.documentManager) return;

    try {
      const project = this.documentManager.createProject(
        `${pipeline.name} - ${instance.id}`,
        `Pipeline coordination project for ${pipeline.id}. Instance ${instance.id}.`,
      );
      const taskIdsBySurface = new Map<string, string>();

      for (const surface of pipeline.surfaces) {
        if (this.getTaskGraphProjection(pipeline)?.optionalSurfaceIds.includes(surface.id)) continue;
        const task = this.createCoordinationTask(project.id, pipeline, instance, surface);
        taskIdsBySurface.set(surface.id, task.id);
      }

      this.coordinationBindings.set(instance.id, {
        projectId: project.id,
        taskIdsBySurface,
        taskNodeIdsBySurface: new Map(),
        docIdsBySurface: new Map(),
      });
      instance.coordination = this.serializeCoordinationBinding(instance.id);
      this.persistInstanceContext(instance);
      console.log(`[PipelineOrchestrator] 协作脉络已创建: project=${project.id}, tasks=${taskIdsBySurface.size}`);
    } catch (error) {
      console.warn(`[PipelineOrchestrator] 协作脉络创建失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Accepted planning Artifacts define the implementation role Surfaces and their order.
   * A configured projection fails closed instead of falling back to the static fan-out.
   */
  private projectImplementationBatches(
    pipeline: PipelineDefinition,
    instance: PipelineInstance,
    batch: string[],
  ): SurfaceExecutionTarget[][] {
    const implementationSurfaces = pipeline.surfaces.filter((surface) =>
      this.getTaskGraphProjection(pipeline)?.optionalSurfaceIds.includes(surface.id),
    );
    if (implementationSurfaces.length === 0
      || !batch.some((surfaceId) => implementationSurfaces.some((surface) => surface.id === surfaceId))) {
      return [batch.map((surfaceId) => ({ surfaceId }))];
    }

    const projectedTasks = this.readProjectedImplementationTasks(instance, implementationSurfaces);
    this.enforceTaskGraphGovernance(pipeline, instance);
    const surfaceByOwner = new Map(implementationSurfaces.map((surface) => [surface.agent, surface]));

    const taskIds = new Set(projectedTasks.map((task) => task.id));
    for (const task of projectedTasks) {
      const unresolved = task.dependsOn.filter((dependencyId) => !taskIds.has(dependencyId));
      if (unresolved.length > 0) {
        throw new Error(
          `task_graph code_change task ${task.id} depends on unprojected task ${unresolved.join(', ')}`,
        );
      }
    }

    const remaining = new Map(projectedTasks.map((task) => [task.id, task]));
    const completed = new Set<string>();
    const projectedBatches: SurfaceExecutionTarget[][] = [];
    while (remaining.size > 0) {
      const readyCandidates = [...remaining.values()].filter((task) =>
        task.dependsOn.every((dependencyId) => completed.has(dependencyId)),
      );
      if (readyCandidates.length === 0) {
        throw new Error('task_graph projected code_change dependencies cannot be scheduled');
      }
      const ready: ProjectedImplementationTask[] = [];
      const scheduledOwners = new Set<string>();
      for (const task of readyCandidates) {
        if (scheduledOwners.has(task.ownerAgent)) continue;
        scheduledOwners.add(task.ownerAgent);
        ready.push(task);
      }
      projectedBatches.push(ready.map((taskNode) => ({
        surfaceId: surfaceByOwner.get(taskNode.ownerAgent)!.id,
        taskNode,
        taskId: this.canonicalProjectedTaskId(instance.id, taskNode.id),
      })));
      for (const task of ready) {
        completed.add(task.id);
        remaining.delete(task.id);
      }
    }

    const binding = this.coordinationBindings.get(instance.id);
    if (binding && this.documentManager) {
      const planningArtifact = instance.surfaceResults.get(
        this.getTaskGraphProjection(pipeline)!.sourceSurfaceId,
      )!.artifacts!.managedArtifact as ManagedArtifactEnvelope;
      for (const taskNode of projectedTasks) {
        const surface = surfaceByOwner.get(taskNode.ownerAgent)!;
        const task = this.createProjectedCoordinationTask(
          binding.projectId,
          pipeline,
          instance,
          surface,
          taskNode,
          planningArtifact,
        );
        const surfaceTaskIds = binding.taskNodeIdsBySurface.get(surface.id) ?? [];
        surfaceTaskIds.push(task.id);
        binding.taskNodeIdsBySurface.set(surface.id, surfaceTaskIds);
        if (!binding.taskIdsBySurface.has(surface.id)) binding.taskIdsBySurface.set(surface.id, task.id);
      }
      instance.coordination = this.serializeCoordinationBinding(instance.id);
      this.persistInstanceContext(instance);
    }

    return projectedBatches;
  }

  private enforceTaskGraphGovernance(pipeline: PipelineDefinition, instance: PipelineInstance): void {
    const governance = instance.metadata?.governance as {
      profile?: ComplexityProfile;
      selectedMode?: DeliveryMode;
    } | undefined;
    const projection = this.getTaskGraphProjection(pipeline);
    if (!governance?.profile || !governance.selectedMode || !projection) return;

    const artifact = instance.surfaceResults.get(projection.sourceSurfaceId)?.artifacts?.managedArtifact as
      ManagedArtifactEnvelope | undefined;
    const tasks = Array.isArray(artifact?.payload.tasks)
      ? artifact.payload.tasks as Array<Record<string, unknown>>
      : [];
    if (tasks.length === 0) return;

    const normalizedTasks = tasks.map((task) => ({
      id: String(task.id),
      ownerAgent: String(task.ownerAgent),
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
    }));
    const assessment = assessDeliveryGovernance({
      stage: 'task_graph',
      profile: governance.profile,
      confidence: 1,
      independentOutcomeCount: 1,
      repositoryCount: 1,
      roleAgentCount: new Set(normalizedTasks.map((task) => task.ownerAgent)).size,
      estimatedTaskCount: normalizedTasks.length,
      criticalPathLength: longestTaskGraphPath(normalizedTasks),
      hasUnifiedCompletionDefinition: true,
      hasExternalDependencies: false,
      hasIrreversibleChange: governance.profile.risk >= 2,
    });
    const quickExceeded = governance.selectedMode === 'quick' && normalizedTasks.length > 3;
    if (assessment.workLevel !== 'program' && !quickExceeded) return;

    const selectedMode = assessment.workLevel === 'program' ? 'program' : 'standard';
    instance.metadata = {
      ...instance.metadata,
      governance: { ...assessment, selectedMode, replanRequired: true },
    };
    this.persistInstanceContext(instance);
    const reason = quickExceeded
      ? `Quick 规划产生 ${normalizedTasks.length} 个任务，超过上限 3；请改用 Standard。`
      : assessment.reasons.join(' ');
    throw new Error(`DELIVERY_REPLAN_REQUIRED: ${reason}`);
  }

  private readProjectedImplementationTasks(
    instance: PipelineInstance,
    implementationSurfaces: SurfaceDefinition[],
  ): ProjectedImplementationTask[] {
    const projection = this.getTaskGraphProjection(
      this.pipelines.get(instance.pipelineId),
    );
    if (!projection) throw new Error('task_graph projection configuration is missing');
    const artifact = instance.surfaceResults.get(projection.sourceSurfaceId)?.artifacts?.managedArtifact as
      ManagedArtifactEnvelope | undefined;
    if (!artifact) {
      throw new Error(`task_graph projection requires an Artifact from ${projection.sourceSurfaceId}`);
    }
    const validation = validateManagedArtifactEnvelope(projection.sourceSurfaceId, artifact);
    if (!validation.valid) {
      throw new Error(`task_graph projection requires an accepted Artifact: ${validation.issues.join('; ')}`);
    }

    const tasks = Array.isArray(artifact.payload.tasks)
      ? artifact.payload.tasks as Array<Record<string, unknown>>
      : [];
    const implementationTasks = tasks
      .filter((task) => task.expectedArtifactKind === 'code_change')
      .map((task) => ({
        id: String(task.id),
        title: String(task.title),
        ownerAgent: String(task.ownerAgent),
        dependsOn: [...task.dependsOn as string[]],
        allowedPaths: [...task.allowedPaths as string[]],
        acceptanceIds: [...task.acceptanceIds as string[]],
        expectedArtifactKind: String(task.expectedArtifactKind),
        expectedMutation: task.expectedMutation === true,
      }));
    if (implementationTasks.length === 0) {
      throw new Error('Accepted task_graph has no code_change task for an optional implementation Surface');
    }

    const optionalAgents = new Set(implementationSurfaces.map((surface) => surface.agent));
    const unknownOwners = Array.from(new Set(implementationTasks
      .map((task) => task.ownerAgent)
      .filter((ownerAgent): ownerAgent is string =>
        typeof ownerAgent === 'string' && !optionalAgents.has(ownerAgent),
      )));
    if (unknownOwners.length > 0) {
      throw new Error(
        `task_graph code_change owner ${unknownOwners.join(', ')} does not map to an optional implementation Surface`,
      );
    }

    return implementationTasks;
  }

  private getTaskGraphProjection(
    pipeline: PipelineDefinition | undefined,
  ): PipelineExecutionConfig['taskGraphProjection'] | undefined {
    return pipeline?.context?.execution?.taskGraphProjection;
  }

  private createCoordinationTask(
    projectId: string,
    pipeline: PipelineDefinition,
    instance: PipelineInstance,
    surface: SurfaceDefinition,
  ): Task {
    if (!this.documentManager) throw new Error('DocumentManager is required for coordination tasks');
    return this.documentManager.createTask(
      projectId,
      `${surface.name} (${surface.id})`,
      [
        `Pipeline: ${pipeline.id}`,
        `Instance: ${instance.id}`,
        `Surface: ${surface.id}`,
        `Agent: ${surface.agent}`,
        surface.output?.description ? `Expected output: ${surface.output.description}` : '',
      ].filter(Boolean).join('\n'),
      surface.agent,
    );
  }

  private createProjectedCoordinationTask(
    projectId: string,
    pipeline: PipelineDefinition,
    instance: PipelineInstance,
    surface: SurfaceDefinition,
    taskNode: ProjectedImplementationTask,
    sourceArtifact: ManagedArtifactEnvelope,
  ): Task {
    if (!this.documentManager) throw new Error('DocumentManager is required for coordination tasks');
    const canonicalTaskId = this.canonicalProjectedTaskId(instance.id, taskNode.id);
    return this.documentManager.createTask(
      projectId,
      taskNode.title,
      [
        `Pipeline: ${pipeline.id}`,
        `Instance: ${instance.id}`,
        `Surface: ${surface.id}`,
        `Source task: ${taskNode.id}`,
      ].join('\n'),
      taskNode.ownerAgent,
      {
        id: canonicalTaskId,
        metadata: {
          sourceTaskId: taskNode.id,
          sourceArtifactId: sourceArtifact.artifactId,
          surfaceId: surface.id,
          dependsOn: taskNode.dependsOn.map((dependencyId) =>
            this.canonicalProjectedTaskId(instance.id, dependencyId),
          ),
          sourceDependsOn: taskNode.dependsOn,
          allowedPaths: taskNode.allowedPaths,
          acceptanceIds: taskNode.acceptanceIds,
          expectedArtifactKind: taskNode.expectedArtifactKind,
          expectedMutation: taskNode.expectedMutation,
        },
      },
    );
  }

  private canonicalProjectedTaskId(instanceId: string, sourceTaskId: string): string {
    return `task-${instanceId}-node-${sourceTaskId}`;
  }

  private updateSurfaceTaskStatus(instanceId: string, surfaceId: string, status: Task['status']): void {
    const taskId = this.getSurfaceTaskId(instanceId, surfaceId);
    this.updateTaskStatus(taskId, status);
  }

  private updateTaskStatus(taskId: string | undefined, status: Task['status']): void {
    if (!taskId || !this.documentManager) return;

    try {
      this.documentManager.updateTaskStatus(taskId, status);
    } catch (error) {
      console.warn(`[PipelineOrchestrator] 任务状态更新失败: ${taskId} -> ${status}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private blockUnfinishedSurfaceTasks(pipeline: PipelineDefinition, instance: PipelineInstance): void {
    for (const surface of pipeline.surfaces) {
      for (const taskId of this.getSurfaceTaskIds(instance.id, surface.id)) {
        if (this.documentManager?.getTask(taskId)?.status === 'done') continue;
        this.updateTaskStatus(taskId, 'blocked');
      }
    }
  }

  private getSurfaceTaskIds(instanceId: string, surfaceId: string): string[] {
    const liveBinding = this.coordinationBindings.get(instanceId);
    const liveInstance = this.instances.get(instanceId)?.coordination;
    const state = this.stateManager?.load(instanceId);
    const persisted = (state?.context as PersistedPipelineContext | undefined)?.coordination;
    return Array.from(new Set([
      ...(liveBinding?.taskNodeIdsBySurface.get(surfaceId) ?? []),
      ...(liveInstance?.taskNodeIdsBySurface?.[surfaceId] ?? []),
      ...(persisted?.taskNodeIdsBySurface?.[surfaceId] ?? []),
      liveBinding?.taskIdsBySurface.get(surfaceId),
      liveInstance?.taskIdsBySurface?.[surfaceId],
      persisted?.taskIdsBySurface?.[surfaceId],
    ].filter((taskId): taskId is string => Boolean(taskId))));
  }

  private getSurfaceTaskId(instanceId: string, surfaceId: string): string | undefined {
    const liveBindingTaskId = this.coordinationBindings.get(instanceId)?.taskIdsBySurface.get(surfaceId);
    if (liveBindingTaskId) return liveBindingTaskId;

    const liveInstanceTaskId = this.instances.get(instanceId)?.coordination?.taskIdsBySurface?.[surfaceId];
    if (liveInstanceTaskId) return liveInstanceTaskId;

    const state = this.stateManager?.load(instanceId);
    const context = state?.context as PersistedPipelineContext | undefined;
    return context?.coordination?.taskIdsBySurface?.[surfaceId];
  }

  private serializeCoordinationBinding(instanceId: string): PipelineInstance['coordination'] | undefined {
    const binding = this.coordinationBindings.get(instanceId);
    if (!binding) return undefined;

    return {
      projectId: binding.projectId,
      taskIdsBySurface: Object.fromEntries(binding.taskIdsBySurface),
      taskNodeIdsBySurface: Object.fromEntries(binding.taskNodeIdsBySurface),
      documentIdsBySurface: Object.fromEntries(binding.docIdsBySurface),
    };
  }

  private createDryRunGuard(): DryRunGuard | undefined {
    try {
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim();

      return {
        root,
        baseline: this.readGitPorcelain(root),
      };
    } catch (error) {
      console.warn(`[PipelineOrchestrator] dry-run 仓库副作用检测不可用: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private readGitPorcelain(root: string): string[] {
    const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
    });

    return output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .sort();
  }

  private assertDryRunNoRepositorySideEffects(guard?: DryRunGuard): void {
    if (!guard) return;

    const current = this.readGitPorcelain(guard.root);
    const before = new Set(guard.baseline);
    const after = new Set(current);
    const addedOrChanged = current.filter((line) => !before.has(line));
    const removed = guard.baseline.filter((line) => !after.has(line));
    const diff = [...addedOrChanged, ...removed.map((line) => `removed baseline state: ${line}`)];

    if (diff.length > 0) {
      throw new Error(`Dry-run repository side effect detected. Changed git status entries: ${diff.slice(0, 20).join('; ')}`);
    }
  }

  private finalizeDryRunGuard(guard: DryRunGuard | undefined, instance: PipelineInstance): void {
    if (!guard) return;

    try {
      this.assertDryRunNoRepositorySideEffects(guard);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const alreadyFailedForSameReason = instance.status === 'failed' && instance.error === errorMsg;
      instance.status = 'failed';
      instance.error = errorMsg;
      instance.completedAt = Date.now();

      if (!alreadyFailedForSameReason) {
        if (this.stateManager) this.stateManager.fail(instance.id, errorMsg);
        else eventBus.emit({
          type: 'workflow.failed',
          source: 'workflow',
          timestamp: Date.now(),
          payload: {
            workflowId: instance.id,
            taskId: instance.pipelineId,
            pipelineId: instance.pipelineId,
            error: errorMsg,
          },
        });
      }
    }
  }

  private persistInstanceContext(instance: PipelineInstance): void {
    if (!this.stateManager) return;

    this.stateManager.updateContext(instance.id, {
      coordination: this.serializeCoordinationBinding(instance.id) ?? instance.coordination,
      metadata: instance.metadata,
    });
  }

  private restorePipelineInstances(): PipelineInstance[] {
    if (!this.stateManager) return [];

    return this.stateManager
      .listWorkflows(500, 0)
      .map((state) => this.workflowStateToPipelineInstance(state))
      .filter((instance): instance is PipelineInstance => Boolean(instance));
  }

  private restorePipelineInstance(instanceId: string): PipelineInstance | null {
    if (!this.stateManager) return null;
    const state = this.stateManager.load(instanceId);
    return state ? this.workflowStateToPipelineInstance(state) : null;
  }

  private markInterruptedPipelineRuns(pipelineId: string): void {
    if (!this.stateManager) return;

    const interrupted = this.stateManager
      .listWorkflows(500, 0)
      .filter((state) => {
        const context = state.context as PersistedPipelineContext;
        return (
          context.kind === 'pipeline' &&
          context.pipelineId === pipelineId &&
          state.status === 'running' &&
          !this.instances.has(state.id)
        );
      });

    for (const state of interrupted) {
      this.stateManager.fail(state.id, 'Pipeline interrupted by Gateway restart before completion');
      this.blockPersistedCoordinationTasks(state);
      const failedState = this.stateManager.load(state.id);
      const pipeline = this.pipelines.get(pipelineId);
      const instance = failedState ? this.workflowStateToPipelineInstance(failedState) : null;
      if (pipeline && instance) {
        this.capturePipelineExperience(pipeline, instance);
      }
    }

    if (interrupted.length > 0) {
      console.warn(`[PipelineOrchestrator] 已标记 ${interrupted.length} 个中断的 Pipeline 实例: ${pipelineId}`);
    }
  }

  private blockPersistedCoordinationTasks(state: WorkflowState): void {
    if (!this.documentManager) return;

    const context = state.context as PersistedPipelineContext;
    const taskIds = Array.from(new Set([
      ...Object.values(context.coordination?.taskIdsBySurface ?? {}),
      ...Object.values(context.coordination?.taskNodeIdsBySurface ?? {}).flat(),
    ]));
    for (const taskId of taskIds) {
      try {
        if (this.documentManager.getTask(taskId)?.status === 'done') continue;
        this.documentManager.updateTaskStatus(taskId, 'blocked');
      } catch (error) {
        console.warn(`[PipelineOrchestrator] 中断任务状态更新失败: ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private capturePipelineExperience(pipeline: PipelineDefinition, instance: PipelineInstance): void {
    if (!this.documentManager) return;

    const coordination = this.serializeCoordinationBinding(instance.id) ?? instance.coordination;
    if (!coordination?.projectId) return;
    if (coordination.documentIdsBySurface?._experience) return;

    const taskIds = Array.from(new Set([
      ...Object.values(coordination.taskIdsBySurface || {}),
      ...Object.values(coordination.taskNodeIdsBySurface || {}).flat(),
    ]));
    const existingDocIds = Object.values(coordination.documentIdsBySurface || {});
    const activeSurfaces = pipeline.surfaces.filter((surface) =>
      Boolean(instance.surfaceResults.get(surface.id) || coordination.taskIdsBySurface?.[surface.id]),
    );
    const surfaceLines = activeSurfaces.map((surface) => {
      const result = instance.surfaceResults.get(surface.id);
      const status = result?.status || (instance.status === 'completed' ? 'pending' : 'blocked');
      const error = result?.error ? ` — ${result.error}` : '';
      return `- ${surface.id}: ${status}${error}`;
    });
    const summary = [
      `Pipeline: ${pipeline.name} (${pipeline.id})`,
      `Instance: ${instance.id}`,
      `Status: ${instance.status}`,
      instance.error ? `Error: ${instance.error}` : undefined,
      `Tasks: ${taskIds.length}`,
      `Surface artifacts: ${existingDocIds.length}`,
    ].filter(Boolean).join('\n');

    try {
      const doc = this.documentManager.createDocument({
        title: `Experience: ${pipeline.name} - ${instance.id}`,
        content: [
          '# Pipeline Experience Summary',
          '',
          summary,
          '',
          '## Surface States',
          surfaceLines.join('\n'),
          '',
          '## Reusable Experience',
          '- Preserve the coordination chain between workflow state, Kanban tasks, and documents.',
          '- Treat terminal Pipeline states as explicit team state, not only runtime control flow.',
          '- Keep this run available as evidence for future planning and retrospectives.',
        ].join('\n'),
        type: 'report',
        projectId: coordination.projectId,
        taskId: coordination.taskIdsBySurface?.retrospective,
        authorId: 'system',
        authorName: 'Pipeline Experience',
        tags: ['experience', 'pipeline-summary', pipeline.id, instance.status],
        relatedDocIds: existingDocIds,
        relatedTaskIds: taskIds,
        relatedAgentIds: Array.from(new Set(activeSurfaces.map((surface) => surface.agent))),
        metadata: {
          instanceId: instance.id,
          pipelineId: pipeline.id,
          status: instance.status,
          error: instance.error,
          taskCount: taskIds.length,
          artifactCount: existingDocIds.length,
          runMetadata: instance.metadata,
          capturedAt: Date.now(),
        },
      });

      const nextCoordination = {
        ...coordination,
        documentIdsBySurface: {
          ...coordination.documentIdsBySurface,
          _experience: doc.id,
        },
      };
      const binding = this.coordinationBindings.get(instance.id);
      binding?.docIdsBySurface.set('_experience', doc.id);
      instance.coordination = nextCoordination;
      this.persistInstanceContext(instance);

      eventBus.emit({
        type: 'experience.captured',
        source: 'experience',
        timestamp: Date.now(),
        payload: {
          experienceId: doc.id,
          workflowId: instance.id,
          pipelineId: pipeline.id,
          projectId: coordination.projectId,
          status: instance.status,
          summary,
          metadata: {
            taskCount: taskIds.length,
            artifactCount: existingDocIds.length,
          },
        },
      });
    } catch (error) {
      console.warn(`[PipelineOrchestrator] 经验沉淀失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private workflowStateToPipelineInstance(state: WorkflowState): PipelineInstance | null {
    const context = state.context as PersistedPipelineContext;
    if (context.kind !== 'pipeline' || !context.pipelineId) return null;

    const surfaceResults = new Map<string, SurfaceResult>();
    const executionResults = new Map<string, SurfaceResult>();
    const surfaceIds = context.surfaceIds || [];

    for (const step of state.steps) {
      const surfaceId = step.executionNodeId?.split(':')[0] || surfaceIds[step.index] || step.goal || `step-${step.index}`;
      const restoredResult: SurfaceResult = {
        surfaceId,
        executionNodeId: step.executionNodeId,
        status: step.status,
        artifacts: step.output ? { output: step.output } : undefined,
        logs: [],
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        error: step.error,
      };
      surfaceResults.set(surfaceId, restoredResult);
      if (step.executionNodeId) executionResults.set(step.executionNodeId, restoredResult);
    }

    const startedAt = state.createdAt;
    const terminal = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
    const currentSurface = surfaceIds[state.currentStep];

    return {
      id: state.id,
      pipelineId: context.pipelineId,
      status: state.status,
      surfaceResults,
      executionResults,
      currentSurface,
      startedAt,
      completedAt: terminal ? state.updatedAt : undefined,
      error: state.error,
      workflowStateId: state.id,
      metadata: context.metadata,
      coordination: context.coordination,
    };
  }

  /**
   * 构建 DAG
   */
  private buildDAG(pipeline: PipelineDefinition): Map<string, Set<string>> {
    const dag = new Map<string, Set<string>>();

    // 初始化所有面
    for (const surface of pipeline.surfaces) {
      dag.set(surface.id, new Set());
    }

    // 添加依赖边（循环边不参与 DAG 构建）
    for (const edge of pipeline.edges) {
      if (edge.loop) continue; // 循环边不加入 DAG
      const downstream = Array.isArray(edge.to) ? edge.to : [edge.to];
      for (const toId of downstream) {
        const deps = dag.get(toId) || new Set();
        deps.add(edge.from);
        dag.set(toId, deps);
      }
    }

    return dag;
  }

  /**
   * 拓扑排序（分层执行，支持并行）
   */
  private topologicalSort(dag: Map<string, Set<string>>): string[][] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, Set<string>>();

    // 初始化
    for (const [id, deps] of dag) {
      inDegree.set(id, deps.size);
      if (!adj.has(id)) adj.set(id, new Set());
      for (const dep of deps) {
        const downstream = adj.get(dep) || new Set();
        downstream.add(id);
        adj.set(dep, downstream);
      }
    }

    const batches: string[][] = [];
    const visited = new Set<string>();

    while (visited.size < dag.size) {
      const batch: string[] = [];
      for (const [id, degree] of inDegree) {
        if (degree === 0 && !visited.has(id)) {
          batch.push(id);
        }
      }

      if (batch.length === 0) {
        throw new Error('DAG 存在循环依赖');
      }

      batches.push(batch);
      for (const id of batch) {
        visited.add(id);
        for (const downstream of adj.get(id) || []) {
          inDegree.set(downstream, (inDegree.get(downstream) || 0) - 1);
        }
      }
    }

    return batches;
  }

  /**
   * 执行单个面
   */
  private async executeSurface(
    pipeline: PipelineDefinition,
    surfaceId: string,
    instance: PipelineInstance,
    initialInput?: Record<string, any>,
    options: PipelineExecuteOptions = {},
    executionTarget: SurfaceExecutionTarget = { surfaceId },
  ): Promise<SurfaceResult> {
    this.throwIfCancelled(options.signal);
    const surfaceDef = pipeline.surfaces.find((s) => s.id === surfaceId);
    if (!surfaceDef) {
      throw new Error(`面 ${surfaceId} 未定义`);
    }

    console.log(`[PipelineOrchestrator] 执行面: ${surfaceId} (${surfaceDef.name})`);
    instance.currentSurface = surfaceId;
    const executionTaskId = executionTarget.taskId
      ?? this.coordinationBindings.get(instance.id)?.taskIdsBySurface.get(surfaceId);
    const binding = this.coordinationBindings.get(instance.id);
    if (executionTarget.taskNode && executionTaskId && binding) {
      binding.taskIdsBySurface.set(surfaceId, executionTaskId);
      instance.coordination = this.serializeCoordinationBinding(instance.id);
      this.persistInstanceContext(instance);
    }
    this.updateTaskStatus(executionTaskId, 'in_progress');

    // 创建面实例（使用 Pipeline instance ID 作为统一预算 session）
    const surface = createSurface(surfaceDef, this.teamOrchestrator, instance.id);

    // 2. 上游面的输出（先定义，后使用）
    const upstreamEdges = pipeline.edges.filter((e) => {
      const downstream = Array.isArray(e.to) ? e.to : [e.to];
      return downstream.includes(surfaceId);
    });

    // 准备输入 - 添加详细调试日志
    console.log(`[PipelineOrchestrator] 准备面 ${surfaceId} 的输入:`);
    console.log(`  - 上游面: [${upstreamEdges.map(e => e.from).join(', ')}]`);
    console.log(`  - 指定来源: ${surfaceDef.input?.from || '无'}`);
    console.log(`  - 已有结果: [${Array.from(instance.surfaceResults.keys()).join(', ')}]`);

    // 1. 初始输入
    if (initialInput && surfaceDef.input?.from === undefined) {
      for (const [key, value] of Object.entries(initialInput)) {
        surface.setInput(key, value);
        console.log(`  ✓ 初始输入: ${key}`);
      }
    }

    // 2. 上游面的输出
    for (const edge of upstreamEdges) {
      const upstreamResult = instance.surfaceResults.get(edge.from);
      console.log(`  - 上游面 ${edge.from} 结果: ${upstreamResult ? '存在' : '不存在'}, artifacts: ${upstreamResult?.artifacts ? '有' : '无'}`);
      if (upstreamResult?.artifacts) {
        const artifactKeys = Object.keys(upstreamResult.artifacts);
        console.log(`  - 上游面 ${edge.from} artifacts keys: [${artifactKeys.join(', ')}]`);
        for (const [key, value] of Object.entries(upstreamResult.artifacts)) {
          surface.setInput(key, value);
          surface.setInput(`${edge.from}.${key}`, value);
          console.log(`  ✓ 从 ${edge.from} 传入: ${key}`);
        }
      }
    }

    // 3. 来自指定面的输入
    if (surfaceDef.input?.from) {
      const fromSurfaceId = surfaceDef.input.from;
      const fromResult = instance.surfaceResults.get(fromSurfaceId);
      console.log(`  - 指定来源 ${fromSurfaceId} 结果: ${fromResult ? '存在' : '不存在'}`);
      if (fromResult?.artifacts) {
        const artifactKeys = Object.keys(fromResult.artifacts);
        console.log(`  - 指定来源 ${fromSurfaceId} artifacts keys: [${artifactKeys.join(', ')}]`);
        if (fromResult.artifacts.prd) {
          surface.setInput('prd', fromResult.artifacts.prd);
          console.log(`  ✓ 从 ${fromSurfaceId} 传入 prd`);
        }
        if (fromResult.artifacts.output) {
          surface.setInput('output', fromResult.artifacts.output);
          console.log(`  ✓ 从 ${fromSurfaceId} 传入 output`);
        }
        for (const [key, value] of Object.entries(fromResult.artifacts)) {
          if (!surface.getInput(key)) {
            surface.setInput(key, value);
            console.log(`  ✓ 从 ${fromSurfaceId} 传入: ${key}`);
          }
        }
      }
    }

    // 打印最终输入
    console.log(`  → 面 ${surfaceId} 最终输入 keys: [${Array.from(surface.getInputKeys()).join(', ')}]`);

    const runningResult: SurfaceResult = {
      surfaceId,
      executionNodeId: executionTarget.taskNode
        ? `${surfaceId}:${executionTarget.taskNode.id}`
        : `surface:${surfaceId}`,
      status: 'running',
      startedAt: Date.now(),
      logs: ['Surface execution started'],
    };
    instance.surfaceResults.set(surfaceId, runningResult);
    instance.executionResults ??= new Map();
    instance.executionResults.set(runningResult.executionNodeId!, runningResult);
    this.updateTaskStatus(executionTaskId, 'in_progress');

    const stepIndex = Math.max(0, pipeline.surfaces.findIndex((s) => s.id === surfaceId));
    const updateWorkflowExecution = executionTarget.taskNode
      ? (updates: Partial<WorkflowStepState>) =>
          this.stateManager?.updateExecutionNode(instance.id, runningResult.executionNodeId!, updates)
      : (updates: Partial<WorkflowStepState>) =>
          this.stateManager?.updateStep(instance.id, stepIndex, updates);
    updateWorkflowExecution({
      agentId: surfaceDef.agent,
      goal: surfaceDef.workflow?.goal || surfaceDef.name,
      output: '',
      status: 'running',
      startedAt: runningResult.startedAt,
    });

    // 执行面
    const result = await surface.execute({
      signal: options.signal,
      timeoutMs: surfaceDef.timeout ?? options.surfaceTimeoutMs ?? pipeline.context?.execution?.surfaceTimeoutMs,
      dryRun: options.dryRun ?? pipeline.context?.execution?.dryRun,
      taskId: executionTaskId,
      taskContract: executionTarget.taskNode ? {
        sourceTaskId: executionTarget.taskNode.id,
        title: executionTarget.taskNode.title,
        ownerAgent: executionTarget.taskNode.ownerAgent,
        dependsOn: executionTarget.taskNode.dependsOn,
        acceptanceIds: executionTarget.taskNode.acceptanceIds,
        allowedPaths: executionTarget.taskNode.allowedPaths,
        expectedArtifactKind: executionTarget.taskNode.expectedArtifactKind,
        expectedMutation: executionTarget.taskNode.expectedMutation,
      } : undefined,
      workspacePolicy: options.workspacePolicies?.[surfaceId],
    });
    result.executionNodeId = runningResult.executionNodeId;
    instance.surfaceResults.set(surfaceId, result);
    instance.executionResults.set(result.executionNodeId!, result);
    this.updateTaskStatus(
      executionTaskId,
      result.status === 'completed' ? 'done' : result.status === 'failed' || result.status === 'cancelled' ? 'blocked' : 'in_progress',
    );

    updateWorkflowExecution({
      agentId: surfaceDef.agent,
      goal: surfaceDef.workflow?.goal || surfaceDef.name,
      output: result.artifacts?.output || result.error || '',
      status: result.status === 'completed'
        ? 'completed'
        : result.status === 'failed'
          ? 'failed'
          : result.status === 'cancelled'
            ? 'cancelled'
            : 'running',
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      error: result.error,
    });

    // 产物自动沉淀到知识中心
    this.sinkToKnowledgeCenter(surfaceId, surfaceDef.name, surfaceDef.agent, result, instance.id);

    return result;
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const reason = signal.reason;
      throw reason instanceof Error ? reason : new Error(String(reason || 'Pipeline cancelled'));
    }
  }

  private assertPipelineDefinition(value: unknown, source: string): PipelineDefinition {
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid Pipeline YAML (${source}): root must be an object`);
    }

    const pipeline = value as Partial<PipelineDefinition>;
    if (!pipeline.id || typeof pipeline.id !== 'string') {
      throw new Error(`Invalid Pipeline YAML (${source}): id is required`);
    }
    if (!pipeline.name || typeof pipeline.name !== 'string') {
      throw new Error(`Invalid Pipeline YAML (${source}): name is required`);
    }
    if (!Array.isArray(pipeline.surfaces) || pipeline.surfaces.length === 0) {
      throw new Error(`Invalid Pipeline YAML (${source}): surfaces must be a non-empty array`);
    }
    if (!Array.isArray(pipeline.edges)) {
      throw new Error(`Invalid Pipeline YAML (${source}): edges must be an array`);
    }

    const surfaceIds = new Set<string>();
    for (const [index, surface] of pipeline.surfaces.entries()) {
      if (!surface?.id || typeof surface.id !== 'string') {
        throw new Error(`Invalid Pipeline YAML (${source}): surfaces[${index}].id is required`);
      }
      if (surfaceIds.has(surface.id)) {
        throw new Error(`Invalid Pipeline YAML (${source}): duplicate surface id "${surface.id}"`);
      }
      if (!surface.name || typeof surface.name !== 'string') {
        throw new Error(`Invalid Pipeline YAML (${source}): surface "${surface.id}" name is required`);
      }
      if (!surface.agent || typeof surface.agent !== 'string') {
        throw new Error(`Invalid Pipeline YAML (${source}): surface "${surface.id}" agent is required`);
      }
      surfaceIds.add(surface.id);
    }

    for (const [index, edge] of pipeline.edges.entries()) {
      if (!edge?.from || typeof edge.from !== 'string' || !surfaceIds.has(edge.from)) {
        throw new Error(`Invalid Pipeline YAML (${source}): edges[${index}].from references an unknown surface`);
      }
      const downstream = Array.isArray(edge.to) ? edge.to : [edge.to];
      if (downstream.length === 0 || downstream.some((surfaceId) => typeof surfaceId !== 'string' || !surfaceIds.has(surfaceId))) {
        throw new Error(`Invalid Pipeline YAML (${source}): edges[${index}].to references an unknown surface`);
      }
    }

    return pipeline as PipelineDefinition;
  }
}

function longestTaskGraphPath(tasks: Array<{ id: string; dependsOn: string[] }>): number {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (taskId: string): number => {
    const cached = memo.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return tasks.length + 1;
    visiting.add(taskId);
    const task = byId.get(taskId);
    const value = task && task.dependsOn.length > 0
      ? 1 + Math.max(...task.dependsOn.map((dependencyId) => depth(dependencyId)))
      : 1;
    visiting.delete(taskId);
    memo.set(taskId, value);
    return value;
  };
  return tasks.length > 0 ? Math.max(...tasks.map((task) => depth(task.id))) : 0;
}

/**
 * 创建 Pipeline 编排器
 */
export function createPipelineOrchestrator(
  teamOrchestrator: TeamOrchestrator,
  stateManager?: WorkflowStateManager,
  knowledgeCenter?: KnowledgeCenter,
  documentManager?: DocumentManager,
): PipelineOrchestrator {
  return new PipelineOrchestrator(teamOrchestrator, stateManager, knowledgeCenter, documentManager);
}
