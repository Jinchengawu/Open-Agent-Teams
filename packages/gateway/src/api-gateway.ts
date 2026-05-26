/**
 * API Gateway (OpenClaw 集成) for DEV-Agent-Teams
 *
 * 核心职责：OpenClaw 作为中央编排层，负责：
 * 1. Agent 注册与发现
 * 2. 意图分析与智能路由
 * 3. 多 Agent 协同编排
 * 4. 统一鉴权、限流、熔断、审计
 *
 * 此 Gateway 替代之前 Dashboard → Agent 直接调用的自实现路由，
 * 改为 Dashboard → OpenClaw Gateway → Agent 的标准三层架构。
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
// Types — 与 OpenClaw 原生 Agent 概念对齐
// ============================================================================

interface OpenClawGatewayConfig {
  gateway: {
    host: string;
    port: number;
    name: string;
  };
  openclaw: {
    enabled: boolean;
    version: string;
  };
  instances: OpenClawAgentInstance[];
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

interface OpenClawAgentInstance {
  id: string;
  label: string;
  port: number;
  hermesPort: number;
  tags: string[];
  skills: string[];
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

function loadConfig(): OpenClawGatewayConfig {
  const configPaths = [
    join(process.cwd(), 'config/openclaw/instances.yaml'),
    join(process.env.HOME || '~', '.dev-agent/openclaw/instances.yaml'),
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

function normalizeConfig(raw: Record<string, unknown>): OpenClawGatewayConfig {
  return {
    gateway: {
      host: '127.0.0.1',
      port: (raw.openclaw as Record<string, unknown>)?.port as number || 8400,
      name: 'api-gateway',
    },
    openclaw: {
      enabled: (raw.openclaw as Record<string, unknown>)?.enabled as boolean ?? true,
      version: (raw.openclaw as Record<string, unknown>)?.version as string || '2026.3.7',
    },
    instances: ((raw.instances || []) as Record<string, unknown>[]).map((i) => ({
      id: i.id as string,
      label: i.label as string,
      port: i.port as number,
      hermesPort: (i.hermes_port || i.hermesPort || i.port) as number,
      tags: (i.tags || []) as string[],
      skills: (i.skills || []) as string[],
      timeoutMs: (i.timeout_ms || i.timeoutMs || 120000) as number,
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

function getDefaultConfig(): OpenClawGatewayConfig {
  return {
    gateway: { host: '127.0.0.1', port: 8400, name: 'api-gateway' },
    openclaw: { enabled: true, version: '2026.3.7' },
    instances: [
      { id: 'dev-frontend', label: '前端开发 Agent', port: 8201, hermesPort: 9201, tags: ['react','vue','component','ui','css','typescript','frontend','前端'], skills: [], timeoutMs: 120000 },
      { id: 'dev-backend', label: '后端开发 Agent', port: 8202, hermesPort: 9202, tags: ['api','database','server','python','node','go','backend','后端'], skills: [], timeoutMs: 120000 },
      { id: 'dev-testing', label: '测试开发 Agent', port: 8203, hermesPort: 9203, tags: ['test','unit','e2e','coverage','jest','pytest','testing','测试'], skills: [], timeoutMs: 180000 },
      { id: 'dev-devops', label: 'DevOps Agent', port: 8204, hermesPort: 9204, tags: ['docker','k8s','kubernetes','deploy','ci/cd','devops','运维'], skills: [], timeoutMs: 300000 },
      { id: 'dev-pm', label: '产品经理 Agent', port: 8205, hermesPort: 9205, tags: ['prd','requirement','product','strategy','user-story','pm','产品','需求'], skills: [], timeoutMs: 120000 },
    ],
    routing: { rules: [], default: 'dev-backend' },
    auth: { enabled: false, apiKey: '' },
    rateLimit: { enabled: true, requestsPerMinute: 60, burstSize: 10 },
    circuitBreaker: { enabled: true, failureThreshold: 3, coolDownSeconds: 120 },
    logging: { level: 'INFO', auditFile: join(process.env.HOME || '~', '.dev-agent/logs/audit.log') },
  };
}

// ============================================================================
// OpenClaw Agent Registry — 原生 Agent 管理
// ============================================================================

class OpenClawAgentRegistry {
  private instances: Map<string, OpenClawAgentInstance> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private config: OpenClawGatewayConfig;

  constructor(config: OpenClawGatewayConfig) {
    this.config = config;
    for (const instance of config.instances) {
      this.instances.set(instance.id, instance);
      this.circuitBreakers.set(instance.id, { failures: 0, lastFailure: 0, isOpen: false });
    }
    console.log(`[openclaw-registry] 注册了 ${this.instances.size} 个 Agent 实例`);
    for (const [id, inst] of this.instances) {
      console.log(`  ${id} → Agent:${inst.port} Hermes:${inst.hermesPort} tags:[${inst.tags.join(',')}]`);
    }
  }

  getInstance(id: string): OpenClawAgentInstance | undefined {
    return this.instances.get(id);
  }

  getAllInstances(): OpenClawAgentInstance[] {
    return [...this.instances.values()];
  }

  /**
   * OpenClaw 原生意图分析 — 基于标签评分
   * 替代之前前端 detectAgent() 和 ai-router 的自实现逻辑
   */
  analyzeIntent(message: string): { instance: OpenClawAgentInstance; score: number } | null {
    const lower = message.toLowerCase();
    const scores: { instance: OpenClawAgentInstance; score: number }[] = [];

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

  getDefaultInstance(): OpenClawAgentInstance {
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
// OpenClaw Gateway — 主服务
// ============================================================================

async function main(): Promise<void> {
  console.log('🧠 OpenClaw Gateway v0.1.0 — DEV-Agent-Teams');
  console.log('===============================================');

  const config = loadConfig();
  const registry = new OpenClawAgentRegistry(config);
  const rateLimiter = new RateLimiter();

  // Agent 注册摘要
  console.log('');
  console.log(`📋 OpenClaw v${config.openclaw.version} | ${registry.getAllInstances().length} Agents registered`);
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
        openclaw: config.openclaw,
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

    // ── OpenClaw Chat Completions（核心路由端点）──
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of req) body += chunk;

      try {
        const request = JSON.parse(body);
        const messages: { role: string; content: string }[] = request.messages || [];
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        const messageText = lastUserMsg?.content || '';
        const explicitAgent = request.agentId || request.instance || '';

        // OpenClaw 意图分析 & 路由选择
        const intentStart = Date.now();
        let targetInstance: OpenClawAgentInstance | undefined;

        if (explicitAgent) {
          targetInstance = registry.getInstance(explicitAgent);
          if (!targetInstance && explicitAgent.length < 10) {
            // 尝试匹配不含 dev- 前缀的 id
            targetInstance = registry.getInstance(`dev-${explicitAgent}`);
          }
        }

        if (!targetInstance) {
          const intent = registry.analyzeIntent(messageText);
          if (intent) {
            targetInstance = intent.instance;
            console.log(`[openclaw-route] "${messageText.substring(0, 40)}" → ${targetInstance.id} (score: ${intent.score})`);
          }
        }

        if (!targetInstance) {
          targetInstance = registry.getDefaultInstance();
          console.log(`[openclaw-route] "${messageText.substring(0, 40)}" → default: ${targetInstance.id}`);
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
          res.end(JSON.stringify({
            ...data,
            instance: targetInstance.id,
            routed_by: 'api-gateway',
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
    console.log(`✅ OpenClaw Gateway 就绪 → http://${config.gateway.host}:${config.gateway.port}`);
    console.log('');
    console.log('📡 端点:');
    console.log(`  GET  /health           — 健康检查（含 Agent 状态）`);
    console.log(`  GET  /agents            — 已注册 Agent 列表`);
    console.log(`  POST /v1/chat/completions — OpenClaw 路由对话（OpenAI 兼容）`);
    console.log('');
    console.log('🔀 路由规则:');
    for (const rule of config.routing.rules) {
      console.log(`  [${rule.tags.join(', ')}] → ${rule.instance}`);
    }
    console.log(`  默认: ${config.routing.default}`);
  });
}

main().catch((error) => {
  console.error('❌ OpenClaw Gateway 启动失败:', error);
  process.exit(1);
});
