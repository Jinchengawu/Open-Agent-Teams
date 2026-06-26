import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { SessionManager } from './session/SessionManager';
import { MemoryStore } from './memory/MemoryStore';
import { ContextCompressor } from './context/ContextCompressor';
import { RegistryClient } from './bus/RegistryClient';
import { AgentBus } from './bus/AgentBus';
import { MessageType } from './bus/types';
import { mkdirSync } from 'node:fs';
export function createAgentApp(config) {
    const dataDir = process.env.AGENT_DB_PATH || path.join(os.homedir(), '.dev-agent/data');
    mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, `${config.id.replace('dev-', '')}.db`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const sessionManager = new SessionManager(dbPath);
    const memoryStore = new MemoryStore(dbPath);
    const compressor = new ContextCompressor();
    const selfReg = {
        id: config.id,
        label: config.label,
        host: '127.0.0.1',
        port: config.port,
        capabilities: config.tags,
        healthEndpoint: `http://127.0.0.1:${config.port}/health`,
        messageEndpoint: `http://127.0.0.1:${config.port}/agent/message`,
    };
    const registry = new RegistryClient(selfReg);
    const agentBus = new AgentBus(registry);
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    // ── Health ──
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            agent: config.id,
            label: config.label,
            port: config.port,
            hermesPort: config.hermesPort,
            skills: config.skills.length,
            capabilities: config.tags,
            sessionCount: sessionManager.getSessionCount(),
            messagesProcessed: sessionManager.getTotalMessageCount(),
            uptime: process.uptime(),
            peers: registry.getAllAgents().map((a) => ({ id: a.id, label: a.label })),
        });
    });
    // Per-session concurrency lock
    const sessionLocks = new Map();
    async function withSessionLock(sessionId, fn) {
        const prev = sessionLocks.get(sessionId) || Promise.resolve();
        const next = prev.then(fn, fn);
        sessionLocks.set(sessionId, next.then(() => { }, () => { }));
        await next;
    }
    // ── Chat Completions ──
    app.post('/v1/chat/completions', async (req, res) => {
        try {
            const { messages, sessionId: clientSessionId } = req.body;
            let sessionId = clientSessionId || '';
            if (!sessionId || !sessionManager.getSession(sessionId)) {
                sessionId = sessionManager.createSession('', clientSessionId || '');
            }
            const messagesArr = (messages || []);
            await withSessionLock(sessionId, async () => {
                const lastUserMsg = [...messagesArr].reverse().find((m) => m.role === 'user');
                if (lastUserMsg) {
                    // 兼容 OpenAI content 格式（string | array）
                    const contentStr = typeof lastUserMsg.content === 'string'
                        ? lastUserMsg.content
                        : JSON.stringify(lastUserMsg.content);
                    const existingMessages = sessionManager.getAllMessages(sessionId);
                    const lastStored = existingMessages
                        .filter((m) => m.role === 'user')
                        .pop();
                    if (!lastStored || lastStored.content !== contentStr) {
                        sessionManager.addMessage(sessionId, 'user', contentStr, 'user');
                    }
                }
            });
            // Build context from DB + current request
            const allMessages = sessionManager
                .getAllMessages(sessionId)
                .map((m) => ({ role: m.role, content: m.content }));
            const baseSystemPrompt = config.buildSystemPrompt();
            const peerInfo = buildPeerAwarenessPrompt(config);
            const fullSystemPrompt = peerInfo ? `${baseSystemPrompt}\n\n${peerInfo}` : baseSystemPrompt;
            const { systemMessages, chatMessages, compressedCount } = compressor.buildContext(allMessages, fullSystemPrompt);
            // MiMo-V2.5-Pro 使用标准 Anthropic/OAI 协议，不需要 thinking 过滤
            const hermesPayload = [
                ...systemMessages.map((c) => ({ role: 'system', content: c })),
                ...chatMessages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
            ];
            const content = await callHermes(config.hermesPort, hermesPayload);
            await withSessionLock(sessionId, async () => {
                sessionManager.addMessage(sessionId, 'assistant', content, config.id);
                if (compressedCount > 0) {
                    sessionManager.updateSession(sessionId, {
                        title: sessionManager.getSession(sessionId)?.title || '',
                    });
                }
                // Set title from first user message
                const totalUserMessages = sessionManager
                    .getMessages(sessionId)
                    .filter((m) => m.role === 'user').length;
                if (totalUserMessages === 1 && messagesArr.length > 0) {
                    const firstUser = messagesArr.find((m) => m.role === 'user');
                    if (firstUser?.content) {
                        const titleText = typeof firstUser.content === 'string'
                            ? firstUser.content
                            : JSON.stringify(firstUser.content);
                        sessionManager.updateSession(sessionId, {
                            title: titleText.substring(0, 100),
                        });
                    }
                }
            });
            res.json({
                id: `chatcmpl-${Date.now()}`,
                sessionId,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: config.id,
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant', content },
                        finish_reason: 'stop',
                    },
                ],
                usage: {
                    prompt_tokens: hermesPayload.reduce((s, m) => s + compressor.estimateTokens(m.content), 0),
                    completion_tokens: compressor.estimateTokens(content),
                },
            });
        }
        catch (error) {
            console.error(`[${config.id}] Chat error:`, error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    // ── Inter-Agent Message ──
    const handleInterAgentMessage = async (envelope, sendResponse) => {
        switch (envelope.type) {
            case MessageType.TASK: {
                const prompt = envelope.payload?.prompt || '';
                const basePrompt = config.buildSystemPrompt();
                const peerInfo = buildPeerAwarenessPrompt(config);
                const systemPrompt = peerInfo ? `${basePrompt}\n\n${peerInfo}` : basePrompt;
                const hermesPayload = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `以下任务来自 Agent "${envelope.from}" 的委托：\n\n${prompt}` },
                ];
                const output = await callHermes(config.hermesPort, hermesPayload);
                sendResponse({
                    id: uuidv4(),
                    from: config.id,
                    to: envelope.from,
                    sessionId: envelope.sessionId,
                    type: MessageType.RESULT,
                    payload: { output },
                    timestamp: Date.now(),
                    correlationId: envelope.correlationId,
                });
                break;
            }
            case MessageType.STATUS: {
                sendResponse({
                    id: uuidv4(),
                    from: config.id,
                    to: envelope.from,
                    sessionId: envelope.sessionId,
                    type: MessageType.RESPONSE,
                    payload: { status: 'ok', agent: config.id },
                    timestamp: Date.now(),
                    correlationId: envelope.correlationId,
                });
                break;
            }
            default: {
                sendResponse({
                    id: uuidv4(),
                    from: config.id,
                    to: envelope.from,
                    sessionId: envelope.sessionId,
                    type: MessageType.RESPONSE,
                    payload: { received: true },
                    timestamp: Date.now(),
                    correlationId: envelope.correlationId,
                });
            }
        }
    };
    app.post('/agent/message', async (req, res) => {
        try {
            const envelope = req.body;
            // 跨 Agent 转发（to 不是自己）
            if (envelope.to && envelope.to !== config.id && registry.getAgent(envelope.to)) {
                try {
                    const result = await agentBus.sendAndWait(envelope.to, {
                        from: config.id,
                        to: envelope.to,
                        sessionId: envelope.sessionId,
                        type: envelope.type,
                        payload: envelope.payload,
                    });
                    res.json(result);
                    return;
                }
                catch (err) {
                    res.status(502).json({ error: `Agent "${envelope.to}" unreachable: ${err instanceof Error ? err.message : 'unknown'}` });
                    return;
                }
            }
            // 本地处理（发给自己的消息）
            await handleInterAgentMessage(envelope, (response) => {
                res.json(response);
            });
        }
        catch (error) {
            res.status(500).json({ error: 'Message processing failed' });
        }
    });
    // ── Peer Registration ──
    app.post('/agent/register', (req, res) => {
        const peer = req.body;
        if (peer?.id && peer?.messageEndpoint) {
            registry.addPeer(peer);
            res.json(selfReg);
        }
        else {
            res.status(400).json({ error: 'Invalid registration' });
        }
    });
    // ── List Peers ──
    app.get('/agent/peers', (_req, res) => {
        res.json({ peers: registry.getAllAgents() });
    });
    // ── Session Info ──
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
    return {
        app,
        sessionManager,
        memoryStore,
        agentBus,
        compressor,
        config,
        handleInterAgentMessage,
    };
}
const PEER_ROLES = {
    'dev-frontend': '前端开发专家 (React/Vue/TypeScript/CSS)',
    'dev-backend': '后端开发专家 (Python/Node.js/Go/API/数据库)',
    'dev-testing': '测试专家 (pytest/Jest/Playwright/E2E)',
    'dev-devops': 'DevOps 专家 (Docker/K8s/CI-CD/部署)',
    'dev-pm': '产品经理 (PRD/需求分析/用户故事)',
};
function buildPeerAwarenessPrompt(config) {
    const peers = config.peers;
    if (!peers || peers.length === 0)
        return '';
    const peerList = peers.map((p) => {
        const role = PEER_ROLES[p.id] || p.id;
        return `- **${p.id}** (${role}) — 端口 ${p.port}`;
    }).join('\n');
    return `## 团队协作 — 可用 Agent 成员

你是多 Agent 开发团队的一员。系统内还有以下 Agent 可以协作：

${peerList}

### 如何委托任务给其他 Agent

当你需要其他 Agent 的专业能力时，可以通过 HTTP API 委托任务：

\`\`\`
POST http://127.0.0.1:${config.port}/agent/message
Content-Type: application/json

{
  "from": "${config.id}",
  "to": "<目标agent-id>",
  "sessionId": "<当前会话id>",
  "type": "TASK",
  "payload": { "prompt": "<你要委托的任务描述>" }
}
\`\`\`

目标 Agent 的 id 可选值：${peers.map((p) => p.id).join('、')}

收到委托结果后，将其整合到你的回答中。如果用户的问题涉及其他 Agent 的专业领域，**主动建议或委托**给对应的 Agent。`;
}
async function callHermes(hermesPort, messages, retries = 5) {
    // 优先使用直连 API（如果配置了 MODEL_BASE_URL 和 API_KEY）
    const directUrl = process.env.MODEL_BASE_URL;
    const directKey = process.env.API_KEY;
    const directModel = process.env.MODEL_NAME || 'deepseek-v4-pro';
    const useDirect = !!(directUrl && directKey);
    let lastError = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const apiUrl = useDirect
                ? `${directUrl}/chat/completions`
                : `http://127.0.0.1:${hermesPort}/v1/chat/completions`;
            const headers = { 'Content-Type': 'application/json' };
            if (useDirect) {
                headers['Authorization'] = `Bearer ${directKey}`;
            }
            const body = {
                model: useDirect ? directModel : 'hermes-agent',
                messages,
                max_tokens: 8192,
            };
            if (!useDirect) {
                body.thinking = { type: 'disabled' };
            }
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(180000),
            });
            if (response.ok) {
                const data = (await response.json());
                const content = data.choices?.[0]?.message?.content;
                if (content)
                    return content;
                lastError = '模型返回空内容';
            }
            else if (response.status >= 500) {
                lastError = `服务异常 (HTTP ${response.status})`;
            }
            else {
                return `请求参数错误 (HTTP ${response.status})`;
            }
        }
        catch (error) {
            lastError = `连接失败: ${error instanceof Error ? error.message : '未知错误'}`;
        }
        if (attempt < retries) {
            // 指数退避: 2s, 4s, 8s, 16s, 32s
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt + 1)));
        }
    }
    return `模型调用失败 (已重试 ${retries} 次): ${lastError}`;
}
//# sourceMappingURL=agent-factory.js.map