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
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';
import type { WorkflowStateManager } from '../session/WorkflowStateManager.js';
import type { PipelineDefinition, PipelineInstance, PipelineExecuteOptions } from './types.js';
import type { KnowledgeCenter } from '../knowledge/KnowledgeCenter.js';
import type { DocumentManager } from '../knowledge/DocumentManager.js';
interface ConflictResolution {
    resolved: boolean;
    winner?: string;
    merged?: Record<string, any>;
    reason: string;
}
/**
 * Pipeline 编排器
 */
export declare class PipelineOrchestrator {
    private pipelines;
    private instances;
    private teamOrchestrator;
    private stateManager?;
    private knowledgeCenter?;
    private documentManager?;
    private loopStates;
    private controllers;
    private coordinationBindings;
    constructor(teamOrchestrator: TeamOrchestrator, stateManager?: WorkflowStateManager, knowledgeCenter?: KnowledgeCenter, documentManager?: DocumentManager);
    /**
     * 设置知识中心（运行时注入）
     */
    setKnowledgeCenter(kc: KnowledgeCenter): void;
    /**
     * 设置 V2 文档管理器（运行时注入）
     */
    setDocumentManager(dm: DocumentManager): void;
    /**
     * 加载 Pipeline 定义
     */
    loadPipeline(def: PipelineDefinition): void;
    /**
     * 卸载 Pipeline 定义。
     */
    unloadPipeline(pipelineId: string): boolean;
    /**
     * 从 YAML 文件加载 Pipeline 定义。
     */
    loadFromYaml(yamlPath: string): Promise<PipelineDefinition>;
    /**
     * 从 YAML 文本加载 Pipeline 定义。
     */
    loadFromYamlContent(yamlContent: string, source?: string): PipelineDefinition;
    /**
     * 执行 Pipeline
     *
     * 1. 解析 DAG 依赖
     * 2. 按拓扑顺序执行面（支持循环边）
     * 3. 支持并行执行（无依赖的面同时运行）
     * 4. 传递输入/输出产物
     * 5. 产物自动沉淀到知识中心
     */
    execute(pipelineId: string, initialInput?: Record<string, any>, options?: PipelineExecuteOptions): Promise<PipelineInstance>;
    /**
     * 后台启动 Pipeline，立即返回实例；调用方可轮询实例状态。
     */
    start(pipelineId: string, initialInput?: Record<string, any>, options?: PipelineExecuteOptions): PipelineInstance;
    private prepareRun;
    private runPipeline;
    /**
     * 获取 Pipeline 实例状态
     */
    getStatus(instanceId: string): PipelineInstance | null;
    /**
     * 列出所有实例（包括已完成和失败的）
     */
    listInstances(): PipelineInstance[];
    /**
     * 将实例转换为可序列化对象
     */
    serializeInstance(instance: PipelineInstance): any;
    /**
     * 列出所有 Pipeline 定义
     */
    listPipelines(): PipelineDefinition[];
    /**
     * 列出运行中的实例
     */
    listRunningInstances(): PipelineInstance[];
    /**
     * 暂停 Pipeline
     *
     * 当前 Pipeline Surface 执行由 Hermes 请求驱动，尚没有可安全挂起并恢复的
     * checkpoint 协议。这里明确拒绝，避免把内存状态改成 paused 但后台仍在执行。
     */
    pause(instanceId: string): Promise<void>;
    /**
     * 取消 Pipeline
     */
    cancel(instanceId: string, reason?: string): Promise<void>;
    /**
     * 恢复 Pipeline
     *
     * 恢复需要 Surface 级 checkpoint/replay 协议。当前只能从持久化状态恢复只读投影，
     * 不能继续执行未完成的 Surface，因此明确拒绝。
     */
    resume(instanceId: string): Promise<void>;
    /**
     * 回滚到指定面
     *
     * 当前只能恢复状态投影，不能保证 Agent 外部副作用可逆。为避免假回滚，先明确拒绝。
     */
    rollback(instanceId: string, surfaceId: string): Promise<void>;
    /**
     * 冲突解决：profile arbitration agent 仲裁多 Agent 分歧
     *
     * 当多个面产生冲突产物时，调用 profile arbitration agent 进行仲裁。
     * 适用于：
     * - 两个 Agent 对同一需求给出不同实现方案
     * - 代码审查与实现之间的冲突
     * - 多个测试 Agent 给出矛盾的测试结果
     */
    resolveConflict(instanceId: string, surfaceIds: string[], conflictDescription: string): Promise<ConflictResolution>;
    /**
     * 获取或创建循环状态
     */
    private getOrCreateLoopState;
    /**
     * 检查 gate 是否通过
     */
    private checkGatePassed;
    /**
     * 提取 gate 反馈信息
     */
    private extractGateFeedback;
    /**
     * 将产物沉淀到知识中心
     */
    private sinkToKnowledgeCenter;
    /**
     * 推断文档类型
     */
    private inferDocType;
    /**
     * 推断 V2 文档类型
     */
    private inferDocumentType;
    /**
     * 提取产物内容
     */
    private extractArtifactsContent;
    /**
     * 创建本次 Pipeline 的项目、任务、文档绑定脉络
     */
    private createCoordinationBinding;
    private updateSurfaceTaskStatus;
    private blockUnfinishedSurfaceTasks;
    private getSurfaceTaskId;
    private serializeCoordinationBinding;
    private createDryRunGuard;
    private readGitPorcelain;
    private assertDryRunNoRepositorySideEffects;
    private finalizeDryRunGuard;
    private persistInstanceContext;
    private restorePipelineInstances;
    private restorePipelineInstance;
    private markInterruptedPipelineRuns;
    private blockPersistedCoordinationTasks;
    private capturePipelineExperience;
    private workflowStateToPipelineInstance;
    /**
     * 构建 DAG
     */
    private buildDAG;
    /**
     * 拓扑排序（分层执行，支持并行）
     */
    private topologicalSort;
    /**
     * 执行单个面
     */
    private executeSurface;
    private throwIfCancelled;
    private assertPipelineDefinition;
}
/**
 * 创建 Pipeline 编排器
 */
export declare function createPipelineOrchestrator(teamOrchestrator: TeamOrchestrator, stateManager?: WorkflowStateManager, knowledgeCenter?: KnowledgeCenter, documentManager?: DocumentManager): PipelineOrchestrator;
export {};
//# sourceMappingURL=Orchestrator.d.ts.map