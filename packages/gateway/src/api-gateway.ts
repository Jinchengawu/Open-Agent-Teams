/**
 * API Gateway (Open-Agent-Teams) for DEV-Agent-Teams
 *
 * 核心职责：Open-Agent-Teams 作为中央编排层，负责：
 * 1. Agent 注册与发现
 * 2. 意图分析与智能路由
 * 3. 多 Agent 协同编排
 * 4. 统一鉴权、限流、熔断、审计
 *
 * 此 Gateway 替代之前 Dashboard → Agent 直接调用的自实现路由，
 * 改为 Dashboard → Open-Agent-Teams Gateway → Agent 的标准三层架构。
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import {
  readFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ============================================================================
// Types — 与 Open-Agent-Teams 原生 Agent 概念对齐
// ============================================================================

interface OATGatewayConfig {
  gateway: {
    host: string;
    port: number;
    name: string;
  };
  oat: {
    enabled: boolean;
    version: string;
  };
  llm: LLMConfig;
  instances: OATAgentInstance[];
  routing: {
    rules: RoutingRule[];
    default: string;
  };
  auth: {
    enabled: boolean;
    apiKey: string;
  };
  rateLimit: {
    enabled: boolean;
    requestsPerMinute: number;
    burstSize: number;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    coolDownSeconds: number;
  };
  logging: {
    level: string;
    auditFile: string;
  };
}

interface OATAgentInstance {
  id: string;
  label: string;
  port: number;
  hermesPort: number;
  tags: string[];
  skills: string[];
  timeoutMs: number;
  /** 专长领域（供 IntentRouter 路由决策） */
  expertise?: string[];
  /** 典型任务（供 IntentRouter 路由决策） */
  typicalTasks?: string[];
  /** 可用工具（供 IntentRouter 路由决策） */
  tools?: string[];
}

interface LLMConfig {
  model: string;
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
}

interface RoutingRule {
  tags: string[];
  instance: string;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

interface AuditLogEntry {
  timestamp: string;
  requestId: string;
  path: string;
  instance: string | null;
  status: number;
  latencyMs: number;
  intentAnalysisMs: number;
  messagePreview: string;
  error: string | null;
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfig(): OATGatewayConfig {
  const configPaths = [
    join(process.cwd(), 'config/oat/instances.yaml'),
    join(process.env.HOME || '~', '.dev-agent/oat/instances.yaml'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        const raw = parseYaml(content) as Record<string, unknown>;
        return normalizeConfig(raw);
      } catch (error) {
        console.error(`[api-gateway] 配置加载失败 ${configPath}:`, error);
      }
    }
  }

  console.warn('[api-gateway] 未找到配置文件，使用默认配置');
  return getDefaultConfig();
}

function normalizeConfig(raw: Record<string, unknown>): OATGatewayConfig {
  return {
    gateway: {
      host: '127.0.0.1',
      port: (raw.oat as Record<string, unknown>)?.port as number || 8400,
      name: 'api-gateway',
    },
    oat: {
      enabled: (raw.oat as Record<string, unknown>)?.enabled as boolean ?? true,
      version: (raw.oat as Record<string, unknown>)?.version as string || '2026.3.7',
    },
    llm: {
      model: (raw.llm as Record<string, unknown>)?.model as string || process.env.MODEL_NAME || 'deepseek-chat',
      baseURL: (raw.llm as Record<string, unknown>)?.base_url as string || process.env.MODEL_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: (raw.llm as Record<string, unknown>)?.api_key as string || process.env.API_KEY || '',
      timeoutMs: (raw.llm as Record<string, unknown>)?.timeout_ms as number || 10000,
    },
    instances: ((raw.instances || []) as Record<string, unknown>[]).map((i) => ({
      id: i.id as string,
      label: i.label as string,
      port: i.port as number,
      hermesPort: (i.hermes_port || i.hermesPort || i.port) as number,
      tags: (i.tags || []) as string[],
      skills: (i.skills || []) as string[],
      timeoutMs: (i.timeout_ms || i.timeoutMs || 120000) as number,
      expertise: (i.expertise || []) as string[],
      typicalTasks: (i.typical_tasks || i.typicalTasks || []) as string[],
      tools: (i.tools || []) as string[],
    })),
    routing: {
      rules: ((raw.routing as Record<string, unknown>)?.rules || []) as RoutingRule[],
      default: ((raw.routing as Record<string, unknown>)?.default || 'dev-backend') as string,
    },
    auth: {
      enabled: (raw.auth as Record<string, unknown>)?.enabled as boolean ?? false,
      apiKey: process.env.OPENCLAW_API_KEY || '',
    },
    rateLimit: {
      enabled: (raw.rate_limit as Record<string, unknown>)?.enabled as boolean ?? true,
      requestsPerMinute: (raw.rate_limit as Record<string, unknown>)?.requests_per_minute as number || 60,
      burstSize: (raw.rate_limit as Record<string, unknown>)?.burst_size as number || 10,
    },
    circuitBreaker: {
      enabled: (raw.circuit_breaker as Record<string, unknown>)?.enabled as boolean ?? true,
      failureThreshold: (raw.circuit_breaker as Record<string, unknown>)?.failure_threshold as number || 3,
      coolDownSeconds: (raw.circuit_breaker as Record<string, unknown>)?.cool_down_seconds as number || 120,
    },
    logging: {
      level: (raw.logging as Record<string, unknown>)?.level as string || 'INFO',
      auditFile: (raw.logging as Record<string, unknown>)?.audit_file as string ||
        join(process.env.HOME || '~', '.dev-agent/logs/audit.log'),
    },
  };
}

function getDefaultConfig(): OATGatewayConfig {
  return {
    gateway: { host: '127.0.0.1', port: 8400, name: 'api-gateway' },
    oat: { enabled: true, version: '2026.3.7' },
    llm: {
      model: process.env.MODEL_NAME || 'deepseek-chat',
      baseURL: process.env.MODEL_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.API_KEY || '',
      timeoutMs: 10000,
    },
    instances: [
      { id: 'dev-frontend', label: '前端开发 Agent', port: 8201, hermesPort: 9201, tags: ['react','vue','component','ui','css','typescript','frontend','前端'], skills: [], timeoutMs: 120000, expertise: ['React', 'Vue', 'TypeScript', 'CSS', 'Tailwind', 'UI/UX'], typicalTasks: ['组件开发', '页面实现', '样式优化', '前端架构'], tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep'] },
      { id: 'dev-backend', label: '后端开发 Agent', port: 8202, hermesPort: 9202, tags: ['api','database','server','python','node','go','backend','后端'], skills: [], timeoutMs: 120000, expertise: ['Python', 'Node.js', 'Go', 'API设计', '数据库'], typicalTasks: ['API开发', '数据库设计', '服务架构', '性能优化'], tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep'] },
      { id: 'dev-testing', label: '测试开发 Agent', port: 8203, hermesPort: 9203, tags: ['test','unit','e2e','coverage','jest','pytest','testing','测试'], skills: [], timeoutMs: 180000, expertise: ['pytest', 'Jest', 'Playwright', '单元测试', 'E2E测试'], typicalTasks: ['测试用例编写', '覆盖率分析', '自动化测试', 'Bug复现'], tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep'] },
      { id: 'dev-devops', label: 'DevOps Agent', port: 8204, hermesPort: 9204, tags: ['docker','k8s','kubernetes','deploy','ci/cd','devops','运维'], skills: [], timeoutMs: 300000, expertise: ['Docker', 'Kubernetes', 'CI/CD', '部署', '监控'], typicalTasks: ['容器化', '部署脚本', '流水线配置', '运维监控'], tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep'] },
      { id: 'dev-pm', label: '产品经理 Agent', port: 8205, hermesPort: 9205, tags: ['prd','requirement','product','strategy','user-story','pm','产品','需求'], skills: [], timeoutMs: 120000, expertise: ['PRD', '需求分析', '用户故事', '产品策略'], typicalTasks: ['PRD编写', '需求分析', '用户调研', '功能规划'], tools: ['file_read', 'file_write', 'file_edit', 'bash', 'grep'] },
    ],
    routing: { rules: [], default: 'dev-backend' },
    auth: { enabled: false, apiKey: '' },
    rateLimit: { enabled: true, requestsPerMinute: 60, burstSize: 10 },
    circuitBreaker: { enabled: true, failureThreshold: 3, coolDownSeconds: 120 },
    logging: { level: 'INFO', auditFile: join(process.env.HOME || '~', '.dev-agent/logs/audit.log') },
  };
}

// ============================================================================
// Open-Agent-Teams Agent Registry — 原生 Agent 管理
// ============================================================================

class OATAgentRegistry {
  private instances: Map<string, OATAgentInstance> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private config: OATGatewayConfig;
  private llmConfig: LLMConfig;
  private lastRoutingDecision: { strategy: string; agentId: string; reasoning: string; complexity: string } | null = null;

  constructor(config: OATGatewayConfig) {
    this.config = config;
    this.llmConfig = config.llm;
    for (const instance of config.instances) {
      this.instances.set(instance.id, instance);
      this.circuitBreakers.set(instance.id, { failures: 0, lastFailure: 0, isOpen: false });
    }
    console.log(`[oat-registry] 注册了 ${this.instances.size} 个 Agent 实例`);
    for (const [id, inst] of this.instances) {
      console.log(`  ${id} → Agent:${inst.port} Hermes:${inst.hermesPort} tags:[${inst.tags.join(',')}]`);
    }
  }

  getLastRoutingDecision() {
    return this.lastRoutingDecision;
  }

  /**
   * LLM-based 智能意图路由 — 基于 IntentRouter 思路的内联实现
   * 优先使用 LLM 分析，失败时回退到关键词评分
   */
  async analyzeIntentWithLLM(message: string): Promise<{ instance: OATAgentInstance; strategy: string; reasoning: string; complexity: string } | null> {
    if (!this.llmConfig.apiKey) {
      const fallback = this.analyzeIntent(message);
      if (fallback) {
        this.lastRoutingDecision = { strategy: 'single', agentId: fallback.instance.id, reasoning: 'LLM 未配置，使用关键词回退', complexity: 'medium' };
        return { instance: fallback.instance, strategy: 'single', reasoning: '关键词回退', complexity: 'medium' };
      }
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.llmConfig.timeoutMs);

      const agentDescriptions = [...this.instances.values()]
        .map((inst) => `【Agent: ${inst.id}】
名称: ${inst.label}
${inst.expertise?.length ? `专长: ${inst.expertise.join('、')}` : `标签: ${inst.tags.join('、')}`}
${inst.typicalTasks?.length ? `典型任务: ${inst.typicalTasks.join('、')}` : ''}
${inst.tools?.length ? `可用工具: ${inst.tools.join('、')}` : ''}
`).join('\n---\n');

      const response = await fetch(`${this.llmConfig.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.llmConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: this.llmConfig.model,
          messages: toProviderSafeMessages([
            {
              role: 'system',
              content: `你是意图路由分析师。分析用户请求，选择最合适的 Agent。输出 JSON：
{"strategy":"single","agentId":"agent-id","reasoning":"理由","complexity":"low|medium|high"}`,
            },
            {
              role: 'user',
              content: `可用 Agent：\n${agentDescriptions}\n\n用户请求: "${message}"\n\n选择最合适的 Agent。`,
            },
          ]),
          temperature: 0.2,
          max_tokens: 300,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM API ${response.status}`);
      }

      const data = (await response.json()) as { choices: [{ message: { content: string } }] };
      const rawContent = data.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawContent) as Partial<{
        strategy: string;
        agentId: string;
        reasoning: string;
        complexity: string;
      }>;

      const agentId = parsed.agentId || parsed.primaryAgent;
      const validIds = new Set([...this.instances.keys()]);
      const targetId = agentId && validIds.has(agentId) ? agentId : this.config.routing.default;
      const targetInstance = this.instances.get(targetId) || this.getDefaultInstance();

      this.lastRoutingDecision = {
        strategy: parsed.strategy || 'single',
        agentId: targetId,
        reasoning: parsed.reasoning || 'LLM 路由',
        complexity: parsed.complexity || 'medium',
      };

      return {
        instance: targetInstance,
        strategy: parsed.strategy || 'single',
        reasoning: parsed.reasoning || 'LLM 路由',
        complexity: parsed.complexity || 'medium',
      };
    } catch (error) {
      console.warn('[IntentRouter] LLM 路由失败，回退到关键词评分:', error);
      const fallback = this.analyzeIntent(message);
      if (fallback) {
        this.lastRoutingDecision = { strategy: 'single', agentId: fallback.instance.id, reasoning: 'LLM 失败，关键词回退', complexity: 'medium' };
        return { instance: fallback.instance, strategy: 'single', reasoning: '关键词回退', complexity: 'medium' };
      }
      return null;
    }
  }

  /**
   * 关键词评分路由（快速路径 / 回退）
   */
  analyzeIntent(message: string): { instance: OATAgentInstance; score: number } | null {
    const lower = message.toLowerCase();
    const scores: { instance: OATAgentInstance; score: number }[] = [];

    for (const instance of this.instances.values()) {
      let score = 0;

      // 1. 标签匹配（权重: 10/标签）
      for (const tag of instance.tags) {
        if (lower.includes(tag.toLowerCase())) {
          score += 10;
        }
      }

      // 2. 路由规则匹配（权重: 15/规则）
      for (const rule of this.config.routing.rules) {
        if (rule.instance === instance.id) {
          for (const tag of rule.tags) {
            if (lower.includes(tag.toLowerCase())) {
              score += 15;
            }
          }
        }
      }

      // 3. Agent ID 直接匹配（权重: 20）
      if (lower.includes(instance.id.replace('dev-', ''))) {
        score += 20;
      }

      // 4. 熔断器惩罚
      const cb = this.circuitBreakers.get(instance.id);
      if (cb?.isOpen) {
        score -= 100;
      }

      scores.push({ instance, score });
    }

    scores.sort((a, b) => b.score - a.score);

    if (scores[0].score > 0) {
      return scores[0];
    }
    return null;
  }

  getDefaultInstance(): OATAgentInstance {
    const defaultId = this.config.routing.default;
    return this.instances.get(defaultId) || [...this.instances.values()][0];
  }

  // Circuit breaker
  getCircuitBreaker(id: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(id)) {
      this.circuitBreakers.set(id, { failures: 0, lastFailure: 0, isOpen: false });
    }
    return this.circuitBreakers.get(id)!;
  }

  recordSuccess(id: string): void {
    const cb = this.getCircuitBreaker(id);
    cb.failures = 0;
    cb.isOpen = false;
  }

  recordFailure(id: string): void {
    const cb = this.getCircuitBreaker(id);
    cb.failures++;
    cb.lastFailure = Date.now();
    if (cb.failures >= this.config.circuitBreaker.failureThreshold) {
      cb.isOpen = true;
      console.warn(`[circuit-breaker] ${id} 熔断器打开 (连续 ${cb.failures} 次失败)`);
    }
  }

  isCircuitOpen(id: string): boolean {
    const cb = this.getCircuitBreaker(id);
    if (!cb.isOpen) return false;
    const coolDown = this.config.circuitBreaker.coolDownSeconds * 1000;
    if (Date.now() - cb.lastFailure >= coolDown) {
      cb.isOpen = false;
      cb.failures = 0;
      console.log(`[circuit-breaker] ${id} 冷却完成，恢复服务`);
      return false;
    }
    return true;
  }

  /**
   * 健康检查 — 探测所有已注册 Agent
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [id, instance] of this.instances) {
      try {
        const res = await fetch(`http://127.0.0.1:${instance.port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        results[id] = res.ok;
      } catch {
        results[id] = false;
      }
    }
    return results;
  }
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  private states = new Map<string, number[]>();

  check(clientIp: string, rpm: number): boolean {
    if (!this.states.has(clientIp)) {
      this.states.set(clientIp, []);
    }
    const requests = this.states.get(clientIp)!;
    const now = Date.now();
    const windowMs = 60_000;
    const recent = requests.filter((t) => now - t < windowMs);
    if (recent.length >= rpm) return false;
    recent.push(now);
    this.states.set(clientIp, recent);
    return true;
  }
}

// ============================================================================
// Audit Logger
// ============================================================================

function writeAuditLog(entry: AuditLogEntry, file: string): void {
  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (error) {
    console.error('[audit] 写入失败:', error);
  }
}

// ============================================================================
// Open-Agent-Teams Gateway — 主服务
// ============================================================================

async function main(): Promise<void> {
  console.log('🧠 Open-Agent-Teams Gateway v0.1.0 — DEV-Agent-Teams');
  console.log('===============================================');

  const config = loadConfig();
  const registry = new OATAgentRegistry(config);
  const rateLimiter = new RateLimiter();

  // Agent 注册摘要
  console.log('');
  console.log(`📋 Open-Agent-Teams v${config.oat.version} | ${registry.getAllInstances().length} Agents registered`);
  console.log(`🔐 Auth: ${config.auth.enabled ? 'enabled' : 'disabled'}`);
  console.log(`⚡ Rate Limit: ${config.rateLimit.enabled ? `${config.rateLimit.requestsPerMinute}/min` : 'disabled'}`);
  console.log(`🛡️  Circuit Breaker: ${config.circuitBreaker.enabled ? `threshold=${config.circuitBreaker.failureThreshold}` : 'disabled'}`);
  console.log('');

  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    const requestId = `ocl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const clientIp = req.socket.remoteAddress || 'unknown';
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // 健康检查
    if (path === '/health') {
      const agentHealth = await registry.healthCheck();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        gateway: 'api-gateway',
        oat: config.oat,
        agents: agentHealth,
        uptime: process.uptime(),
      }));
      return;
    }

    // Agent 列表
    if (path === '/agents') {
      const agents = registry.getAllInstances().map((i) => ({
        id: i.id,
        label: i.label,
        port: i.port,
        tags: i.tags,
        skills: i.skills,
        circuitBreaker: registry.getCircuitBreaker(i.id),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents }));
      return;
    }

    // 鉴权
    if (config.auth.enabled) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== config.auth.apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    // 限流
    if (config.rateLimit.enabled && !rateLimiter.check(clientIp, config.rateLimit.requestsPerMinute)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests' }));
      return;
    }

    // ── Open-Agent-Teams Chat Completions（核心路由端点）──
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of req) body += chunk;

      try {
        const request = JSON.parse(body);
        const messages: { role: string; content: string }[] = request.messages || [];
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        const messageText = lastUserMsg?.content || '';
        const explicitAgent = request.agentId || request.instance || '';

        // Open-Agent-Teams 意图分析 & 路由选择
        const intentStart = Date.now();
        let targetInstance: OATAgentInstance | undefined;

        if (explicitAgent) {
          targetInstance = registry.getInstance(explicitAgent);
          if (!targetInstance && explicitAgent.length < 10) {
            // 尝试匹配不含 dev- 前缀的 id
            targetInstance = registry.getInstance(`dev-${explicitAgent}`);
          }
        }

        if (!targetInstance) {
          const intent = await registry.analyzeIntentWithLLM(messageText);
          if (intent) {
            targetInstance = intent.instance;
            const routingInfo = registry.getLastRoutingDecision();
            console.log(`[oat-route] "${messageText.substring(0, 40)}" → ${targetInstance.id} (strategy: ${intent.strategy}, complexity: ${intent.complexity})`);
            console.log(`[oat-route] reasoning: ${intent.reasoning.substring(0, 80)}...`);
          }
        }

        if (!targetInstance) {
          targetInstance = registry.getDefaultInstance();
          console.log(`[oat-route] "${messageText.substring(0, 40)}" → default: ${targetInstance.id}`);
        }

        const intentAnalysisMs = Date.now() - intentStart;

        // 熔断器检查
        if (config.circuitBreaker.enabled && registry.isCircuitOpen(targetInstance.id)) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Agent ${targetInstance.id} 暂时不可用（熔断保护）` }));
          return;
        }

        // 调用 Agent
        const agentRes = await fetch(
          `http://127.0.0.1:${targetInstance.port}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages,
              sessionId: request.sessionId || '',
            }),
            signal: AbortSignal.timeout(Math.min(targetInstance.timeoutMs, 300000)),
          }
        );

        const data = (await agentRes.json()) as Record<string, unknown>;
        const latencyMs = Date.now() - startTime;

        if (agentRes.ok) {
          registry.recordSuccess(targetInstance.id);

          writeAuditLog({
            timestamp: new Date().toISOString(),
            requestId,
            path,
            instance: targetInstance.id,
            status: agentRes.status,
            latencyMs,
            intentAnalysisMs,
            messagePreview: messageText.substring(0, 80),
            error: null,
          }, config.logging.auditFile);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          const routingInfo = registry.getLastRoutingDecision();
          res.end(JSON.stringify({
            ...data,
            instance: targetInstance.id,
            routed_by: 'api-gateway',
            routing: routingInfo ? {
              strategy: routingInfo.strategy,
              complexity: routingInfo.complexity,
              reasoning: routingInfo.reasoning,
            } : undefined,
            latency_ms: latencyMs,
            intent_analysis_ms: intentAnalysisMs,
          }));
        } else {
          registry.recordFailure(targetInstance.id);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Agent ${targetInstance.id} 返回 ${agentRes.status}` }));
        }
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        writeAuditLog({
          timestamp: new Date().toISOString(),
          requestId,
          path,
          instance: null,
          status: 500,
          latencyMs,
          intentAnalysisMs: 0,
          messagePreview: '',
          error: error instanceof Error ? error.message : 'Unknown',
        }, config.logging.auditFile);

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }));
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(config.gateway.port, config.gateway.host, () => {
    console.log(`✅ Open-Agent-Teams Gateway 就绪 → http://${config.gateway.host}:${config.gateway.port}`);
    console.log('');
    console.log('📡 端点:');
    console.log(`  GET  /health           — 健康检查（含 Agent 状态）`);
    console.log(`  GET  /agents            — 已注册 Agent 列表`);
    console.log(`  POST /v1/chat/completions — Open-Agent-Teams 路由对话（OpenAI 兼容）`);
    console.log('');
    console.log('🔀 路由规则:');
    for (const rule of config.routing.rules) {
      console.log(`  [${rule.tags.join(', ')}] → ${rule.instance}`);
    }
    console.log(`  默认: ${config.routing.default}`);
  });
}

main().catch((error) => {
  console.error('❌ Open-Agent-Teams Gateway 启动失败:', error);
  process.exit(1);
});

function toProviderSafeMessages(
  messages: { role: string; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] {
  const systemContent = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n');

  const nonSystemMessages = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: message.content,
    }));

  if (!systemContent) return nonSystemMessages;

  const firstUserIndex = nonSystemMessages.findIndex((message) => message.role === 'user');
  const systemPrefix = `系统上下文与执行规则：\n${systemContent}`;

  if (firstUserIndex === -1) {
    return [{ role: 'user', content: systemPrefix }, ...nonSystemMessages];
  }

  return nonSystemMessages.map((message, index) => {
    if (index !== firstUserIndex) return message;
    return {
      ...message,
      content: `${systemPrefix}\n\n用户请求：\n${message.content}`,
    };
  });
}
