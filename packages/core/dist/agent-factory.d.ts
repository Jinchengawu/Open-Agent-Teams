/**
 * Agent App — 基于 @open-multi-agent/core 的 HTTP API 层
 *
 * 职责：
 * - 提供 OpenAI 兼容的 /v1/chat/completions 端点
 * - 会话持久化（SessionManager + SQLite）
 * - 健康检查
 * - 委托 TeamOrchestrator 处理所有 Agent 编排
 */
import express from 'express';
import { SessionManager } from './session/SessionManager';
import { TokenBudgetManager } from './telemetry/TokenBudgetManager';
import { TeamOrchestrator } from './team/TeamOrchestrator';
import type { OrchestratorEvent } from './orchestrator/types.js';
export interface AgentAppConfig {
    /** 数据库目录，默认 ~/.dev-agent/data */
    dataDir?: string;
    /** 进度回调（用于 Dashboard 实时展示） */
    onProgress?: (event: OrchestratorEvent) => void;
}
export interface AgentApp {
    app: express.Application;
    sessionManager: SessionManager;
    orchestrator: TeamOrchestrator;
    tokenBudgetManager: TokenBudgetManager;
    pipelineOrchestrator: import('./pipeline/Orchestrator.js').PipelineOrchestrator;
    knowledgeCenter: import('./knowledge/KnowledgeCenter.js').KnowledgeCenter;
    documentManager: import('./knowledge/DocumentManager.js').DocumentManager;
    close: () => Promise<void>;
}
export declare function createAgentApp(config?: AgentAppConfig): Promise<AgentApp>;
//# sourceMappingURL=agent-factory.d.ts.map