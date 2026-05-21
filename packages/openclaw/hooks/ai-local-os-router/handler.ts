/**
 * AI-local-OS Router Hook (Phase 2 - Multi-instance)
 * 
 * 垂类心智调度器：根据路由规则将任务分发到多个 Hermes 实例
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 路由规则关键词映射
const ROUTE_KEYWORDS = {
  hermes: ['记忆', '习惯', '偏好', '个人', '项目', '代码', '开发', '调试', '测试', '研究', '分析', '复盘', '总结', '规划', '学习', '成长', '目标', '计划', '反思', '记录', '生活', '健康', '运动', '饮食', '行业', '调研', '报告'],
  kernel: ['文件', '目录', '复制', '移动', '删除', '创建', '搜索', '查找', '下载', '上传', '同步', '安装', '卸载', '更新', '升级', '查看', '显示', '列出', '状态']
};

// 实例标签到关键词的映射（扩展版）
const INSTANCE_TAG_MAP = {
  'dev': ['代码', '开发', '调试', '测试', '项目', '仓库', 'git', 'ci', 'cd', '部署', '编程', 'bug', '修复', '重构'],
  'life': ['生活', '饮食', '作息', '健康', '运动', '睡眠', '习惯', '锻炼', '体重', '饮食', '作息', '休闲', '娱乐'],
  'research': ['研究', '分析', '调研', '报告', '总结', '复盘', '行业', '市场', '竞品', '趋势', '数据', '洞察']
};

// 熔断器状态
const circuitBreakers: Record<string, { failures: number; lastFailure: number; isOpen: boolean }> = {};

/**
 * 分析消息意图，判断是否需要路由到 Hermes
 */
function analyzeIntent(message: string) {
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

/**
 * 根据消息内容选择最合适的 Hermes 实例（带评分）
 */
function selectInstance(message: string, instances: any[]) {
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
        score += matchCount * 3; // 标签匹配权重
      }
    }
    
    // 实例 ID 和标签直接匹配
    if (lowerMessage.includes(instance.id.toLowerCase())) {
      score += 15;
    }
    
    if (lowerMessage.includes(instance.label.toLowerCase())) {
      score += 15;
    }
    
    // 熔断器检查
    const breaker = circuitBreakers[instance.id];
    if (breaker && breaker.isOpen) {
      const coolDownMs = 120 * 1000; // 120秒冷却
      if (Date.now() - breaker.lastFailure < coolDownMs) {
        score -= 100; // 熔断器打开时大幅降低分数
      } else {
        // 冷却期结束，重置熔断器
        breaker.failures = 0;
        breaker.isOpen = false;
      }
    }
    
    return { instance, score };
  });
  
  // 按分数排序
  scores.sort((a, b) => b.score - a.score);
  
  // 返回最高分的实例（如果分数 > 0）
  return scores[0].score > 0 ? scores[0].instance : null;
}

/**
 * 加载实例配置
 */
function loadInstances(configPath: string) {
  try {
    if (!existsSync(configPath)) {
      return [];
    }
    
    const content = readFileSync(configPath, 'utf-8');
    const instancesMatch = content.match(/instances:\s*\n([\s\S]*?)(?=\n[a-z]|$)/);
    if (!instancesMatch) {
      return [];
    }
    
    const instancesSection = instancesMatch[1];
    const instances = [];
    const instanceBlocks = instancesSection.split(/^- id:/m).filter(block => block.trim());
    
    for (const block of instanceBlocks) {
      const idMatch = block.match(/^\s*(\S+)/);
      const labelMatch = block.match(/label:\s*["']?(.+?)["']?\s*$/m);
      const baseUrlMatch = block.match(/baseUrl:\s*["'](.+?)["']/);
      const tagsMatch = block.match(/tags:\s*\[(.+?)\]/);
      const timeoutMatch = block.match(/timeoutMs:\s*(\d+)/);
      
      if (idMatch && baseUrlMatch) {
        instances.push({
          id: idMatch[1].trim(),
          label: labelMatch ? labelMatch[1].trim() : idMatch[1].trim(),
          baseUrl: baseUrlMatch[1].trim(),
          tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')) : [],
          timeoutMs: timeoutMatch ? parseInt(timeoutMatch[1]) : 60000
        });
      }
    }
    
    return instances;
  } catch (error) {
    return [];
  }
}

/**
 * 更新熔断器状态
 */
function updateCircuitBreaker(instanceId: string, success: boolean, failureThreshold: number = 3) {
  if (!circuitBreakers[instanceId]) {
    circuitBreakers[instanceId] = { failures: 0, lastFailure: 0, isOpen: false };
  }
  
  const breaker = circuitBreakers[instanceId];
  
  if (success) {
    // 成功时重置失败计数
    breaker.failures = 0;
    breaker.isOpen = false;
  } else {
    // 失败时增加计数
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    // 达到阈值时打开熔断器
    if (breaker.failures >= failureThreshold) {
      breaker.isOpen = true;
      console.warn(`[ai-local-os-router] 熔断器打开: ${instanceId} (连续失败 ${breaker.failures} 次)`);
    }
  }
}

/**
 * 主处理器
 */
const handler = async (event: any) => {
  if (event.type !== 'message' || event.action !== 'received') {
    return;
  }
  
  const { content, from, channelId } = event.context;
  
  if (!content || content.startsWith('/')) {
    return;
  }
  
  console.log(`[ai-local-os-router] 收到消息: "${content.substring(0, 50)}..."`);
  
  const intent = analyzeIntent(content);
  console.log(`[ai-local-os-router] 意图分析: ${intent.shouldRoute ? '路由到 Hermes' : '内核自执行'} (${intent.reason})`);
  
  if (!intent.shouldRoute) {
    return;
  }
  
  const projectRoot = process.env.AI_LOCAL_OS_ROOT || process.cwd();
  const configPath = join(projectRoot, 'docs/ai-local-os/hermes-instances.local.yaml');
  const instances = loadInstances(configPath);
  
  if (instances.length === 0) {
    console.warn('[ai-local-os-router] 没有可用的 Hermes 实例');
    return;
  }
  
  const selectedInstance = selectInstance(content, instances);
  if (!selectedInstance) {
    console.warn('[ai-local-os-router] 无法选择合适的实例（可能所有实例都在熔断状态）');
    return;
  }
  
  console.log(`[ai-local-os-router] 选择实例: ${selectedInstance.id} (${selectedInstance.label})`);
  
  // 调用 Hermes API
  try {
    const response = await fetch(`${selectedInstance.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'hermes-agent',
        messages: [{ role: 'user', content }],
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(selectedInstance.timeoutMs)
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        // 更新熔断器（成功）
        updateCircuitBreaker(selectedInstance.id, true);
        
        event.messages.push({
          role: 'assistant',
          content: `🧠 [${selectedInstance.label}] ${data.choices[0].message.content}`
        });
      }
    } else {
      // 更新熔断器（失败）
      updateCircuitBreaker(selectedInstance.id, false);
      console.error(`[ai-local-os-router] Hermes API 返回错误: ${response.status}`);
    }
  } catch (error) {
    // 更新熔断器（失败）
    updateCircuitBreaker(selectedInstance.id, false);
    console.error(`[ai-local-os-router] Hermes 调用失败:`, error);
  }
};

export default handler;
