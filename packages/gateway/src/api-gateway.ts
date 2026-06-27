/**
 * API Gateway — Open-Agent-Teams 统一入口
 *
 * 职责：
 * 1. 统一 HTTP 入口（Dashboard → Gateway → Agent）
 * 2. 审计日志
 * 3. 转发请求到 agent-factory 的 Express 应用
 *
 * 编排能力由 @open-multi-agent/core 的 TeamOrchestrator 提供，
 * 本 Gateway 不重复实现路由、限流、熔断等逻辑。
 */

import { createServer } from 'node:http';
import { mkdirSync, existsSync, createWriteStream, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { config } from 'dotenv';
import {
  createA2AMessage,
  createAgentApp,
  createHermesAgentClient,
  isModelSpendGuardEnabled,
  localizeAgents,
  negotiateLocale,
  OPEN_FRAMEWORK_TEAM_PROFILE,
  teamProfileToA2AAgentCards,
} from '@open-agent-teams/core';
import type { OrchestratorEvent, MeetingProgressEvent } from '@open-agent-teams/core';
import Busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import { loadGatewayConfig } from './config/types.js';
import { writeAuditLog } from './middleware/auditLogger.js';
import { executeRoute } from './router/index.js';

// 加载项目根目录的 .env 文件
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

// 从 AgentRunResult 中提取格式化输出（兼容多种 content 格式）
function extractOutput(agentResult: { output: string; toolCalls: { toolName: string }[]; success: boolean }): string {
  const parts: string[] = [];
  if (agentResult.output) parts.push(agentResult.output);
  if (agentResult.toolCalls.length > 0) {
    const toolNames = [...new Set(agentResult.toolCalls.map((tc) => tc.toolName))];
    parts.push(`📊 执行了 ${agentResult.toolCalls.length} 个操作 (${toolNames.join(', ')})`);
  }
  return parts.join('\n') || (agentResult.success ? '✅ 任务完成' : '❌ 任务失败');
}

function toProviderSafeMessages(messages: { role: string; content: unknown }[]): { role: 'user' | 'assistant'; content: string }[] {
  const safeMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  const systemMessages: string[] = [];

  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    if (message.role === 'system') {
      systemMessages.push(content);
    } else if (message.role === 'assistant' || message.role === 'user') {
      safeMessages.push({ role: message.role, content });
    }
  }

  if (systemMessages.length === 0) return safeMessages;
  const folded = `System instructions:\n${systemMessages.join('\n\n')}`;
  const firstUserIndex = safeMessages.findIndex((message) => message.role === 'user');
  if (firstUserIndex >= 0) {
    safeMessages[firstUserIndex] = {
      role: 'user',
      content: `${folded}\n\nUser request:\n${safeMessages[firstUserIndex].content}`,
    };
  } else {
    safeMessages.unshift({ role: 'user', content: folded });
  }
  return safeMessages;
}

function serializeWorkflow(workflow: any): Record<string, unknown> {
  const context = workflow.context || {};
  const coordination = context.coordination || {};
  const isPipelineWorkflow = context.kind === 'pipeline' || Boolean(context.pipelineId);

  return {
    id: workflow.id,
    session_id: context.sessionId || context.session_id || workflow.id,
    template: context.pipelineId || workflow.goal,
    pipeline_instance_id: isPipelineWorkflow ? workflow.id : undefined,
    pipeline_id: context.pipelineId,
    project_id: coordination.projectId,
    coordination_task_count: coordination.taskIdsBySurface ? Object.keys(coordination.taskIdsBySurface).length : 0,
    goal: workflow.goal,
    status: workflow.status,
    current_step: workflow.currentStep,
    total_steps: workflow.totalSteps,
    steps: workflow.steps || [],
    token_usage: workflow.tokenUsage || { input_tokens: 0, output_tokens: 0 },
    error: workflow.error,
    created_at: new Date(workflow.createdAt).toISOString(),
    updated_at: new Date(workflow.updatedAt).toISOString(),
    pipeline_url: isPipelineWorkflow ? `/pipeline?instanceId=${encodeURIComponent(workflow.id)}` : undefined,
    knowledge_url: coordination.projectId ? `/knowledge?projectId=${encodeURIComponent(coordination.projectId)}` : undefined,
    kanban_url: coordination.projectId ? '/kanban?source=coordination' : undefined,
  };
}

function withPipelineNavigation(serialized: Record<string, any>): Record<string, unknown> {
  const instanceId = serialized.id ? String(serialized.id) : '';
  const projectId = serialized.coordination?.projectId ? String(serialized.coordination.projectId) : '';
  return {
    ...serialized,
    pipeline_url: instanceId ? `/pipeline?instanceId=${encodeURIComponent(instanceId)}` : undefined,
    knowledge_url: projectId ? `/knowledge?projectId=${encodeURIComponent(projectId)}` : undefined,
    kanban_url: projectId ? '/kanban?source=coordination' : undefined,
  };
}

const A2A_AGENT_CARDS = teamProfileToA2AAgentCards(OPEN_FRAMEWORK_TEAM_PROFILE);

function getA2AAgentId(card: Record<string, any>): string {
  return String(card.metadata?.agentId || card.name);
}

function pipelineToTemplate(pipeline: any): Record<string, unknown> {
  const definition = serializePipelineDefinition(pipeline);
  return {
    id: definition.id,
    name: definition.name,
    description: definition.context?.description || '',
    source: definition.source,
    deletable: definition.deletable,
    steps: (definition.surfaces || []).map((surface: any, index: number) => ({
      agentId: surface.agent,
      order: index,
      description: surface.name,
      surfaceId: surface.id,
    })),
  };
}

function createRequestAbortSignal(res: { writableEnded: boolean; on: (event: string, listener: () => void) => unknown }): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort(new Error('HTTP client disconnected'));
    }
  });
  return controller.signal;
}

function getDataDir(): string {
  return process.env.AGENT_DB_PATH || join(homedir(), '.open-agent-teams/data');
}

function getRuntimePipelinesDir(): string {
  return join(getDataDir(), 'pipelines');
}

function pipelineFileName(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9_.-]/g, '_')}.yaml`;
}

function runtimePipelinePath(id: string): string {
  return join(getRuntimePipelinesDir(), pipelineFileName(id));
}

async function loadRuntimePipelines(agentApp: Awaited<ReturnType<typeof createAgentApp>>): Promise<void> {
  const dir = getRuntimePipelinesDir();
  if (!existsSync(dir)) return;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const filePath = join(dir, file);
    try {
      await agentApp.pipelineOrchestrator.loadFromYaml(filePath);
      console.log(`[Gateway] Runtime Pipeline YAML 已加载: ${filePath}`);
    } catch (error) {
      console.warn(`[Gateway] Runtime Pipeline YAML 加载失败: ${filePath}`, error);
    }
  }
}

function serializePipelineDefinition(pipeline: Record<string, any>): Record<string, any> {
  const deletable = existsSync(runtimePipelinePath(String(pipeline.id)));
  return {
    ...pipeline,
    source: deletable ? 'runtime-yaml' : 'builtin',
    deletable,
  };
}

async function getHermesAgentHealth(): Promise<Record<string, any>> {
  const client = createHermesAgentClient();
  const statuses = await client.healthCheckAll(1500);
  const modelSpendGuard = isModelSpendGuardEnabled();
  const agents = client.getInstances().map((instance) => {
    const status = statuses.get(instance.id) || { online: false, latency: -1 };
    return {
      id: instance.id,
      name: instance.id,
      label: instance.label,
      online: status.online,
      latencyMs: status.latency,
      hermesPort: instance.hermes_port || instance.port,
      tags: instance.tags,
      skills: instance.skills.length,
      error: status.online ? undefined : 'Hermes health check failed',
    };
  });
  const onlineCount = agents.filter((agent) => agent.online).length;

  return {
    timestamp: Date.now(),
    onlineCount,
    totalAgents: agents.length,
    totalSkills: agents.reduce((sum, agent) => sum + agent.skills, 0),
    livePipelineReady: !modelSpendGuard && onlineCount === agents.length && agents.length > 0,
    modelSpendGuard,
    codexBackfillReady: modelSpendGuard,
    agents,
  };
}

function getRequestLocale(req: { headers: Record<string, any> }, url: URL) {
  return negotiateLocale({
    queryLang: url.searchParams.get('lang'),
    acceptLanguage: req.headers['accept-language'],
  });
}

function writeJson(res: any, status: number, payload: unknown, locale?: string) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(locale ? { 'Content-Language': locale } : {}),
  });
  res.end(JSON.stringify(payload));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const config = loadGatewayConfig();

  console.log('🧠 Open-Agent-Teams Gateway');
  console.log('==========================');
  console.log(`📦 编排框架: @open-multi-agent/core`);
  console.log(`🔗 端口: ${config.host}:${config.port}`);
  console.log('');

  // 创建 agent app（内含 TeamOrchestrator + SessionManager + Express 路由 + PipelineOrchestrator）
  let agentApp: Awaited<ReturnType<typeof createAgentApp>> | null = null;
  let startupError: string | null = null;
  try {
    agentApp = await createAgentApp({
      onProgress: (event: OrchestratorEvent) => {
        if (event.type === 'task_start' || event.type === 'task_complete') {
          console.log(`[progress] ${event.type}: ${event.task ?? ''}`);
        }
      },
    });
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
    console.warn('[Gateway] Core AgentApp 初始化失败，进入 degraded 模式:', startupError);
  }

  // 加载示例 Pipeline
  if (agentApp) {
    try {
      const yamlPath = resolve(__dirname, '../../core/src/pipeline/examples/team-lifecycle.yaml');
      await agentApp.pipelineOrchestrator.loadFromYaml(yamlPath);
      console.log(`[Gateway] Pipeline YAML 已加载: ${yamlPath}`);
    } catch (err) {
      console.warn('[Gateway] Pipeline 加载失败:', err);
    }
    await loadRuntimePipelines(agentApp);
  }
  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const locale = getRequestLocale(req, url);

    // 文件上传 — 需要原始 req 流，必须在收集请求体之前处理
    if (path === '/upload' && req.method === 'POST') {
      const uploadDir = join(process.cwd(), 'uploads');
      if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

      const busboy = Busboy({ headers: req.headers });
      const files: Array<{ filename: string; originalname: string; path: string; size: number; mimetype: string }> = [];

      busboy.on('file', (name, file, info) => {
        const ext = info.filename.includes('.') ? info.filename.split('.').pop() : '';
        const filename = `${randomUUID()}${ext ? '.' + ext : ''}`;
        const filepath = join(uploadDir, filename);
        const stream = createWriteStream(filepath);
        let size = 0;
        file.on('data', (chunk: Buffer) => { size += chunk.length; });
        file.pipe(stream);
        files.push({ filename, originalname: info.filename, path: filepath, size, mimetype: info.mimeType });
      });

      busboy.on('close', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files }));
      });

      busboy.on('error', (err: Error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });

      req.pipe(busboy);
      return;
    }

    // 收集请求体
    let body = '';
    for await (const chunk of req) body += chunk;

    // 只解析 JSON 请求体，multipart 等非 JSON 请求体跳过
    let parsedBody: any = {};
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json') && body) {
      try { parsedBody = JSON.parse(body); } catch { parsedBody = {}; }
    }

    // 使用 Express 的 handle 方法
    const expressReq = Object.assign(req, {
      body: parsedBody,
      url: req.url,
      path,
    });

    // 简化处理：直接调用 agent app 的路由
    try {
      if (!agentApp) {
        if (path === '/health' && req.method === 'GET') {
          writeJson(res, 503, {
            status: 'degraded',
            gateway: 'open-agent-teams',
            framework: '@open-multi-agent/core',
            agents: 0,
            sharedMemory: false,
            sessionCount: 0,
            startupError,
            uptime: process.uptime(),
            locale,
          }, locale);
          return;
        }

        if (path === '/a2a/agent-cards' && req.method === 'GET') {
          writeJson(res, 200, {
            protocol: 'A2A',
            profileId: OPEN_FRAMEWORK_TEAM_PROFILE.id,
            degraded: true,
            startupError,
            cards: A2A_AGENT_CARDS,
          }, locale);
          return;
        }

        if (path.match(/^\/a2a\/agent-cards\/[^/]+$/) && req.method === 'GET') {
          const agentId = decodeURIComponent(path.split('/')[3] || '');
          const card = A2A_AGENT_CARDS.find((item) => getA2AAgentId(item) === agentId);
          if (!card) {
            writeJson(res, 404, { error: 'A2A agent card not found', agentId }, locale);
            return;
          }
          writeJson(res, 200, { ...card, degraded: true, startupError }, locale);
          return;
        }

        writeJson(res, 503, {
          error: 'Gateway core is unavailable',
          status: 'degraded',
          startupError,
        }, locale);
        return;
      }

      // 健康检查
      if (path === '/health' && req.method === 'GET') {
        const status = agentApp.orchestrator.getStatus();
        const response = {
          status: 'ok',
          gateway: 'open-agent-teams',
          framework: '@open-multi-agent/core',
          agents: status.teamAgents.length,
          sharedMemory: status.sharedMemory,
          sessionCount: agentApp.sessionManager.getSessionCount(),
          uptime: process.uptime(),
        };
        writeJson(res, 200, { ...response, locale }, locale);
        writeAuditLog({
          timestamp: new Date().toISOString(),
          method: 'GET',
          path,
          status: 200,
          latencyMs: Date.now() - startTime,
        }, config.auditFile);
        return;
      }

      // Agent 列表
      if (path === '/agents' && req.method === 'GET') {
        const agents = agentApp.orchestrator.getStatus().teamAgents;
        writeJson(res, 200, { locale, agents: localizeAgents(agents, locale) }, locale);
        writeAuditLog({
          timestamp: new Date().toISOString(),
          method: 'GET',
          path,
          status: 200,
          latencyMs: Date.now() - startTime,
        }, config.auditFile);
        return;
      }

      if (path === '/a2a/agent-cards' && req.method === 'GET') {
        writeJson(res, 200, {
          protocol: 'A2A',
          profileId: OPEN_FRAMEWORK_TEAM_PROFILE.id,
          cards: A2A_AGENT_CARDS,
        }, locale);
        return;
      }

      if (path.match(/^\/a2a\/agent-cards\/[^/]+$/) && req.method === 'GET') {
        const agentId = decodeURIComponent(path.split('/')[3] || '');
        const card = A2A_AGENT_CARDS.find((item) => getA2AAgentId(item) === agentId);
        if (!card) {
          writeJson(res, 404, { error: 'A2A agent card not found', agentId }, locale);
          return;
        }
        writeJson(res, 200, card, locale);
        return;
      }

      if (path === '/a2a/messages' && req.method === 'GET') {
        const agentId = url.searchParams.get('agentId') || undefined;
        const messages = agentApp.orchestrator.getA2AMessages(agentId);
        writeJson(res, 200, {
          protocol: 'A2A',
          agentId: agentId || null,
          messages,
        }, locale);
        return;
      }

      if (path === '/a2a/tasks' && req.method === 'GET') {
        const limitParam = Number(url.searchParams.get('limit') || 50);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 50;
        const tasks = agentApp.pipelineOrchestrator.listInstances()
          .slice(0, limit)
          .map((instance) => agentApp.pipelineOrchestrator.serializeInstance(instance).a2aTask);
        writeJson(res, 200, {
          protocol: 'A2A',
          tasks,
        }, locale);
        return;
      }

      if (path.match(/^\/a2a\/tasks\/[^/]+$/) && req.method === 'GET') {
        const taskId = decodeURIComponent(path.split('/')[3] || '');
        const instance = agentApp.pipelineOrchestrator.getStatus(taskId);
        if (!instance) {
          writeJson(res, 404, { error: 'A2A task not found', taskId }, locale);
          return;
        }
        writeJson(res, 200, agentApp.pipelineOrchestrator.serializeInstance(instance).a2aTask, locale);
        return;
      }

      if (path === '/agent-health' && req.method === 'GET') {
        const health = await getHermesAgentHealth();
        writeJson(res, 200, { ...health, locale, agents: localizeAgents(health.agents || [], locale) }, locale);
        writeAuditLog({
          timestamp: new Date().toISOString(),
          method: 'GET',
          path,
          status: 200,
          latencyMs: Date.now() - startTime,
        }, config.auditFile);
        return;
      }

      // 工作流列表（Dashboard 工作流页）
      if (path === '/v1/workflows' && req.method === 'GET') {
        const limitParam = Number(url.searchParams.get('limit') || 50);
        const offsetParam = Number(url.searchParams.get('offset') || 0);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 50;
        const offset = Number.isFinite(offsetParam) ? Math.max(Math.trunc(offsetParam), 0) : 0;
        const status = url.searchParams.get('status');
        const pipelineId = url.searchParams.get('pipelineId');
        const projectId = url.searchParams.get('projectId');
        const pipelineInstanceId = url.searchParams.get('pipelineInstanceId');
        const workflows = agentApp.orchestrator.listWorkflows(500, 0)
          .map(serializeWorkflow)
          .filter((workflow) => !status || status === 'all' || workflow.status === status)
          .filter((workflow) => !pipelineId || workflow.pipeline_id === pipelineId)
          .filter((workflow) => !projectId || workflow.project_id === projectId)
          .filter((workflow) => !pipelineInstanceId || workflow.pipeline_instance_id === pipelineInstanceId)
          .slice(offset, offset + limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          workflows,
          filters: {
            status: status || 'all',
            pipelineId: pipelineId || null,
            projectId: projectId || null,
            pipelineInstanceId: pipelineInstanceId || null,
            limit,
            offset,
          },
        }));
        return;
      }

      // 单个工作流状态
      if (path.startsWith('/v1/workflows/') && req.method === 'GET') {
        const workflowId = decodeURIComponent(path.split('/')[3] || '');
        const workflows = agentApp.orchestrator.listWorkflows(500, 0).map(serializeWorkflow);
        const workflow = workflows.find((item) => item.id === workflowId);
        if (!workflow) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Workflow not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workflow }));
        return;
      }

      // 工作流模板（由 Pipeline 定义投影）
      if (path === '/v1/templates' && req.method === 'GET') {
        const templates = agentApp.pipelineOrchestrator.listPipelines().map(pipelineToTemplate);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ templates }));
        return;
      }

      // Pipeline 执行
      if (path === '/v1/pipeline/execute' && req.method === 'POST') {
        const request = parsedBody || {};
        const { pipelineId, initialInput, options = {} } = request;

        if (!pipelineId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'pipelineId is required' }));
          return;
        }

        try {
          const instance = await agentApp.pipelineOrchestrator.execute(pipelineId, initialInput, {
            dryRun: options.dryRun,
            surfaceTimeoutMs: options.surfaceTimeoutMs,
            signal: createRequestAbortSignal(res),
          });
          const serialized = withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...serialized,
            instanceId: instance.id,
          }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg }));
        }
        return;
      }

      // Pipeline 后台启动：立即返回实例，Dashboard 可轮询状态或取消
      if (path === '/v1/pipeline/start' && req.method === 'POST') {
        const request = parsedBody || {};
        const { pipelineId, initialInput, options = {} } = request;

        if (!pipelineId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'pipelineId is required' }));
          return;
        }

        try {
          const instance = agentApp.pipelineOrchestrator.start(pipelineId, initialInput, {
            dryRun: options.dryRun,
            surfaceTimeoutMs: options.surfaceTimeoutMs,
          });
          const serialized = withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance));
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...serialized,
            instanceId: instance.id,
          }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg }));
        }
        return;
      }

      // 列出所有 Pipeline 定义
      if (path === '/pipelines' && req.method === 'GET') {
        const pipelines = agentApp.pipelineOrchestrator.listPipelines().map((pipeline) => serializePipelineDefinition(pipeline));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pipelines }));
        return;
      }

      // 运行时加载 YAML Pipeline 定义。用于注册自定义团队工作流，不写入仓库文件。
      if (path === '/pipelines/load-yaml' && req.method === 'POST') {
        const yamlContent = typeof parsedBody?.yaml === 'string' ? parsedBody.yaml : '';
        const source = typeof parsedBody?.source === 'string' && parsedBody.source.trim()
          ? parsedBody.source.trim()
          : 'api:/pipelines/load-yaml';
        if (!yamlContent.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'yaml is required' }));
          return;
        }

        try {
          const loaded = agentApp.pipelineOrchestrator.loadFromYamlContent(yamlContent, source);
          const runtimeDir = getRuntimePipelinesDir();
          mkdirSync(runtimeDir, { recursive: true });
          writeFileSync(runtimePipelinePath(loaded.id), yamlContent, 'utf8');
          const pipelines = agentApp.pipelineOrchestrator.listPipelines().map((pipeline) => serializePipelineDefinition(pipeline));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pipeline: serializePipelineDefinition(loaded), pipelines }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg }));
        }
        return;
      }

      // 删除运行时注册的 YAML Pipeline。内置 Pipeline 没有运行时文件，禁止删除。
      if (path.match(/^\/pipelines\/[^/]+$/) && req.method === 'DELETE') {
        const pipelineId = decodeURIComponent(path.split('/')[2] || '');
        if (!pipelineId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'pipelineId is required' }));
          return;
        }

        const filePath = runtimePipelinePath(pipelineId);
        if (!existsSync(filePath)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only runtime YAML pipelines can be deleted', deleted: false }));
          return;
        }

        try {
          unlinkSync(filePath);
          const deleted = agentApp.pipelineOrchestrator.unloadPipeline(pipelineId);
          const pipelines = agentApp.pipelineOrchestrator.listPipelines().map((pipeline) => serializePipelineDefinition(pipeline));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: pipelineId, deleted, pipelines: pipelines.map((pipeline) => pipeline.id) }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg, deleted: false }));
        }
        return;
      }

      // 列出所有 Pipeline 实例
      if (path === '/pipeline-instances' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        const pipelineId = url.searchParams.get('pipelineId');
        const limitParam = Number(url.searchParams.get('limit') || 100);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 100;
        const instances = agentApp.pipelineOrchestrator.listInstances()
          .filter((instance) => !status || status === 'all' || instance.status === status)
          .filter((instance) => !pipelineId || instance.pipelineId === pipelineId)
          .slice(0, limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          instances: instances.map((i) => withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(i))),
          filters: { status: status || 'all', pipelineId: pipelineId || null, limit },
        }));
        return;
      }

      // 取消 Pipeline 实例
      if (path.match(/^\/pipeline-instances\/[^/]+\/cancel$/) && req.method === 'POST') {
        const instanceId = path.split('/')[2];
        const reason = typeof parsedBody?.reason === 'string' && parsedBody.reason.trim()
          ? parsedBody.reason.trim()
          : 'Cancelled from Dashboard';

        try {
          await agentApp.pipelineOrchestrator.cancel(instanceId, reason);
          const instance = agentApp.pipelineOrchestrator.getStatus(instanceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(instance ? withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance)) : { ok: true }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          const statusCode = errorMsg.includes('未找到') ? 404 : 409;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: errorMsg,
            supported: statusCode !== 409,
          }));
        }
        return;
      }

      // Pipeline 控制面：明确暴露暂未支持的动作，避免客户端误判为成功。
      if (path.match(/^\/pipeline-instances\/[^/]+\/pause$/) && req.method === 'POST') {
        const instanceId = path.split('/')[2];
        try {
          await agentApp.pipelineOrchestrator.pause(instanceId);
          const instance = agentApp.pipelineOrchestrator.getStatus(instanceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(instance ? withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance)) : { ok: true }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(errorMsg.includes('未找到') ? 404 : 409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg, supported: false }));
        }
        return;
      }

      if (path.match(/^\/pipeline-instances\/[^/]+\/resume$/) && req.method === 'POST') {
        const instanceId = path.split('/')[2];
        try {
          await agentApp.pipelineOrchestrator.resume(instanceId);
          const instance = agentApp.pipelineOrchestrator.getStatus(instanceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(instance ? withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance)) : { ok: true }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(errorMsg.includes('未找到') ? 404 : 409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg, supported: false }));
        }
        return;
      }

      if (path.match(/^\/pipeline-instances\/[^/]+\/rollback$/) && req.method === 'POST') {
        const instanceId = path.split('/')[2];
        const surfaceId = typeof parsedBody?.surfaceId === 'string' ? parsedBody.surfaceId : '';
        if (!surfaceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'surfaceId is required', supported: false }));
          return;
        }

        try {
          await agentApp.pipelineOrchestrator.rollback(instanceId, surfaceId);
          const instance = agentApp.pipelineOrchestrator.getStatus(instanceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(instance ? withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance)) : { ok: true }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          const statusCode = errorMsg.includes('未找到')
            ? 404
            : errorMsg.includes('未定义')
              ? 400
              : 409;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMsg, supported: false }));
        }
        return;
      }

      // Pipeline 协作脉络汇总：实例 -> 项目 -> 任务 -> 文档
      if (path.match(/^\/pipeline-instances\/[^/]+\/coordination$/) && req.method === 'GET') {
        const instanceId = path.split('/')[2];
        const instance = agentApp.pipelineOrchestrator.getStatus(instanceId);
        if (!instance) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Instance not found' }));
          return;
        }

        const serialized = agentApp.pipelineOrchestrator.serializeInstance(instance);
        const coordination = serialized.coordination;
        const dm = agentApp.documentManager;
        const project = coordination?.projectId ? dm.getProject(coordination.projectId) : null;
        const taskIdsBySurface = coordination?.taskIdsBySurface || {};
        const documentIdsBySurface = coordination?.documentIdsBySurface || {};
        const projectId = coordination?.projectId ? String(coordination.projectId) : '';
        const taskById: Record<string, unknown> = {};
        const documentsByTaskId: Record<string, unknown[]> = {};
        const bindings = Object.entries(taskIdsBySurface).map(([surfaceId, taskId]) => {
          const task = dm.getTask(String(taskId));
          const documents = dm.getDocumentsByTask(String(taskId));
          taskById[String(taskId)] = task;
          documentsByTaskId[String(taskId)] = documents;
          return {
            surfaceId,
            taskId,
            task,
            documentId: documentIdsBySurface[surfaceId],
            documents,
            knowledge_url: projectId ? `/knowledge?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(String(taskId))}` : undefined,
          };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          instance: serialized,
          project,
          tasks: Object.values(taskById).filter(Boolean),
          documentsByTaskId,
          bindings,
          navigation: {
            pipeline_url: `/pipeline?instanceId=${encodeURIComponent(instanceId)}`,
            knowledge_url: projectId ? `/knowledge?projectId=${encodeURIComponent(projectId)}` : undefined,
            kanban_url: projectId ? '/kanban?source=coordination' : undefined,
          },
        }));
        return;
      }

      // 获取 Pipeline 实例状态
      if (path.startsWith('/pipeline-instances/') && req.method === 'GET') {
        const instanceId = path.split('/')[2];
        const instance = agentApp.pipelineOrchestrator.getStatus(instanceId);
        if (!instance) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Instance not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(withPipelineNavigation(agentApp.pipelineOrchestrator.serializeInstance(instance))));
        return;
      }

      // Chat Completions
      if (path === '/v1/chat/completions' && req.method === 'POST') {
        const request = body ? JSON.parse(body) : {};
        const { messages, sessionId, mode, agentId: requestedAgentId } = request;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'messages is required' }));
          return;
        }

        const providerSafeMessages = toProviderSafeMessages(messages);
        const lastUserMsg = [...providerSafeMessages].reverse().find((m) => m.role === 'user');
        const userContent = lastUserMsg?.content;
        let userText = typeof userContent === 'string' ? userContent : JSON.stringify(userContent || '');

        // 处理附件（图片转 base64）
        if (request.attachments && Array.isArray(request.attachments)) {
          const imageParts: string[] = [];
          for (const att of request.attachments) {
            if (att.mimetype?.startsWith('image/')) {
              try {
                const { readFile } = await import('node:fs/promises');
                const data = await readFile(att.path);
                const base64 = data.toString('base64');
                imageParts.push(`![${att.originalname}](data:${att.mimetype};base64,${base64})`);
              } catch (e) {
                console.error('[upload] 读取文件失败:', e);
              }
            }
          }
          if (imageParts.length > 0) {
            userText += '\n\n' + imageParts.join('\n');
          }
        }

        // 会话管理
        let sid = sessionId || '';
        if (!sid || !agentApp.sessionManager.getSession(sid)) {
          sid = agentApp.sessionManager.createSession('', sessionId || '');
        }

        // 保存用户消息
        const existingMessages = agentApp.sessionManager.getAllMessages(sid);
        const lastStored = existingMessages.filter((m) => m.role === 'user').pop();
        if (!lastStored || lastStored.content !== userText) {
          agentApp.sessionManager.addMessage(sid, 'user', userText, 'user');
        }

        // 设置标题
        const totalUser = agentApp.sessionManager.getMessages(sid).filter((m) => m.role === 'user').length;
        if (totalUser === 1) {
          agentApp.sessionManager.updateSession(sid, { title: userText.substring(0, 100) });
        }

        // 委托给路由模块
        const result = await executeRoute({
          mode,
          agentId: requestedAgentId,
          userText,
          sessionId: sid,
          agentApp,
        });

        // 保存助手回复
        agentApp.sessionManager.addMessage(sid, 'assistant', result.output, result.agent);

        const response = {
          id: `chatcmpl-${Date.now()}`,
          sessionId: sid,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: result.agent,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: result.output },
            finish_reason: 'stop',
          }],
          instance: result.agent,
          routedBy: result.routedBy,
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

        writeAuditLog({
          timestamp: new Date().toISOString(),
          method: 'POST',
          path,
          status: 200,
          latencyMs: Date.now() - startTime,
          agent: result.agent,
          mode,
        }, config.auditFile);
        return;
      }

      // Sessions
      if (path === '/v1/sessions' && req.method === 'GET') {
        const sessions = agentApp.sessionManager.listSessions();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions }));
        return;
      }

      // Session detail (messages)
      const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === 'GET') {
        const sessionId = sessionMatch[1];
        const session = agentApp.sessionManager.getSession(sessionId);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }
        const messages = agentApp.sessionManager.getAllMessages(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ session, messages }));
        return;
      }

      // Meeting SSE Stream — 流式会议进度
      if (path === '/v1/meeting/stream' && req.method === 'POST') {
        const request = body ? JSON.parse(body) : {};
        const { message, sessionId, topicId } = request;

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message is required' }));
          return;
        }

        // SSE 头
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const sendEvent = (data: Record<string, unknown>) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          // 强制刷新，确保事件立即发送到客户端
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        };

        try {
          // 会话管理
          const sid = sessionId || `meeting-${topicId || Date.now()}`;
          if (!agentApp.sessionManager.getSession(sid)) {
            agentApp.sessionManager.createSession('', sid);
          }
          agentApp.sessionManager.addMessage(sid, 'user', message, 'user');

          sendEvent({
            type: 'start',
            sessionId: sid,
            a2aMessage: createA2AMessage({
              role: 'user',
              contextId: sid,
              text: message,
              metadata: {
                kind: 'meeting.started',
                topicId,
              },
            }),
          });

          const meetingResult = await agentApp.orchestrator.runMeetingWithProgress(
            message,
            (event: MeetingProgressEvent) => {
              sendEvent(event);
            },
          );

          // 组装最终输出
          const parts: string[] = [];
          for (const [name, agentResult] of meetingResult.agentResults) {
            const output = extractOutput(agentResult);
            if (output) {
              const config = agentApp.orchestrator.getStatus().teamAgents.find((a: { name: string }) => a.name === name);
              parts.push(`\n---\n## 🧑‍💼 ${name}${config ? `（${config.model}）` : ''}\n${output}`);
            }
          }
          const finalOutput = parts.join('\n') || '会议完成';

          agentApp.sessionManager.addMessage(sid, 'assistant', finalOutput, 'meeting');

          sendEvent({
            type: 'complete',
            output: finalOutput,
            sessionId: sid,
            a2aMessage: createA2AMessage({
              role: 'agent',
              contextId: sid,
              text: finalOutput,
              metadata: {
                kind: 'meeting.completed',
                participants: Array.from(meetingResult.agentResults.keys()),
                tokenUsage: meetingResult.totalTokenUsage,
              },
            }),
          });
        } catch (err) {
          sendEvent({
            type: 'error',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }

        res.end();
        return;
      }

      // 静态文件服务 — 上传的文件访问
      if (path.startsWith('/uploads/')) {
        const filename = path.replace('/uploads/', '');
        const filepath = join(process.cwd(), 'uploads', filename);
        try {
          const data = await import('node:fs').then(m => m.promises.readFile(filepath));
          const ext = filename.split('.').pop() || '';
          const mimeTypes: Record<string, string> = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
            svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain',
            md: 'text/markdown', json: 'application/json', csv: 'text/csv',
            sql: 'text/plain', yaml: 'text/yaml', yml: 'text/yaml',
          };
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          res.end(data);
        } catch {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
        }
        return;
      }

      // 知识中心 API
      if (path.startsWith('/knowledge') && req.method === 'GET') {
        const kc = agentApp.knowledgeCenter;
        if (!kc) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'KnowledgeCenter not available' }));
          return;
        }

        // /knowledge/search?q=...
        if (path === '/knowledge/search') {
          const q = url.searchParams.get('q') || '';
          const type = url.searchParams.get('type') || undefined;
          const limit = parseInt(url.searchParams.get('limit') || '20', 10);
          const results = kc.search({ q, type, limit, semantic: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ query: q, results }));
          return;
        }

        // /knowledge/stats
        if (path === '/knowledge/stats') {
          const stats = kc.stats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stats));
          return;
        }

        // /knowledge/:id
        const knowledgeIdMatch = path.match(/^\/knowledge\/(.+)$/);
        if (knowledgeIdMatch) {
          const docId = knowledgeIdMatch[1];
          const doc = kc.getDocument(docId);
          if (!doc) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Document not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(doc));
          return;
        }

        // /knowledge (list)
        const type = url.searchParams.get('type') || undefined;
        const source = url.searchParams.get('source') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const docs = kc.listDocuments({ type, source, limit, offset });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ documents: docs, total: docs.length }));
        return;
      }

      // 知识中心自然语言查询
      if (path === '/knowledge/query' && req.method === 'POST') {
        const kc = agentApp.knowledgeCenter;
        if (!kc) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'KnowledgeCenter not available' }));
          return;
        }
        const request = body ? JSON.parse(body) : {};
        const { question, limit } = request;
        if (!question) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'question is required' }));
          return;
        }
        const answer = await kc.query(question, { limit });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer));
        return;
      }

      // ============================================================================
      // DocumentManager V2 API — 增强文档管理
      // ============================================================================
      const dm = agentApp.documentManager;
      if (dm) {
        // 项目 API
        if (path === '/api/v2/projects') {
          if (req.method === 'POST') {
            const { name, description } = JSON.parse(body || '{}');
            const project = dm.createProject(name, description);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(project));
            return;
          }
          if (req.method === 'GET') {
            const projects = dm.listProjects();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ projects }));
            return;
          }
        }

        if (path.match(/^\/api\/v2\/projects\/[^\/]+$/)) {
          const id = path.split('/').pop()!;
          const project = dm.getProject(id);
          if (!project) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Project not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(project));
          return;
        }

        // 任务 API
        if (path === '/api/v2/tasks') {
          if (req.method === 'POST') {
            const { projectId, title, description, assignee } = JSON.parse(body || '{}');
            const task = dm.createTask(projectId, title, description, assignee);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(task));
            return;
          }
          if (req.method === 'GET') {
            const projectId = url.searchParams.get('projectId') || undefined;
            const tasks = dm.listTasks(projectId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ tasks }));
            return;
          }
        }

        const taskIdMatch = path.match(/^\/api\/v2\/tasks\/([^\/]+)$/);
        if (taskIdMatch) {
          const taskId = taskIdMatch[1];
          if (req.method === 'GET') {
            const task = dm.getTask(taskId);
            if (!task) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Task not found' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(task));
            return;
          }
          if (req.method === 'PUT') {
            const updates = JSON.parse(body || '{}');
            if (!updates.status) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'status is required' }));
              return;
            }
            const task = dm.updateTaskStatus(taskId, updates.status);
            if (!task) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Task not found' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(task));
            return;
          }
        }

        // 文档 API
        if (path === '/api/v2/documents') {
          if (req.method === 'POST') {
            const docData = JSON.parse(body || '{}');
            const doc = dm.createDocument(docData);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(doc));
            return;
          }
          if (req.method === 'GET') {
            const projectId = url.searchParams.get('projectId') || undefined;
            const taskId = url.searchParams.get('taskId') || undefined;
            const type = url.searchParams.get('type') || undefined;
            const authorId = url.searchParams.get('authorId') || undefined;
            const sortBy = (url.searchParams.get('sortBy') as any) || 'updatedAt';
            const sortOrder = (url.searchParams.get('sortOrder') as any) || 'desc';
            const limit = parseInt(url.searchParams.get('limit') || '20', 10);
            const offset = parseInt(url.searchParams.get('offset') || '0', 10);
            const result = dm.queryDocuments({ projectId, taskId, type, authorId, sortBy, sortOrder, limit, offset });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
          }
        }

        // 搜索文档
        if (path === '/api/v2/documents/search') {
          const q = url.searchParams.get('q') || '';
          const projectId = url.searchParams.get('projectId') || undefined;
          const taskId = url.searchParams.get('taskId') || undefined;
          const type = url.searchParams.get('type') || undefined;
          const docs = dm.searchDocuments(q, { projectId, taskId, type });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ documents: docs, total: docs.length }));
          return;
        }

        // 单文档操作
        const docIdMatch = path.match(/^\/api\/v2\/documents\/([^\/]+)$/);
        if (docIdMatch) {
          const docId = docIdMatch[1];
          if (req.method === 'GET') {
            const doc = dm.getDocument(docId);
            if (!doc) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Document not found' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(doc));
            return;
          }
          if (req.method === 'PUT') {
            const updates = JSON.parse(body || '{}');
            const doc = dm.updateDocument(docId, updates, updates.authorId, updates.authorName);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(doc));
            return;
          }
          if (req.method === 'DELETE') {
            dm.deleteDocument(docId);
            res.writeHead(204);
            res.end();
            return;
          }
        }

        // 按 Agent 查询
        if (path.match(/^\/api\/v2\/agents\/[^\/]+\/documents$/)) {
          const agentId = path.split('/')[4];
          const projectId = url.searchParams.get('projectId') || undefined;
          const type = url.searchParams.get('type') || undefined;
          const docs = dm.getDocumentsByAgent(agentId, { projectId, type });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ documents: docs, total: docs.length }));
          return;
        }

        // 按 Agent 查询任务
        if (path.match(/^\/api\/v2\/agents\/[^\/]+\/tasks$/)) {
          const agentId = path.split('/')[4];
          const tasks = dm.listTasksByAssignee(agentId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tasks, total: tasks.length }));
          return;
        }

        // 按 Agent 查询最近活动
        if (path.match(/^\/api\/v2\/agents\/[^\/]+\/activities$/)) {
          const agentId = path.split('/')[4];
          const limit = parseInt(url.searchParams.get('limit') || '5', 10);
          const activities = dm.getAgentActivities(agentId, limit);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ activities, total: activities.length }));
          return;
        }

        // 按项目分组
        if (path.match(/^\/api\/v2\/projects\/[^\/]+\/documents$/)) {
          const projectId = path.split('/')[4];
          const grouped = dm.getDocumentsByProject(projectId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ grouped }));
          return;
        }

        // 评论 API
        if (path.match(/^\/api\/v2\/documents\/[^\/]+\/comments$/)) {
          const docId = path.split('/')[4];
          if (req.method === 'POST') {
            const { authorId, authorName, content, parentId } = JSON.parse(body || '{}');
            const comment = dm.addComment({ documentId: docId, authorId, authorName, content, parentId, resolved: false });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(comment));
            return;
          }
          if (req.method === 'GET') {
            const comments = dm.getComments(docId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ comments }));
            return;
          }
        }

        // 评论操作
        const commentMatch = path.match(/^\/api\/v2\/comments\/([^\/]+)\/(resolve|delete)$/);
        if (commentMatch) {
          const commentId = commentMatch[1];
          const action = commentMatch[2];
          if (action === 'resolve') {
            dm.resolveComment(commentId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }
          if (action === 'delete') {
            dm.deleteComment(commentId);
            res.writeHead(204);
            res.end();
            return;
          }
        }

        // 版本历史
        if (path.match(/^\/api\/v2\/documents\/[^\/]+\/versions$/)) {
          const docId = path.split('/')[4];
          const versions = dm.getVersions(docId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ versions }));
          return;
        }

        // 统计
        if (path === '/api/v2/stats') {
          const stats = dm.stats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stats));
          return;
        }
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[gateway] Error:', errorMsg);

      writeAuditLog({
        timestamp: new Date().toISOString(),
        method: req.method || 'GET',
        path,
        status: 500,
        latencyMs: Date.now() - startTime,
        error: errorMsg,
      }, config.auditFile);

      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errorMsg }));
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`✅ Gateway 就绪 → http://${config.host}:${config.port}`);
    console.log('');
    console.log('📡 端点:');
    console.log('  GET  /health               — 健康检查');
    console.log('  GET  /agents               — Agent 列表');
    console.log('  POST /v1/chat/completions  — 对话（OpenAI 兼容）');
    console.log('  GET  /v1/sessions          — 会话列表');
    console.log('');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 正在关闭...');
    await agentApp?.close();
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await agentApp?.close();
    server.close();
    process.exit(0);
  });
}

// Agent ID 映射 — 处理 Dashboard 可能发送的短格式
const AGENT_ID_MAP: Record<string, string> = {
  'router': 'intent-router',
  'intent': 'intent-router',
  'coordinator': 'team-orchestrator',
  'orchestrator': 'team-orchestrator',
  'pm': 'team-orchestrator',
  'project-admin': 'team-orchestrator',
  'frontend': 'workflow-conductor',
  'backend': 'workflow-conductor',
  'testing': 'recovery-agent',
  'devops': 'integration-agent',
  'knowledge': 'knowledge-steward',
  'recovery': 'recovery-agent',
  'integration': 'integration-agent',
};

function normalizeAgentId(agentId: string): string {
  return AGENT_ID_MAP[agentId] || agentId;
}

main().catch((error) => {
  console.error('❌ Gateway 启动失败:', error);
  process.exit(1);
});
