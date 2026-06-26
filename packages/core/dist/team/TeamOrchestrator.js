/**
 * TeamOrchestrator — 基于 Hermes Agent 集群的多 Agent 协作编排器
 *
 * 重构说明：
 * - 移除对 @open-multi-agent/core 的依赖
 * - 使用 HermesAgentClient 通过 HTTP 调用 Hermes 实例（端口 8201-8205）
 * - Hermes 已自带工具、记忆、RAG，平台层只负责编排和通信
 */
import { HermesAgentClient } from '../hermes/HermesAgentClient.js';
import { IntentRouter } from '../intent/IntentRouter.js';
import { eventBus } from '../event/EventBus.js';
import { getGlobalMessageBus } from '../event/MessageBus.js';
import { createGuardedAgentResult, isModelSpendGuardEnabled } from '../runtime/model-spend-guard.js';
// ============================================================================
// Orchestrator
// ============================================================================
export class TeamOrchestrator {
    hermesClient;
    agentConfigs;
    intentRouter;
    lastRoutingDecision = null;
    workflowStateManager;
    tokenBudgetManager;
    extraCustomTools = [];
    maxConcurrency;
    maxDelegationDepth;
    onProgress;
    constructor(config) {
        this.agentConfigs = new Map();
        for (const a of config.agents) {
            this.agentConfigs.set(a.id, a);
        }
        this.workflowStateManager = config.workflowStateManager;
        this.tokenBudgetManager = config.tokenBudgetManager;
        this.maxConcurrency = config.maxConcurrency ?? 5;
        this.maxDelegationDepth = config.maxDelegationDepth ?? 3;
        this.onProgress = config.onProgress;
        this.extraCustomTools = config.extraCustomTools || [];
        // 初始化 Hermes Agent Client
        this.hermesClient = new HermesAgentClient();
        // 初始化 IntentRouter（用于路由决策）
        this.intentRouter = new IntentRouter({
            model: config.defaultModel,
            baseURL: config.baseUrl,
            apiKey: config.apiKey,
        }, config.agents);
        // 初始化 MessageBus
        const messageBus = getGlobalMessageBus({ verbose: true });
        // 注册所有 Agent 到 MessageBus
        for (const agent of config.agents) {
            messageBus.registerAgent(agent.id, async (msg) => {
                console.log(`[MessageBus] ${msg.from} → ${msg.to}: ${msg.content.substring(0, 50)}...`);
            });
        }
        console.log(`[TeamOrchestrator] 已注册 ${config.agents.length} 个 Agent 到 MessageBus`);
        console.log(`[TeamOrchestrator] 使用 Hermes Agent Client (端口 8201-8205)`);
        console.log(`[TeamOrchestrator] customTools 数量: ${this.extraCustomTools.length}`);
        console.log(`[TeamOrchestrator] customTools 名称: ${this.extraCustomTools.map((t) => t.name || t.toolName || 'unknown').join(', ')}`);
    }
    // ============================================================================
    // 单 Agent 执行
    // ============================================================================
    /**
     * runAgent — 单 Agent 执行
     * 直接调用 Hermes Agent 实例，让 Hermes 处理工具、记忆、RAG
     */
    async runAgent(agentId, goal, sessionId, options) {
        const config = this.agentConfigs.get(agentId);
        if (!config)
            throw new Error(`Agent "${agentId}" not found`);
        console.log(`[TeamOrchestrator] runAgent: ${agentId} → "${goal.substring(0, 60)}..."`);
        if (isModelSpendGuardEnabled()) {
            console.warn(`[TeamOrchestrator] MODEL_SPEND_GUARD blocked live model call for ${agentId}`);
            return createGuardedAgentResult(agentId);
        }
        const budgetSessionId = sessionId || agentId;
        this.checkBudget(budgetSessionId, 5000);
        const hermesResult = await this.hermesClient.callAgent(agentId, goal, {
            systemPrompt: config.systemPrompt,
            maxTokens: options?.maxTokens || 4000,
            sessionId,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
        });
        // 跟踪 Token 使用
        this.trackTokenUsage(budgetSessionId, hermesResult.tokenUsage);
        // 转换为平台标准格式
        const agentResult = {
            success: hermesResult.success,
            output: hermesResult.output,
            messages: hermesResult.messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
            tokenUsage: hermesResult.tokenUsage,
            toolCalls: hermesResult.toolCalls.map((tc) => ({
                toolName: tc.toolName,
                input: {},
                output: tc.result || '',
            })),
        };
        return agentResult;
    }
    // ============================================================================
    // Team 模式（多 Agent 并行/串行）
    // ============================================================================
    /**
     * runTeam — 多 Agent 协作执行
     * 由 IntentRouter 分析目标，决定哪些 Agent 参与，然后并行/串行调用 Hermes
     */
    async runTeam(goal, options) {
        console.log(`[TeamOrchestrator] runTeam: "${goal.substring(0, 60)}..." | sessionId: ${options?.sessionId || 'none'}`);
        const workflowId = `team-${Date.now()}`;
        const sessionId = options?.sessionId;
        const stateManager = this.workflowStateManager;
        let wfState = stateManager ? stateManager.createState(goal, 1) : null;
        eventBus.emit({
            type: 'workflow.started',
            source: 'workflow',
            timestamp: Date.now(),
            payload: { workflowId: wfState?.id || workflowId, taskId: goal.substring(0, 50) },
        });
        try {
            // 1. 路由决策：决定哪些 Agent 参与
            const decision = await this.intentRouter.route(goal);
            this.lastRoutingDecision = decision;
            const involvedAgents = decision.involvedAgents || [decision.primaryAgent || 'dev-backend'];
            console.log(`[TeamOrchestrator] runTeam 路由决策: ${decision.strategy} | 参与 Agent: ${involvedAgents.join(', ')}`);
            // 2. 并行调用所有参与 Agent（Hermes 的 aiohttp 支持并发）
            const agentResults = new Map();
            const totalTokenUsage = { input_tokens: 0, output_tokens: 0 };
            const promises = involvedAgents.map(async (agentId) => {
                if (!agentId)
                    return;
                console.log(`[TeamOrchestrator] runTeam 调用 ${agentId}...`);
                const result = await this.runAgent(agentId, goal, sessionId);
                agentResults.set(agentId, result);
                totalTokenUsage.input_tokens += result.tokenUsage.input_tokens;
                totalTokenUsage.output_tokens += result.tokenUsage.output_tokens;
            });
            await Promise.all(promises);
            // 3. 汇总结果
            const outputs = Array.from(agentResults.entries())
                .map(([id, result]) => `## ${id}\n${result.output}`)
                .join('\n\n---\n\n');
            const teamResult = {
                success: Array.from(agentResults.values()).every((r) => r.success),
                goal,
                agentResults,
                totalTokenUsage,
            };
            if (stateManager && wfState) {
                stateManager.complete(wfState.id, outputs);
            }
            eventBus.emit({
                type: 'workflow.completed',
                source: 'workflow',
                timestamp: Date.now(),
                payload: {
                    workflowId: wfState?.id || workflowId,
                    taskId: goal.substring(0, 50),
                    output: outputs.substring(0, 200),
                    tokenUsage: totalTokenUsage,
                },
            });
            return teamResult;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            if (stateManager && wfState) {
                stateManager.fail(wfState.id, errorMsg);
            }
            eventBus.emit({
                type: 'workflow.failed',
                source: 'workflow',
                timestamp: Date.now(),
                payload: {
                    workflowId: wfState?.id || workflowId,
                    taskId: goal.substring(0, 50),
                    error: errorMsg,
                },
            });
            throw error;
        }
    }
    // ============================================================================
    // 任务列表模式
    // ============================================================================
    /**
     * runTasks — 显式任务列表（串行执行）
     */
    async runTasks(tasks) {
        console.log(`[TeamOrchestrator] runTasks: ${tasks.length} 个任务`);
        const agentResults = new Map();
        const totalTokenUsage = { input_tokens: 0, output_tokens: 0 };
        const outputs = [];
        for (const task of tasks) {
            const agentId = task.assignee || 'dev-backend';
            const prompt = `任务: ${task.title}\n\n描述: ${task.description}`;
            const result = await this.runAgent(agentId, prompt);
            agentResults.set(`${agentId}-${task.title}`, result);
            totalTokenUsage.input_tokens += result.tokenUsage.input_tokens;
            totalTokenUsage.output_tokens += result.tokenUsage.output_tokens;
            outputs.push(result.output);
            if (this.onProgress) {
                this.onProgress({ type: 'task_complete', task: task.title });
            }
        }
        return {
            success: Array.from(agentResults.values()).every((r) => r.success),
            goal: tasks.map((t) => t.title).join(', '),
            agentResults,
            totalTokenUsage,
        };
    }
    // ============================================================================
    // 圆桌会议模式
    // ============================================================================
    /**
     * runMeeting — 圆桌会议模式
     * 所有 Agent 顺序执行，共享上下文，每人从自己的专业角度发表意见
     */
    async runMeeting(goal, sessionId) {
        console.log(`[TeamOrchestrator] runMeeting: "${goal.substring(0, 60)}..." | sessionId: ${sessionId || 'none'}`);
        const agentCount = this.agentConfigs.size;
        this.checkBudget(sessionId || 'runMeeting', agentCount * 3000);
        const agentIds = Array.from(this.agentConfigs.keys());
        const agentResults = new Map();
        const discussion = [];
        const totalTokenUsage = { input_tokens: 0, output_tokens: 0 };
        for (const agentId of agentIds) {
            const config = this.agentConfigs.get(agentId);
            if (!config)
                continue;
            const contextSection = discussion.length > 0
                ? `\n\n## 会议讨论记录（之前的发言）\n${discussion.join('\n\n')}`
                : '';
            const prompt = `## 会议议题\n${goal}${contextSection}\n\n请从你的专业角度（${config.role}）发表意见。简洁有力，突出重点。`;
            const result = await this.runAgent(agentId, prompt, sessionId);
            agentResults.set(agentId, result);
            discussion.push(`### ${config.name}（${config.role}）\n${result.output}`);
            totalTokenUsage.input_tokens += result.tokenUsage.input_tokens;
            totalTokenUsage.output_tokens += result.tokenUsage.output_tokens;
            console.log(`[TeamOrchestrator] meeting: ${config.id} 已发言`);
        }
        const meetingResult = {
            success: true,
            goal,
            agentResults,
            totalTokenUsage: totalTokenUsage,
        };
        eventBus.emit({
            type: 'meeting.completed',
            source: 'meeting',
            timestamp: Date.now(),
            payload: {
                meetingId: `meeting-${Date.now()}`,
                topic: goal.substring(0, 100),
                participants: agentIds,
                summary: discussion.join('\n\n').substring(0, 500),
                actionItems: [],
            },
        });
        return meetingResult;
    }
    /**
     * runMeetingWithProgress — 带实时进度的圆桌会议（并发控制 + 重试）
     */
    async runMeetingWithProgress(goal, onProgress) {
        const MAX_CONCURRENT = 2;
        const MAX_RETRIES = 3;
        const BASE_DELAY = 2000;
        const meetingId = `meeting-${Date.now()}`;
        eventBus.emit({
            type: 'meeting.started',
            source: 'meeting',
            timestamp: Date.now(),
            payload: {
                meetingId,
                topic: goal.substring(0, 100),
                participants: Array.from(this.agentConfigs.keys()),
            },
        });
        console.log(`[TeamOrchestrator] runMeetingWithProgress (concurrency=${MAX_CONCURRENT}): "${goal.substring(0, 60)}..." (meetingId: ${meetingId})`);
        const agentIds = Array.from(this.agentConfigs.keys());
        const agentResults = new Map();
        const totalTokenUsage = { input_tokens: 0, output_tokens: 0 };
        const configs = agentIds
            .map((id, i) => ({ id, config: this.agentConfigs.get(id), index: i }))
            .filter((a) => !!a.config);
        for (const { config, index } of configs) {
            onProgress({
                type: 'agent_start',
                agent: config.id,
                name: config.name,
                role: config.role,
                index,
                total: configs.length,
            });
            onProgress({
                type: 'thinking',
                agent: config.id,
                name: config.name,
                message: `${config.name} 正在排队...`,
            });
        }
        const prompt = `## 会议议题\n${goal}\n\n请从你的专业角度发表意见。简洁有力，突出重点。`;
        const runWithRetry = async (config, attempt = 1) => {
            try {
                return await this.runAgent(config.id, prompt);
            }
            catch (err) {
                const is429 = err instanceof Error && (err.message.includes('429') || err.message.includes('Too many requests'));
                if (is429 && attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, attempt - 1);
                    console.log(`[TeamOrchestrator] ${config.id} 触发限流，${delay}ms 后重试 (${attempt}/${MAX_RETRIES})`);
                    await new Promise((r) => setTimeout(r, delay));
                    return runWithRetry(config, attempt + 1);
                }
                throw err;
            }
        };
        // 并发控制
        let running = 0;
        const queue = [];
        const acquire = () => new Promise((resolve) => {
            if (running < MAX_CONCURRENT) {
                running++;
                resolve();
            }
            else {
                queue.push(resolve);
            }
        });
        const release = () => {
            if (queue.length > 0) {
                const next = queue.shift();
                next();
            }
            else {
                running--;
            }
        };
        const results = await Promise.allSettled(configs.map(async ({ config }) => {
            await acquire();
            try {
                return await runWithRetry(config);
            }
            finally {
                release();
            }
        }));
        for (let i = 0; i < results.length; i++) {
            const { config, index } = configs[i];
            const outcome = results[i];
            if (outcome.status === 'fulfilled') {
                const result = outcome.value;
                agentResults.set(config.id, result);
                totalTokenUsage.input_tokens += result.tokenUsage.input_tokens;
                totalTokenUsage.output_tokens += result.tokenUsage.output_tokens;
                onProgress({
                    type: 'output',
                    agent: config.id,
                    name: config.name,
                    role: config.role,
                    output: result.output,
                    toolCalls: result.toolCalls.length,
                    index,
                    total: configs.length,
                });
            }
            else {
                const errorMsg = outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error';
                console.error(`[TeamOrchestrator] meeting: ${config.id} 失败:`, errorMsg);
                onProgress({
                    type: 'error',
                    agent: config.id,
                    name: config.name,
                    error: errorMsg,
                });
                agentResults.set(config.id, {
                    success: false,
                    output: `❌ 执行失败: ${errorMsg}`,
                    messages: [],
                    tokenUsage: { input_tokens: 0, output_tokens: 0 },
                    toolCalls: [],
                });
            }
        }
        onProgress({ type: 'done' });
        eventBus.emit({
            type: 'meeting.completed',
            source: 'meeting',
            timestamp: Date.now(),
            payload: {
                meetingId: `meeting-${Date.now()}`,
                topic: goal.substring(0, 100),
                participants: agentIds,
                summary: '会议已完成（详见各 Agent 输出）',
                actionItems: [],
            },
        });
        return {
            success: true,
            goal,
            agentResults,
            totalTokenUsage: totalTokenUsage,
        };
    }
    // ============================================================================
    // 工作流管理
    // ============================================================================
    /**
     * resumeWorkflow — 从断点续传工作流
     */
    async resumeWorkflow(workflowId) {
        const stateManager = this.workflowStateManager;
        if (!stateManager) {
            throw new Error('WorkflowStateManager 未配置，无法断点续传');
        }
        const state = stateManager.load(workflowId);
        if (!state) {
            throw new Error(`工作流 ${workflowId} 不存在`);
        }
        if (state.status === 'completed') {
            return {
                success: true,
                goal: state.goal,
                agentResults: new Map(),
                totalTokenUsage: state.tokenUsage,
            };
        }
        console.log(`[TeamOrchestrator] resumeWorkflow: ${workflowId} (step ${state.currentStep}/${state.totalSteps})`);
        try {
            const result = await this.runTeam(state.goal);
            stateManager.complete(workflowId, result.goal);
            return result;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            stateManager.fail(workflowId, errorMsg);
            throw error;
        }
    }
    listWorkflows(limit, offset) {
        return this.workflowStateManager?.listWorkflows(limit, offset) || [];
    }
    getRunningWorkflows() {
        return this.workflowStateManager?.getRunningWorkflows() || [];
    }
    // ============================================================================
    // 预算管理
    // ============================================================================
    checkBudget(sessionId, estimatedTokens = 5000) {
        const manager = this.tokenBudgetManager;
        if (!manager)
            return;
        const result = manager.checkBudget(sessionId, estimatedTokens);
        if (!result.allowed) {
            throw new Error(`Token预算已耗尽: ${result.message}`);
        }
        if (result.status === 'warning') {
            console.warn(`[TokenBudget] ${result.message}`);
            eventBus.emit({
                type: 'system.token_alert',
                source: 'system',
                timestamp: Date.now(),
                payload: { sessionId, message: result.message, severity: 'warning' },
            });
        }
    }
    trackTokenUsage(sessionId, tokenUsage) {
        const manager = this.tokenBudgetManager;
        if (!manager)
            return;
        manager.trackUsage(sessionId, tokenUsage.input_tokens + tokenUsage.output_tokens);
    }
    // ============================================================================
    // 通信（基于 MessageBus）
    // ============================================================================
    /**
     * 获取 Agent 间消息历史
     */
    getMessages(agentName) {
        const messageBus = getGlobalMessageBus();
        if (agentName) {
            return messageBus.getHistory(agentName);
        }
        // 获取所有 Agent 的消息历史
        const allMessages = [];
        for (const agentId of this.agentConfigs.keys()) {
            allMessages.push(...messageBus.getHistory(agentId));
        }
        return allMessages;
    }
    /**
     * 广播消息给所有 Agent（同步 + 异步）
     */
    broadcast(from, content) {
        const messageBus = getGlobalMessageBus();
        messageBus.broadcast({
            from,
            type: 'chat',
            content,
        }).catch((err) => {
            console.warn('[TeamOrchestrator] MessageBus 广播失败:', err);
        });
    }
    /**
     * 异步广播 — 仅使用 MessageBus
     */
    async asyncBroadcast(from, content) {
        const messageBus = getGlobalMessageBus();
        await messageBus.broadcast({
            from,
            type: 'chat',
            content,
        });
    }
    // ============================================================================
    // 状态查询
    // ============================================================================
    getStatus() {
        return {
            teamAgents: Array.from(this.agentConfigs.values()).map((a) => ({
                name: a.id,
                model: a.model || 'default',
            })),
            sharedMemory: true, // MessageBus 提供共享通信能力
        };
    }
    /**
     * 关闭编排器
     */
    async shutdown() {
        console.log('[TeamOrchestrator] 已关闭');
    }
    // ============================================================================
    // 智能路由入口
    // ============================================================================
    async handleRequest(userQuery, sessionId) {
        this.checkBudget(sessionId || 'handleRequest', 10000);
        const decision = await this.intentRouter.route(userQuery);
        this.lastRoutingDecision = decision;
        console.log(`[IntentRouter] 决策: ${decision.strategy} | 复杂度: ${decision.complexity} | 理由: ${decision.reasoning.substring(0, 80)}`);
        switch (decision.strategy) {
            case 'single': {
                const agentId = decision.primaryAgent || 'dev-backend';
                const agentResult = await this.runAgent(agentId, userQuery, sessionId);
                return {
                    success: agentResult.success,
                    goal: userQuery,
                    agentResults: new Map([[agentId, agentResult]]),
                    totalTokenUsage: agentResult.tokenUsage,
                };
            }
            case 'team': {
                return this.runTeam(userQuery, { sessionId });
            }
            case 'meeting': {
                return this.runMeeting(userQuery, sessionId);
            }
            default:
                throw new Error(`Unknown routing strategy: ${decision.strategy}`);
        }
    }
    getLastRoutingDecision() {
        return this.lastRoutingDecision;
    }
}
// ============================================================================
// 便捷工厂
// ============================================================================
export function createTeamOrchestrator(agents, model, options) {
    return new TeamOrchestrator({
        agents,
        defaultModel: model || process.env.MODEL_NAME || 'mimo-v2.5-pro',
        apiKey: process.env.API_KEY || '',
        baseUrl: process.env.MODEL_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
        onProgress: options?.onProgress,
    });
}
export function createDevTeamOrchestrator(options) {
    const model = process.env.MODEL_NAME || 'mimo-v2.5-pro';
    const apiKey = process.env.API_KEY || '';
    const baseUrl = process.env.MODEL_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';
    const commGuide = '\n\n团队通信：你可以使用 send_message 工具与其他 Agent 对话。\n- send_message({ to: "dev-backend", content: "..." }) — 发送给指定 Agent\n- send_message({ to: "*", content: "..." }) — 广播给所有 Agent\n可用的团队成员: dev-frontend, dev-backend, dev-testing, dev-devops, dev-pm, project-admin\n收到其他 Agent 的消息时，直接用 send_message 回复，不需要搜索文件系统。';
    const docKanbanTools = options?.extraCustomTools || [];
    const agents = [
        {
            id: 'dev-frontend',
            name: 'Frontend Agent',
            role: '前端开发专家 — React/Vue/TypeScript/CSS/Tailwind',
            systemPrompt: '你是前端开发专家，专注于 React、Vue、TypeScript、CSS、Tailwind。收到任务后给出具体可运行的代码方案。' + commGuide,
            model, apiKey, baseUrl,
            expertise: ['React/Vue/Angular 组件开发', 'TypeScript 类型设计', 'CSS/Tailwind 样式系统', '前端状态管理', '响应式设计', '前端性能优化'],
            tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep', 'glob'],
            typicalTasks: ['创建登录表单组件', '实现响应式导航栏', '配置 Tailwind 主题', '编写自定义 Hook', '优化首屏加载性能'],
        },
        {
            id: 'dev-backend',
            name: 'Backend Agent',
            role: '后端开发专家 — Python/Node.js/Go/API/数据库',
            systemPrompt: '你是后端开发专家，专注于 Python、Node.js、Go、API 设计、数据库。收到任务后给出具体可运行的代码方案。' + commGuide,
            model, apiKey, baseUrl,
            expertise: ['Python/Node.js/Go 服务端开发', 'API 设计与 RESTful/GraphQL', '数据库设计与优化', '微服务架构', 'Redis/消息队列', '性能调优'],
            tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep', 'glob'],
            typicalTasks: ['设计用户认证 API', '编写数据库迁移脚本', '实现缓存策略', '配置 CI/CD 流水线', '性能瓶颈分析'],
        },
        {
            id: 'dev-testing',
            name: 'Testing Agent',
            role: '测试专家 — pytest/Jest/Playwright/覆盖率',
            systemPrompt: '你是测试专家，专注于 pytest、Jest、Playwright、覆盖率。收到任务后给出具体的测试方案和用例。' + commGuide,
            model, apiKey, baseUrl,
            expertise: ['单元测试设计', '集成测试/E2E 测试', '测试覆盖率分析', 'Mock/Stub 策略', '自动化测试框架', '性能测试'],
            tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep', 'glob'],
            typicalTasks: ['编写用户登录的单元测试', '设计 E2E 测试用例', '分析测试覆盖率报告', '配置 Playwright 自动化', '性能基准测试'],
        },
        {
            id: 'dev-devops',
            name: 'DevOps Agent',
            role: '运维专家 — Docker/K8s/CI-CD/部署',
            systemPrompt: '你是 DevOps 专家，专注于 Docker、K8s、CI/CD、部署。收到任务后给出具体的部署方案。' + commGuide,
            model, apiKey, baseUrl,
            expertise: ['Docker 容器化', 'Kubernetes 编排', 'CI/CD 流水线', '云平台部署', '监控与日志', '基础设施即代码'],
            tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep', 'glob'],
            typicalTasks: ['编写 Dockerfile', '配置 K8s Deployment', '搭建 GitHub Actions 流水线', '配置 Prometheus 监控', 'Terraform 基础设施管理'],
        },
        {
            id: 'dev-pm',
            name: 'PM Agent',
            role: '产品经理 — PRD/需求分析/用户故事/产品策略',
            systemPrompt: '你是产品经理，专注于 PRD、需求分析、用户故事、产品策略。收到任务后给出结构化的产品文档。\n\n**你可以使用以下工具**：\n- create_document({ path: "prd/xxx.md", content: "...", title: "..." }) — 将 PRD 写入文件系统（路径用 docs/ 开头）\n- append_document({ path: "prd/xxx.md", content: "..." }) — 追加内容到文档\n- create_task({ title: "...", description: "...", assignee: "dev-frontend", priority: "high" }) — 创建看板任务\n- list_tasks({ status: "todo" }) — 查询看板任务\n\n会议结束后，你应该使用 create_document 沉淀最终 PRD，然后用 create_task 将任务拆分到看板。' + commGuide,
            model, apiKey, baseUrl,
            expertise: ['需求分析', '用户故事编写', 'PRD 文档', '竞品分析', '产品路线图', '数据驱动决策'],
            tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep', 'glob', 'create_document', 'append_document', 'create_task', 'list_tasks'],
            typicalTasks: ['编写用户登录功能 PRD', '设计用户旅程地图', '竞品功能对比分析', '制定迭代计划', '用户反馈分析'],
        },
        {
            id: 'project-admin',
            name: 'Project Admin',
            role: '项目管理员 — 统筹进度、任务分配、里程碑跟踪、Agent 协作协调',
            systemPrompt: '你是项目管理员，专注于看板管理、里程碑规划、进度监控、风险识别、跨 Agent 任务协调。收到任务后给出项目管理方案和进度跟踪建议。\n\n**你可以使用以下工具**：\n- create_task({ title: "...", description: "...", assignee: "dev-frontend", priority: "high", task_type: "feature" }) — 创建看板任务\n- update_task_status({ task_id: "...", status: "in_progress" }) — 更新任务状态\n- assign_task({ task_id: "...", assignee: "dev-backend" }) — 分配任务给 Agent\n- list_tasks({ status: "todo" }) — 查询待办任务\n\n你是 PM 的搭档，负责将产品文档拆分为可执行的任务并分配到看板。当 PM 产出 PRD 后，你应该使用 create_task 将每个功能点拆分为独立任务。' + commGuide,
            model, apiKey, baseUrl,
            expertise: ['项目进度跟踪', '任务分配与优先级', '里程碑管理', '风险识别', '跨团队协调', '敏捷流程'],
            tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep', 'glob', 'create_task', 'update_task_status', 'assign_task', 'list_tasks'],
            typicalTasks: ['创建项目里程碑计划', '分配任务给各 Agent', '跟踪项目进度', '识别项目风险', '生成项目状态报告'],
        },
    ];
    return new TeamOrchestrator({
        agents,
        defaultModel: model,
        apiKey,
        baseUrl,
        onProgress: options?.onProgress,
        workflowStateManager: options?.workflowStateManager,
        tokenBudgetManager: options?.tokenBudgetManager,
        extraCustomTools: docKanbanTools,
    });
}
//# sourceMappingURL=TeamOrchestrator.js.map