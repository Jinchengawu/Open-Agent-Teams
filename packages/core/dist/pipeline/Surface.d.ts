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
import type { SurfaceDefinition, SurfaceResult } from './types.js';
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';
export interface SurfaceExecuteOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    dryRun?: boolean;
}
/**
 * Surface（面）执行器
 */
export declare class Surface {
    private definition;
    private orchestrator;
    private inputArtifacts;
    constructor(def: SurfaceDefinition, orchestrator: TeamOrchestrator, sessionId?: string);
    private isAgentFailureOutput;
    private sessionId;
    /**
     * 获取面 ID
     */
    get id(): string;
    /**
     * 获取面名称
     */
    get name(): string;
    /**
     * 获取 Agent ID
     */
    get agent(): string;
    /**
     * 获取输入契约
     */
    get inputContract(): import("./types.js").InputContract | undefined;
    /**
     * 获取输出契约
     */
    get outputContract(): import("./types.js").OutputContract | undefined;
    /**
     * 设置输入产物
     */
    setInput(key: string, value: any): void;
    /**
     * 获取输入产物
     */
    getInput(key: string): any;
    /**
     * 获取所有输入产物键
     */
    getInputKeys(): string[];
    /**
     * 检查输入是否满足契约
     */
    validateInput(): {
        valid: boolean;
        missing: string[];
    };
    /**
     * 执行面
     *
     * 1. 验证输入契约
     * 2. 构建执行目标（包含输入上下文）
     * 3. 调用 Agent 执行
     * 4. 处理出口关卡
     * 5. 返回输出产物
     */
    execute(options?: SurfaceExecuteOptions): Promise<SurfaceResult>;
    /**
     * 构建执行目标（包含输入上下文）
     */
    private buildGoal;
    /**
     * 从 Agent 输出中提取产物
     */
    private extractArtifacts;
    /**
     * 处理出口关卡
     */
    private processGate;
}
/**
 * 面工厂
 */
export declare function createSurface(definition: SurfaceDefinition, orchestrator: TeamOrchestrator, sessionId?: string): Surface;
//# sourceMappingURL=Surface.d.ts.map