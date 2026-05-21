/**
 * AI-local-OS Gateway Server
 * 
 * 薄网关：统一鉴权、路由、日志、限流、熔断
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ============================================================================
// Types
// ============================================================================

interface GatewayConfig {
  server: {
    host: string;
    port: number;
  };
  auth: {
    enabled: boolean;
    apiKey: string;
  };
  instances: InstanceConfig[];
  routing: {
    defaultInstance: string;
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
    maxSizeMb: number;
    backupCount: number;
  };
}

interface InstanceConfig {
  id: string;
  url: string;
  tags: string[];
  timeoutMs: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  halfOpenRequests: number;
}

interface RateLimitState {
  requests: number[];
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfig(): GatewayConfig {
  const configPath = join(process.env.HOME || '~', '.hermes-gateway', 'config.yaml');
  
  if (!existsSync(configPath)) {
    console.warn(`[gateway] 配置文件不存在: ${configPath}，使用默认配置`);
    return getDefaultConfig();
  }
  
  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as GatewayConfig;
    return { ...getDefaultConfig(), ...config };
  } catch (error) {
    console.error(`[gateway] 加载配置失败:`, error);
    return getDefaultConfig();
  }
}

function getDefaultConfig(): GatewayConfig {
  return {
    server: {
      host: process.env.AI_LOCAL_OS_HOST || '127.0.0.1',
      port: parseInt(process.env.AI_LOCAL_OS_PORT || '8100'),
    },
    auth: {
      enabled: process.env.AI_LOCAL_OS_AUTH_ENABLED !== 'false',
      apiKey: process.env.AI_LOCAL_OS_API_KEY || '',
    },
    instances: [
      {
        id: 'hermes-dev',
        url: 'http://127.0.0.1:8002',
        tags: ['dev', 'code', 'debug', 'test'],
        timeoutMs: 120000,
      },
      {
        id: 'hermes-life',
        url: 'http://127.0.0.1:8003',
        tags: ['life', 'health', 'habit'],
        timeoutMs: 60000,
      },
      {
        id: 'hermes-research',
        url: 'http://127.0.0.1:8004',
        tags: ['research', 'market', 'trend'],
        timeoutMs: 120000,
      },
    ],
    routing: {
      defaultInstance: 'hermes-dev',
    },
    rateLimit: {
      enabled: true,
      requestsPerMinute: 60,
      burstSize: 10,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      coolDownSeconds: 120,
    },
    logging: {
      level: 'INFO',
      auditFile: join(process.env.HOME || '~', '.hermes-gateway', 'logs', 'audit.log'),
      maxSizeMb: 100,
      backupCount: 5,
    },
  };
}

// ============================================================================
// Circuit Breaker
// ============================================================================

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreaker(instanceId: string): CircuitBreakerState {
  if (!circuitBreakers.has(instanceId)) {
    circuitBreakers.set(instanceId, {
      failures: 0,
      lastFailure: 0,
      isOpen: false,
      halfOpenRequests: 0,
    });
  }
  return circuitBreakers.get(instanceId)!;
}

function recordSuccess(instanceId: string): void {
  const state = getCircuitBreaker(instanceId);
  state.failures = 0;
  state.isOpen = false;
  state.halfOpenRequests = 0;
}

function recordFailure(instanceId: string, failureThreshold: number): void {
  const state = getCircuitBreaker(instanceId);
  state.failures++;
  state.lastFailure = Date.now();
  
  if (state.failures >= failureThreshold) {
    state.isOpen = true;
    console.warn(`[circuit-breaker] ${instanceId} 熔断器打开 (连续失败 ${state.failures} 次)`);
  }
}

function isCircuitOpen(instanceId: string, coolDownMs: number): boolean {
  const state = getCircuitBreaker(instanceId);
  
  if (!state.isOpen) {
    return false;
  }
  
  // 冷却期结束，进入半开状态
  if (Date.now() - state.lastFailure >= coolDownMs) {
    state.isOpen = false;
    state.halfOpenRequests = 1;
    console.log(`[circuit-breaker] ${instanceId} 进入半开状态`);
    return false;
  }
  
  return true;
}

// ============================================================================
// Rate Limiter
// ============================================================================

const rateLimitStates = new Map<string, RateLimitState>();

function checkRateLimit(clientIp: string, requestsPerMinute: number): boolean {
  if (!rateLimitStates.has(clientIp)) {
    rateLimitStates.set(clientIp, { requests: [] });
  }
  
  const state = rateLimitStates.get(clientIp)!;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  
  // 清理过期请求
  state.requests = state.requests.filter(t => now - t < windowMs);
  
  // 检查是否超过限制
  if (state.requests.length >= requestsPerMinute) {
    return false;
  }
  
  // 记录请求
  state.requests.push(now);
  return true;
}

// ============================================================================
// Router
// ============================================================================

// 路由规则关键词
const ROUTE_KEYWORDS = {
  hermes: ['记忆', '习惯', '偏好', '个人', '项目', '代码', '开发', '调试', '测试', '研究', '分析', '复盘', '总结', '规划', '学习', '成长', '目标', '计划', '反思', '记录', '生活', '健康', '运动', '饮食', '行业', '调研', '报告'],
  kernel: ['文件', '目录', '复制', '移动', '删除', '创建', '搜索', '查找', '下载', '上传', '同步', '安装', '卸载', '更新', '升级', '查看', '显示', '列出', '状态'],
};

const INSTANCE_TAG_MAP: Record<string, string[]> = {
  dev: ['代码', '开发', '调试', '测试', '项目', '仓库', 'git', 'ci', 'cd', '部署', '编程', 'bug', '修复', '重构'],
  life: ['生活', '饮食', '作息', '健康', '运动', '睡眠', '习惯', '锻炼', '体重', '休闲', '娱乐'],
  research: ['研究', '分析', '调研', '报告', '总结', '复盘', '行业', '市场', '竞品', '趋势', '数据', '洞察'],
};

function analyzeIntent(message: string): { shouldRoute: boolean; reason: string } {
  const lowerMessage = message.toLowerCase();
  
  const hasHermesKeyword = ROUTE_KEYWORDS.hermes.some(keyword => 
    lowerMessage.includes(keyword)
  );
  
  const hasKernelKeyword = ROUTE_KEYWORDS.kernel.some(keyword => 
    lowerMessage.includes(keyword)
  );
  
  if (hasHermesKeyword) {
    return { shouldRoute: true, reason: '包含垂类关键词' };
  }
  
  if (hasKernelKeyword && !hasHermesKeyword) {
    return { shouldRoute: false, reason: '仅包含通用操作关键词' };
  }
  
  return { shouldRoute: false, reason: '未匹配垂类路由规则' };
}

function selectInstance(message: string, instances: InstanceConfig[]): InstanceConfig | null {
  const lowerMessage = message.toLowerCase();
  
  const scores = instances.map(instance => {
    let score = 0;
    
    // 标签匹配评分
    for (const tag of instance.tags) {
      if (INSTANCE_TAG_MAP[tag]) {
        const tagKeywords = INSTANCE_TAG_MAP[tag];
        const matchCount = tagKeywords.filter(keyword => 
          lowerMessage.includes(keyword)
        ).length;
        score += matchCount * 3;
      }
    }
    
    // 实例 ID 和标签直接匹配
    if (lowerMessage.includes(instance.id.toLowerCase())) {
      score += 15;
    }
    
    // 熔断器检查
    const coolDownMs = 120 * 1000;
    if (isCircuitOpen(instance.id, coolDownMs)) {
      score -= 100;
    }
    
    return { instance, score };
  });
  
  scores.sort((a, b) => b.score - a.score);
  
  return scores[0].score > 0 ? scores[0].instance : null;
}

// ============================================================================
// Audit Logger
// ============================================================================

function ensureLogDirectory(auditFile: string): void {
  const dir = join(auditFile, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeAuditLog(log: Record<string, any>, auditFile: string): void {
  try {
    ensureLogDirectory(auditFile);
    const logLine = JSON.stringify(log) + '\n';
    appendFileSync(auditFile, logLine);
  } catch (error) {
    console.error('[audit] 写入日志失败:', error);
  }
}

// ============================================================================
// HTTP Handler
// ============================================================================

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig
): Promise<void> {
  const startTime = Date.now();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const clientIp = req.socket.remoteAddress || 'unknown';
  
  // 解析请求
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  
  // 健康检查（不需要鉴权）
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', gateway: 'ai-local-os' }));
    return;
  }
  
  // 实例状态（不需要鉴权）
  if (path === '/health/instances') {
    const instances = config.instances.map(i => ({
      id: i.id,
      url: i.url,
      circuitBreaker: getCircuitBreaker(i.id),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ instances }));
    return;
  }
  
  // 鉴权检查
  if (config.auth.enabled) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid API key' }));
      return;
    }
    
    const token = authHeader.slice(7);
    if (token !== config.auth.apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid API key' }));
      return;
    }
  }
  
  // 限流检查
  if (config.rateLimit.enabled && !checkRateLimit(clientIp, config.rateLimit.requestsPerMinute)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too Many Requests', message: 'Rate limit exceeded' }));
    return;
  }
  
  // 只处理 POST /v1/chat/completions
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    
    try {
      const request = JSON.parse(body);
      const message = request.messages?.[0]?.content || '';
      
      // 分析意图
      const intent = analyzeIntent(message);
      
      if (!intent.shouldRoute) {
        // 内核处理（当前版本直接返回提示）
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'kernel',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '此请求应由内核处理，而非 Hermes 实例。' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          instance: 'kernel',
          latency_ms: Date.now() - startTime,
        }));
        return;
      }
      
      // 选择实例
      const instance = request.instance 
        ? config.instances.find(i => i.id === request.instance)
        : selectInstance(message, config.instances);
      
      if (!instance) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable', message: 'No available instance' }));
        return;
      }
      
      // 熔断器检查
      const coolDownMs = config.circuitBreaker.coolDownSeconds * 1000;
      if (config.circuitBreaker.enabled && isCircuitOpen(instance.id, coolDownMs)) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Service Unavailable', 
          message: `Instance ${instance.id} is circuit-broken` 
        }));
        return;
      }
      
      // 转发请求到 Hermes 实例
      const response = await fetch(`${instance.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(instance.timeoutMs),
      });
      
      const data = await response.json() as any;
      const latencyMs = Date.now() - startTime;
      
      // 记录成功
      if (config.circuitBreaker.enabled) {
        recordSuccess(instance.id);
      }
      
      // 审计日志
      writeAuditLog({
        timestamp: new Date().toISOString(),
        request_id: requestId,
        method: 'POST',
        path,
        instance: instance.id,
        status: response.status,
        latency_ms: latencyMs,
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        error: null,
      }, config.logging.auditFile);
      
      // 返回响应
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...data,
        instance: instance.id,
        latency_ms: latencyMs,
      }));
      
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      // 记录失败
      if (config.circuitBreaker.enabled && error instanceof Error) {
        recordFailure(config.routing.defaultInstance, config.circuitBreaker.failureThreshold);
      }
      
      // 审计日志
      writeAuditLog({
        timestamp: new Date().toISOString(),
        request_id: requestId,
        method: 'POST',
        path,
        instance: null,
        status: 500,
        latency_ms: latencyMs,
        prompt_tokens: 0,
        completion_tokens: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, config.logging.auditFile);
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error' }));
    }
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', message: `Path ${path} not found` }));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('🚀 AI-local-OS Gateway starting...');
  
  const config = loadConfig();
  
  console.log(`📡 Server: http://${config.server.host}:${config.server.port}`);
  console.log(`🔐 Auth: ${config.auth.enabled ? 'enabled' : 'disabled'}`);
  console.log(`📦 Instances: ${config.instances.length}`);
  
  const server = createServer((req, res) => {
    handleRequest(req, res, config).catch(error => {
      console.error('[gateway] 请求处理失败:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    });
  });
  
  server.listen(config.server.port, config.server.host, () => {
    console.log(`✅ Gateway listening on http://${config.server.host}:${config.server.port}`);
    console.log('');
    console.log('📋 Available endpoints:');
    console.log(`   GET  http://${config.server.host}:${config.server.port}/health`);
    console.log(`   GET  http://${config.server.host}:${config.server.port}/health/instances`);
    console.log(`   POST http://${config.server.host}:${config.server.port}/v1/chat/completions`);
  });
}

main().catch(error => {
  console.error('❌ Gateway startup failed:', error);
  process.exit(1);
});
