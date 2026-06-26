/**
 * Agent App — 基于 @open-multi-agent/core 的 HTTP API 层
 *
 * 职责：
 * - 提供 OpenAI 兼容的 /v1/chat/completions 端点
 * - 会话持久化（SessionManager + SQLite）
 * - 健康检查
 * - 委托 TeamOrchestrator 处理所有 Agent 编排
 */

import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import express from 'express';
import { SessionManager } from './session/SessionManager';
import { WorkflowStateManager } from './session/WorkflowStateManager';
import { TokenBudgetManager } from './telemetry/TokenBudgetManager';
import { TeamOrchestrator, createDevTeamOrchestrator } from './team/TeamOrchestrator';
import type { OrchestratorEvent } from './orchestrator/types.js';
import { setKanbanDatabase, createKanbanTools } from './tools/kanban-tools.js';
import { createDocumentTools } from './tools/document-tools.js';
import { createDocumentToolsV2 } from './tools/document-tools-v2.js';
import { createPipelineOrchestrator } from './pipeline/Orchestrator.js';
import { DEV_TEAM_MINIMUM_LOOP_PIPELINE } from './lifecycle/dev-team-minimum-loop.js';
import { getGlobalKnowledgeCenter } from './knowledge/KnowledgeCenter.js';
import { getGlobalDocumentManager } from './knowledge/DocumentManager.js';

// ============================================================================
// Types
// ============================================================================

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

// 从 AgentRunResult 中提取格式化输出（兼容 content 为 string 或 block[]）
function extractOutput(agentResult: { output: string; success: boolean; messages: { role: string; content: string | { type: string; text?: string }[] }[]; toolCalls: { toolName: string; input: Record<string, unknown>; output: string }[] }): string {
  const allText: string[] = [];
  for (const msg of agentResult.messages) {
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        allText.push(msg.content);
      } else {
        for (const block of msg.content) {
          if ((block.type === 'text' || block.type === 'reasoning') && block.text) {
            allText.push(block.text);
          }
        }
      }
    }
  }
  const combined = allText.join('\n').trim();
  const parts: string[] = [];
  if (combined) parts.push(combined);
  if (agentResult.toolCalls.length > 0) {
    const toolNames = [...new Set(agentResult.toolCalls.map((tc) => tc.toolName))];
    parts.push(`\n📊 执行了 ${agentResult.toolCalls.length} 个操作 (${toolNames.join(', ')})`);
  }
  return parts.join('\n') || (agentResult.success ? '✅ 任务完成' : '❌ 任务失败');
}

// ============================================================================
// Factory
// ============================================================================

export async function createAgentApp(config: AgentAppConfig = {}): Promise<AgentApp> {
  const dataDir = config.dataDir || process.env.AGENT_DB_PATH || path.join(os.homedir(), '.dev-agent/data');
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'sessions.db');

  const sessionManager = new SessionManager(dbPath);
  const workflowStateManager = new WorkflowStateManager(sessionManager.getDb());
  const tokenBudgetManager = new TokenBudgetManager({
    defaultMaxTokens: parseInt(process.env.DEFAULT_TOKEN_BUDGET || '5000000', 10),
    defaultAlertThreshold: 0.9,
  });

  // 初始化看板工具的数据库连接
  setKanbanDatabase(sessionManager.getDb());
  const extraCustomTools = [...createDocumentTools(), ...createDocumentToolsV2(), ...createKanbanTools()];

  const orchestrator = createDevTeamOrchestrator({
    onProgress: config.onProgress,
    workflowStateManager,
    tokenBudgetManager,
    extraCustomTools,
  });

  // 创建知识中心与文档管理器
  const knowledgeCenter = getGlobalKnowledgeCenter({ dbPath: path.join(dataDir, 'knowledge.db') });
  const documentManager = getGlobalDocumentManager({ dbPath: path.join(dataDir, 'documents.db') });
  console.log(`[AgentApp] KnowledgeCenter 已初始化: ${dataDir}/knowledge.db`);
  console.log(`[AgentApp] DocumentManager V2 已初始化: ${dataDir}/documents.db`);

  // 创建 Pipeline 编排器（注入知识中心与 V2 文档管理器）
  const pipelineOrchestrator = createPipelineOrchestrator(orchestrator, workflowStateManager, knowledgeCenter, documentManager);
  pipelineOrchestrator.loadPipeline(DEV_TEAM_MINIMUM_LOOP_PIPELINE);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Per-session concurrency lock
  const sessionLocks = new Map<string, Promise<void>>();

  async function withSessionLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = sessionLocks.get(sessionId) || Promise.resolve();
    const next = prev.then(fn, fn);
    sessionLocks.set(sessionId, next.then(() => {}, () => {}));
    await next;
  }

  // ── Health ──
  app.get('/health', (_req, res) => {
    const status = orchestrator.getStatus();
    res.json({
      status: 'ok',
      framework: '@open-multi-agent/core',
      agents: status.teamAgents.length,
      sharedMemory: status.sharedMemory,
      sessionCount: sessionManager.getSessionCount(),
      messagesProcessed: sessionManager.getTotalMessageCount(),
      uptime: process.uptime(),
    });
  });

  // ── Chat Completions（OpenAI 兼容）──
  app.post('/v1/chat/completions', async (req, res) => {
    try {
      const { messages, sessionId: clientSessionId, mode } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages is required' });
        return;
      }

      // 会话管理
      let sessionId = clientSessionId || '';
      if (!sessionId || !sessionManager.getSession(sessionId)) {
        sessionId = sessionManager.createSession('', clientSessionId || '');
      }

      const messagesArr = messages as { role: string; content: unknown }[];
      const lastUserMsg = [...messagesArr].reverse().find((m) => m.role === 'user');
      const userContent = lastUserMsg?.content;

      if (!userContent) {
        res.status(400).json({ error: 'No user message found' });
        return;
      }

      const userText = typeof userContent === 'string' ? userContent : JSON.stringify(userContent);

      // 保存用户消息
      await withSessionLock(sessionId, async () => {
        const existingMessages = sessionManager.getAllMessages(sessionId);
        const lastStored = existingMessages.filter((m) => m.role === 'user').pop();
        if (!lastStored || lastStored.content !== userText) {
          sessionManager.addMessage(sessionId, 'user', userText, 'user');
        }
      });

      // 设置会话标题（第一条消息）
      const totalUserMessages = sessionManager.getMessages(sessionId).filter((m) => m.role === 'user').length;
      if (totalUserMessages === 1) {
        sessionManager.updateSession(sessionId, { title: userText.substring(0, 100) });
      }

      // 委托给 TeamOrchestrator — 智能路由（自动决策协作模式）
      let result: { output: string; agent: string };

      // 支持显式 mode（客户端可覆盖），否则走智能路由
      if (mode === 'team') {
        // 多 Agent 协同模式（显式指定）
        const teamResult = await orchestrator.runTeam(userText);

        const parts: string[] = [];
        const coordinatorResult = teamResult.agentResults.get('coordinator');
        if (coordinatorResult) {
          const coordinatorOutput = extractOutput(coordinatorResult);
          if (coordinatorOutput) parts.push(coordinatorOutput);
        }
        for (const [name, agentResult] of teamResult.agentResults) {
          if (name !== 'coordinator') {
            const agentOutput = extractOutput(agentResult);
            if (agentOutput) {
              parts.push(`\n---\n## ${name}\n${agentOutput}`);
            }
          }
        }
        const output = parts.length > 0
          ? parts.join('\n')
          : JSON.stringify({ success: teamResult.success, totalTokenUsage: teamResult.totalTokenUsage });

        result = { output, agent: 'team' };
      } else if (mode === 'meeting') {
        // 圆桌会议模式（显式指定）
        const meetingResult = await orchestrator.runMeeting(userText);

        const meetingParts: string[] = [];
        meetingParts.push(`# 🎙️ 会议讨论\n`);
        for (const [name, agentResult] of meetingResult.agentResults) {
          const agentOutput = extractOutput(agentResult);
          if (agentOutput) {
            const agentConfig = orchestrator.getStatus().teamAgents.find((a) => a.name === name);
            const roleLabel = agentConfig ? `（${agentConfig.model}）` : '';
            meetingParts.push(`\n---\n## 🧑‍💼 ${name}${roleLabel}\n${agentOutput}`);
          }
        }
        const meetingOutput = meetingParts.length > 1
          ? meetingParts.join('\n')
          : JSON.stringify({ success: meetingResult.success, totalTokenUsage: meetingResult.totalTokenUsage });

        result = { output: meetingOutput, agent: 'meeting' };
      } else {
        // 智能路由模式 — 由 IntentRouter 自动决策
        const teamResult = await orchestrator.handleRequest(userText);
        const decision = orchestrator.getLastRoutingDecision();

        // 构建结构化输出
        const parts: string[] = [];
        if (decision) {
          parts.push(`🎯 路由决策: ${decision.strategy} | 复杂度: ${decision.complexity}\n理由: ${decision.reasoning}\n`);
        }
        for (const [name, agentResult] of teamResult.agentResults) {
          const agentOutput = extractOutput(agentResult);
          if (agentOutput) {
            parts.push(`\n---\n## ${name}\n${agentOutput}`);
          }
        }
        const output = parts.join('\n');
        const agentName = decision?.primaryAgent || decision?.involvedAgents?.[0] || 'team';

        result = { output, agent: agentName };
      }

      // 保存助手回复
      await withSessionLock(sessionId, async () => {
        sessionManager.addMessage(sessionId, 'assistant', result.output, result.agent);
      });

      res.json({
        id: `chatcmpl-${Date.now()}`,
        sessionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.agent,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result.output },
            finish_reason: 'stop',
          },
        ],
        instance: result.agent,
        routedBy: 'intent-router',
      });
    } catch (error) {
      console.error('[agent-app] Chat error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  // ── Agent List ──
  app.get('/agents', (_req, res) => {
    res.json({ agents: orchestrator.getStatus().teamAgents });
  });

  // ── Session Endpoints ──
  app.get('/v1/sessions', (_req, res) => {
    const sessions = sessionManager.listSessions();
    res.json({ sessions });
  });

  app.get('/v1/sessions/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const messages = sessionManager.getAllMessages(req.params.id);
    res.json({ session, messages });
  });

  // ── Close ──
  const close = async () => {
    await orchestrator.shutdown();
    sessionManager.close();
  };

  return { app, sessionManager, orchestrator, tokenBudgetManager, pipelineOrchestrator, knowledgeCenter, documentManager, close };
}
