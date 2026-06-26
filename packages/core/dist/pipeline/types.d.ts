/**
 * Pipeline 类型定义 — 基于"一体多面"哲学
 *
 * 核心概念：
 * - Surface（面）：每个 Agent 是一个角色面，有明确的输入/输出契约
 * - 面的内部工作流：不对外暴露，由 Agent 自己管理
 * - 编排（Orchestration）：面与面的连接（串联/并联）
 */
import type { TokenUsage } from '../orchestrator/types.js';
/** 输入契约 */
export interface InputContract {
    /** 必需输入 */
    required?: string[];
    /** 可选输入 */
    optional?: string[];
    /** 来源面（如 "pd"） */
    from?: string;
}
/** 输出契约 */
export interface OutputContract {
    /** 产出物类型 */
    artifacts?: string[];
    /** 格式 */
    format?: string;
    /** 描述 */
    description?: string;
}
/** 面定义 — 每个 Agent 是一个角色面 */
export interface SurfaceDefinition {
    /** 面标识 */
    id: string;
    /** 面名称 */
    name: string;
    /** 执行 Agent */
    agent: string;
    /** 输入契约 */
    input?: InputContract;
    /** 输出契约 */
    output?: OutputContract;
    /** 内部工作流（不暴露）— Agent 自己执行 */
    workflow?: SurfaceWorkflow;
    /** 出口关卡（可选） */
    gate?: GateDefinition;
    /** 超时（毫秒） */
    timeout?: number;
    /** 重试次数 */
    retries?: number;
}
/** 面内部工作流（由 Agent 自己执行） */
export interface SurfaceWorkflow {
    /** 工作流目标描述 */
    goal: string;
    /** 步骤（可选，用于 Agent 参考） */
    steps?: string[];
    /** 工具白名单 */
    tools?: string[];
    /** 上下文提示 */
    context?: string;
}
/** 关卡定义 */
export interface GateDefinition {
    /** 关卡类型 */
    type: 'approve' | 'check' | 'auto';
    /** 审批人 */
    approvers?: string[];
    /** 检查条件 */
    condition?: string;
    /** 是否支持回滚 */
    rollback?: boolean;
    /** 超时（毫秒） */
    timeout?: number;
}
/** 连接边 — 面与面的连接 */
export interface Edge {
    /** 上游面 */
    from: string;
    /** 下游面（支持并联） */
    to: string | string[];
    /** 条件（可选） */
    condition?: string;
    /** 描述 */
    description?: string;
    /** 是否支持循环（gate 失败时返回上游面） */
    loop?: boolean;
    /** 最大循环次数（默认 3） */
    maxLoops?: number;
    /** 循环计数器（运行时状态） */
    loopCount?: number;
}
/** Pipeline 定义 */
export interface PipelineDefinition {
    /** Pipeline ID */
    id: string;
    /** Pipeline 名称 */
    name: string;
    /** 版本 */
    version?: string;
    /** 面列表 */
    surfaces: SurfaceDefinition[];
    /** 连接边 */
    edges: Edge[];
    /** 全局上下文 */
    context?: PipelineContext;
}
/** Pipeline 全局上下文 */
export interface PipelineContext {
    /** 描述 */
    description?: string;
    /** 全局工具 */
    tools?: string[];
    /** 缓存配置 */
    cache?: CacheConfig;
    /** 执行配置 */
    execution?: PipelineExecutionConfig;
}
/** Pipeline 执行配置 */
export interface PipelineExecutionConfig {
    /** 每个 Surface 默认超时（毫秒） */
    surfaceTimeoutMs?: number;
    /** 是否禁止仓库写入类副作用 */
    dryRun?: boolean;
}
/** 缓存配置 */
export interface CacheConfig {
    /** 是否启用压缩 */
    compression?: boolean;
    /** 保留时间 */
    retention?: string;
    /** 最大上下文长度 */
    maxContextLength?: number;
}
/** Pipeline 执行状态 */
export type PipelineStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
/** 面执行状态 */
export type SurfaceStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'skipped';
/** 面执行结果 */
export interface SurfaceResult {
    /** 面 ID */
    surfaceId: string;
    /** 状态 */
    status: SurfaceStatus;
    /** 输出产物 */
    artifacts?: Record<string, any>;
    /** 执行日志 */
    logs?: string[];
    /** 开始时间 */
    startedAt?: number;
    /** 完成时间 */
    completedAt?: number;
    /** 错误信息 */
    error?: string;
    /** Token 使用 */
    tokenUsage?: TokenUsage;
}
/** Pipeline 执行实例 */
export interface PipelineInstance {
    /** 实例 ID */
    id: string;
    /** Pipeline 定义 ID */
    pipelineId: string;
    /** 状态 */
    status: PipelineStatus;
    /** 各面结果 */
    surfaceResults: Map<string, SurfaceResult>;
    /** 当前执行的面 */
    currentSurface?: string;
    /** 开始时间 */
    startedAt: number;
    /** 完成时间 */
    completedAt?: number;
    /** 错误信息 */
    error?: string;
    /** 持久化工作流 ID（通常等于实例 ID） */
    workflowStateId?: string;
    /** 项目/任务/文档绑定投影，用于 Dashboard 展示协作脉络 */
    coordination?: {
        projectId: string;
        taskIdsBySurface: Record<string, string>;
        documentIdsBySurface: Record<string, string>;
    };
}
/** Pipeline 执行选项 */
export interface PipelineExecuteOptions {
    /** 外部取消信号 */
    signal?: AbortSignal;
    /** 本次执行是否禁止仓库写入类副作用 */
    dryRun?: boolean;
    /** Surface 默认超时（毫秒） */
    surfaceTimeoutMs?: number;
}
/** Pipeline 事件类型 */
export type PipelineEventType = 'pipeline.started' | 'pipeline.surface_started' | 'pipeline.surface_completed' | 'pipeline.surface_failed' | 'pipeline.gate_approved' | 'pipeline.gate_rejected' | 'pipeline.completed' | 'pipeline.failed' | 'pipeline.rolled_back';
/** Pipeline 事件 */
export interface PipelineEvent {
    type: PipelineEventType;
    pipelineId: string;
    instanceId: string;
    surfaceId?: string;
    timestamp: number;
    payload: Record<string, any>;
}
/** Pipeline 编排器接口 */
export interface IPipelineOrchestrator {
    /** 加载 Pipeline 定义 */
    loadPipeline(def: PipelineDefinition): void;
    /** 卸载 Pipeline 定义 */
    unloadPipeline(pipelineId: string): boolean;
    /** 从 YAML 加载 */
    loadFromYaml(yamlPath: string): Promise<PipelineDefinition>;
    /** 从 YAML 文本加载 */
    loadFromYamlContent(yamlContent: string, source?: string): PipelineDefinition;
    /** 执行 Pipeline */
    execute(pipelineId: string, initialInput?: Record<string, any>, options?: PipelineExecuteOptions): Promise<PipelineInstance>;
    /** 后台启动 Pipeline */
    start(pipelineId: string, initialInput?: Record<string, any>, options?: PipelineExecuteOptions): PipelineInstance;
    /** 取消 Pipeline */
    cancel(instanceId: string, reason?: string): Promise<void>;
    /** 获取 Pipeline 状态 */
    getStatus(instanceId: string): PipelineInstance | null;
    /** 列出所有 Pipeline */
    listPipelines(): PipelineDefinition[];
    /** 列出运行中的实例 */
    listRunningInstances(): PipelineInstance[];
    /** 暂停 Pipeline */
    pause(instanceId: string): Promise<void>;
    /** 恢复 Pipeline */
    resume(instanceId: string): Promise<void>;
    /** 回滚到指定面 */
    rollback(instanceId: string, surfaceId: string): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map