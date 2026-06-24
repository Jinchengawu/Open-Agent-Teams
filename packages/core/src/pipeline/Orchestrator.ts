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
 * - 冲突解决（project-admin 仲裁）
 */

import { eventBus } from '../event/EventBus.js';
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';
import type { WorkflowStateManager } from '../session/WorkflowStateManager.js';
import { Surface, createSurface } from './Surface.js';
import type {
  PipelineDefinition,
  PipelineInstance,
  PipelineStatus,
  SurfaceDefinition,
  Edge,
  SurfaceResult,
} from './types.js';
import type { KnowledgeCenter } from '../knowledge/KnowledgeCenter.js';

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

/**
 * Pipeline 编排器
 */
export class PipelineOrchestrator {
  private pipelines: Map<string, PipelineDefinition> = new Map();
  private instances: Map<string, PipelineInstance> = new Map();
  private teamOrchestrator: TeamOrchestrator;
  private stateManager?: WorkflowStateManager;
  private knowledgeCenter?: KnowledgeCenter;
  private loopStates: Map<string, Map<string, LoopState>> = new Map(); // instanceId -> edgeKey -> LoopState

  constructor(
    teamOrchestrator: TeamOrchestrator,
    stateManager?: WorkflowStateManager,
    knowledgeCenter?: KnowledgeCenter,
  ) {
    this.teamOrchestrator = teamOrchestrator;
    this.stateManager = stateManager;
    this.knowledgeCenter = knowledgeCenter;
  }

  /**
   * 设置知识中心（运行时注入）
   */
  setKnowledgeCenter(kc: KnowledgeCenter): void {
    this.knowledgeCenter = kc;
  }

  /**
   * 加载 Pipeline 定义
   */
  loadPipeline(def: PipelineDefinition): void {
    this.pipelines.set(def.id, def);
    console.log(`[PipelineOrchestrator] Pipeline "${def.name}" (${def.id}) 已加载`);
  }

  /**
   * 从 YAML 文件加载（异步，需要解析器）
   */
  async loadFromYaml(_yamlPath: string): Promise<void> {
    // TODO: 实现 YAML 解析
    console.log('[PipelineOrchestrator] YAML 加载待实现');
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
  async execute(pipelineId: string, initialInput?: Record<string, any>): Promise<PipelineInstance> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline "${pipelineId}" 未找到`);
    }

    const instanceId = `pipeline-${Date.now()}`;
    const instance: PipelineInstance = {
      id: instanceId,
      pipelineId,
      status: 'running',
      surfaceResults: new Map(),
      startedAt: Date.now(),
    };

    this.instances.set(instanceId, instance);
    this.loopStates.set(instanceId, new Map());

    console.log(`[PipelineOrchestrator] Pipeline "${pipeline.name}" 开始执行 (instance: ${instanceId})`);

    // 发布 Pipeline 开始事件
    eventBus.emit({
      type: 'workflow.started',
      source: 'workflow',
      timestamp: Date.now(),
      payload: {
        workflowId: instanceId,
        taskId: pipeline.name,
        pipelineId,
      },
    });

    try {
      // 构建 DAG 和执行顺序
      const dag = this.buildDAG(pipeline);
      const executionOrder = this.topologicalSort(dag);

      // 按批次执行（支持并行）
      for (let batchIndex = 0; batchIndex < executionOrder.length; batchIndex++) {
        const batch = executionOrder[batchIndex];
        console.log(`[PipelineOrchestrator] 执行批次: ${batch.join(', ')}`);

        // 并行执行当前批次
        const batchPromises = batch.map((surfaceId) =>
          this.executeSurface(pipeline, surfaceId, instance, initialInput),
        );

        await Promise.all(batchPromises);

        // 检查是否有失败
        const hasFailure = batch.some((sid) => {
          const result = instance.surfaceResults.get(sid);
          return result?.status === 'failed';
        });

        if (hasFailure) {
          console.error(`[PipelineOrchestrator] 批次执行失败，Pipeline 终止`);
          instance.status = 'failed';
          break;
        }

        // 检查循环边：当前批次完成后，检查是否有循环边需要重新执行上游面
        const loopEdges = pipeline.edges.filter((e) => {
          const downstream = Array.isArray(e.to) ? e.to : [e.to];
          // 如果当前批次包含下游面，且该边是循环边
          return e.loop && downstream.some((toId) => batch.includes(toId));
        });

        for (const edge of loopEdges) {
          const downstreamId = Array.isArray(edge.to) ? edge.to[0] : edge.to;
          const downstreamResult = instance.surfaceResults.get(downstreamId);
          
          // 检查 gate 是否通过
          if (downstreamResult && !this.checkGatePassed(downstreamResult, edge)) {
            const edgeKey = `${edge.from}->${downstreamId}`;
            const loopState = this.getOrCreateLoopState(instanceId, edgeKey);
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
            const upstreamResult = await this.executeSurface(pipeline, edge.from, instance, {
              ...initialInput,
              __loop_feedback: feedbackArtifact,
            });

            // 重新执行下游面
            instance.surfaceResults.delete(downstreamId);
            const newDownstreamResult = await this.executeSurface(pipeline, downstreamId, instance, initialInput);

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

      if (instance.status !== 'failed') {
        instance.status = 'completed';
        instance.completedAt = Date.now();

        // 发布 Pipeline 完成事件
        eventBus.emit({
          type: 'workflow.completed',
          source: 'workflow',
          timestamp: Date.now(),
          payload: {
            workflowId: instanceId,
            taskId: pipeline.name,
            pipelineId,
            output: 'Pipeline 执行完成',
          },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      instance.status = 'failed';
      instance.error = errorMsg;
      instance.completedAt = Date.now();

      // 发布 Pipeline 失败事件
      eventBus.emit({
        type: 'workflow.failed',
        source: 'workflow',
        timestamp: Date.now(),
        payload: {
          workflowId: instanceId,
          taskId: pipeline.name,
          pipelineId,
          error: errorMsg,
        },
      });
    }

    // 清理循环状态
    this.loopStates.delete(instanceId);

    return instance;
  }

  /**
   * 获取 Pipeline 实例状态
   */
  getStatus(instanceId: string): PipelineInstance | null {
    return this.instances.get(instanceId) || null;
  }

  /**
   * 列出所有实例（包括已完成和失败的）
   */
  listInstances(): PipelineInstance[] {
    return [...this.instances.values()];
  }

  /**
   * 将实例转换为可序列化对象
   */
  serializeInstance(instance: PipelineInstance): any {
    const surfaceResults: Record<string, SurfaceResult> = {};
    for (const [key, value] of instance.surfaceResults) {
      surfaceResults[key] = value;
    }
    return {
      ...instance,
      surfaceResults,
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
    return [...this.instances.values()].filter((i) => i.status === 'running');
  }

  /**
   * 暂停 Pipeline（待实现）
   */
  async pause(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    instance.status = 'paused';
    console.log(`[PipelineOrchestrator] Pipeline ${instanceId} 已暂停`);
  }

  /**
   * 恢复 Pipeline（待实现）
   */
  async resume(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    instance.status = 'running';
    console.log(`[PipelineOrchestrator] Pipeline ${instanceId} 已恢复`);
  }

  /**
   * 回滚到指定面（待实现）
   */
  async rollback(instanceId: string, surfaceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`实例 ${instanceId} 未找到`);
    console.log(`[PipelineOrchestrator] Pipeline ${instanceId} 回滚到 ${surfaceId}`);
    instance.status = 'rolled_back';

    // TODO: 从缓存恢复上下文
  }

  /**
   * 冲突解决：project-admin 仲裁多 Agent 分歧
   * 
   * 当多个面产生冲突产物时，调用 project-admin 进行仲裁。
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
你是 project-admin，负责解决多 Agent 之间的冲突。

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
      // 调用 project-admin 进行仲裁
      const arbitrationResult = await this.teamOrchestrator.runAgent('project-admin', arbitrationGoal, instanceId);
      const resultText = arbitrationResult.output;
      
      // 解析仲裁结果
      let resolution: ConflictResolution;
      try {
        const parsed = JSON.parse(resultText);
        resolution = {
          resolved: true,
          winner: parsed.winner,
          merged: parsed.merged,
          reason: parsed.reason || 'project-admin 仲裁结果',
        };
      } catch {
        // 如果解析失败，使用原始输出作为理由
        resolution = {
          resolved: true,
          reason: `project-admin 仲裁：${resultText.substring(0, 500)}`,
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
          source: 'project-admin',
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
    result: SurfaceResult,
    instanceId: string,
  ): void {
    if (!this.knowledgeCenter) return;
    if (!result.artifacts) return;

    try {
      // 根据面类型决定文档类型
      const docType = this.inferDocType(surfaceId);
      
      // 提取产物内容
      const content = this.extractArtifactsContent(result.artifacts);
      if (!content) return;

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
  ): Promise<SurfaceResult> {
    const surfaceDef = pipeline.surfaces.find((s) => s.id === surfaceId);
    if (!surfaceDef) {
      throw new Error(`面 ${surfaceId} 未定义`);
    }

    console.log(`[PipelineOrchestrator] 执行面: ${surfaceId} (${surfaceDef.name})`);
    instance.currentSurface = surfaceId;

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

    // 执行面
    const result = await surface.execute();
    instance.surfaceResults.set(surfaceId, result);

    // 产物自动沉淀到知识中心
    this.sinkToKnowledgeCenter(surfaceId, surfaceDef.name, result, instance.id);

    return result;
  }
}

/**
 * 创建 Pipeline 编排器
 */
export function createPipelineOrchestrator(
  teamOrchestrator: TeamOrchestrator,
  stateManager?: WorkflowStateManager,
  knowledgeCenter?: KnowledgeCenter,
): PipelineOrchestrator {
  return new PipelineOrchestrator(teamOrchestrator, stateManager, knowledgeCenter);
}
