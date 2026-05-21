/**
 * AI-local-OS Router Plugin
 * 
 * 垂类心智调度器：根据路由规则将任务分发到 Hermes 实例
 * 
 * 路由逻辑：
 * 1. 分析用户消息意图
 * 2. 判断是否需要路由到 Hermes
 * 3. 选择合适的 Hermes 实例
 * 4. 调用 Hermes API
 * 5. 返回结果
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 路由规则关键词映射
const ROUTE_KEYWORDS = {
  // 应该路由到 Hermes 的关键词
  hermes: [
    '记忆', '习惯', '偏好', '个人', '项目', '代码', '开发',
    '调试', '测试', '研究', '分析', '复盘', '总结', '规划',
    '学习', '成长', '目标', '计划', '反思', '记录'
  ],
  // 应该由内核自执行的关键词
  kernel: [
    '文件', '目录', '复制', '移动', '删除', '创建',
    '搜索', '查找', '下载', '上传', '同步',
    '安装', '卸载', '更新', '升级',
    '查看', '显示', '列出', '状态'
  ]
};

// 实例标签到关键词的映射
const INSTANCE_TAG_MAP = {
  'dev': ['代码', '开发', '调试', '测试', '项目', '仓库', 'git', 'ci', 'cd', '部署'],
  'life': ['生活', '饮食', '作息', '健康', '运动', '睡眠', '习惯'],
  'research': ['研究', '分析', '调研', '报告', '总结', '复盘', '行业']
};

/**
 * 分析消息意图，判断是否需要路由到 Hermes
 */
function analyzeIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // 检查是否包含 Hermes 路由关键词
  const hasHermesKeyword = ROUTE_KEYWORDS.hermes.some(keyword => 
    lowerMessage.includes(keyword)
  );
  
  // 检查是否包含内核自执行关键词
  const hasKernelKeyword = ROUTE_KEYWORDS.kernel.some(keyword => 
    lowerMessage.includes(keyword)
  );
  
  // 如果同时包含两类关键词，优先判断为需要路由
  // （因为"查看项目状态"这样的混合意图更适合由 Hermes 处理）
  if (hasHermesKeyword) {
    return { shouldRoute: true, reason: '包含垂类关键词' };
  }
  
  if (hasKernelKeyword && !hasHermesKeyword) {
    return { shouldRoute: false, reason: '仅包含通用操作关键词' };
  }
  
  // 默认不路由，让内核处理
  return { shouldRoute: false, reason: '未匹配垂类路由规则' };
}

/**
 * 根据消息内容选择合适的 Hermes 实例
 */
function selectInstance(message, instances) {
  const lowerMessage = message.toLowerCase();
  
  // 计算每个实例的匹配分数
  const scores = instances.map(instance => {
    let score = 0;
    
    // 检查实例标签匹配
    for (const tag of instance.tags) {
      if (INSTANCE_TAG_MAP[tag]) {
        const tagKeywords = INSTANCE_TAG_MAP[tag];
        const matchCount = tagKeywords.filter(keyword => 
          lowerMessage.includes(keyword)
        ).length;
        score += matchCount * 2; // 标签匹配权重更高
      }
    }
    
    // 检查实例 ID 和标签直接匹配
    if (lowerMessage.includes(instance.id.toLowerCase())) {
      score += 10;
    }
    
    if (lowerMessage.includes(instance.label.toLowerCase())) {
      score += 10;
    }
    
    return { instance, score };
  });
  
  // 按分数排序，返回最高分的实例
  scores.sort((a, b) => b.score - a.score);
  
  // 如果最高分 > 0，返回对应实例
  if (scores[0].score > 0) {
    return scores[0].instance;
  }
  
  // 默认返回第一个实例（如果有）
  return instances.length > 0 ? instances[0] : null;
}

/**
 * 加载实例配置
 */
function loadInstances(configPath) {
  try {
    if (!existsSync(configPath)) {
      console.error(`[ai-local-os-router] 配置文件不存在: ${configPath}`);
      return [];
    }
    
    // 简单的 YAML 解析（实际项目中应使用 js-yaml）
    const content = readFileSync(configPath, 'utf-8');
    
    // 提取 instances 部分
    const instancesMatch = content.match(/instances:\s*\n([\s\S]*?)(?=\n[a-z]|$)/);
    if (!instancesMatch) {
      console.error('[ai-local-os-router] 无法解析 instances 配置');
      return [];
    }
    
    const instancesSection = instancesMatch[1];
    const instances = [];
    
    // 解析每个实例
    const instanceBlocks = instancesSection.split(/^- id:/m).filter(block => block.trim());
    
    for (const block of instanceBlocks) {
      const idMatch = block.match(/^\s*(\S+)/);
      const labelMatch = block.match(/label:\s*["']?(.+?)["']?\s*$/m);
      const baseUrlMatch = block.match(/baseUrl:\s*["'](.+?)["']/);
      const tagsMatch = block.match(/tags:\s*\[(.+?)\]/);
      const timeoutMatch = block.match(/timeoutMs:\s*(\d+)/);
      const notesMatch = block.match(/notes:\s*["'](.+?)["']/);
      
      if (idMatch && baseUrlMatch) {
        instances.push({
          id: idMatch[1].trim(),
          label: labelMatch ? labelMatch[1].trim() : idMatch[1].trim(),
          baseUrl: baseUrlMatch[1].trim(),
          tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')) : [],
          timeoutMs: timeoutMatch ? parseInt(timeoutMatch[1]) : 60000,
          notes: notesMatch ? notesMatch[1].trim() : ''
        });
      }
    }
    
    return instances;
  } catch (error) {
    console.error(`[ai-local-os-router] 加载实例配置失败:`, error);
    return [];
  }
}

/**
 * 调用 Hermes API
 */
async function callHermesApi(instance, message, apiKey) {
  const url = `${instance.baseUrl}/v1/chat/completions`;
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  const payload = {
    model: 'hermes-agent', // 或者从配置中读取
    messages: [
      {
        role: 'system',
        content: `你是 ${instance.label}，专注于${instance.notes || '相关领域'}。`
      },
      {
        role: 'user',
        content: message
      }
    ],
    temperature: 0.7,
    max_tokens: 2000
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(instance.timeoutMs)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.choices && data.choices.length > 0) {
      return {
        success: true,
        content: data.choices[0].message.content,
        instance: instance.id,
        usage: data.usage
      };
    } else {
      return {
        success: false,
        error: 'Hermes 返回空响应',
        instance: instance.id
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      instance: instance.id
    };
  }
}

/**
 * 主处理器
 */
const handler = async (event) => {
  // 只处理接收到的消息
  if (event.type !== 'message' || event.action !== 'received') {
    return;
  }
  
  const { content, from, channelId } = event.context;
  
  // 跳过空消息或命令消息
  if (!content || content.startsWith('/')) {
    return;
  }
  
  console.log(`[ai-local-os-router] 收到消息: "${content.substring(0, 50)}..."`);
  
  // 分析意图
  const intent = analyzeIntent(content);
  console.log(`[ai-local-os-router] 意图分析: ${intent.shouldRoute ? '路由到 Hermes' : '内核自执行'} (${intent.reason})`);
  
  if (!intent.shouldRoute) {
    // 不需要路由，让内核处理
    return;
  }
  
  // 加载实例配置
  const projectRoot = process.env.AI_LOCAL_OS_ROOT || process.cwd();
  const configPath = join(projectRoot, 'docs/ai-local-os/hermes-instances.local.yaml');
  const instances = loadInstances(configPath);
  
  if (instances.length === 0) {
    console.warn('[ai-local-os-router] 没有可用的 Hermes 实例，回退到内核处理');
    return;
  }
  
  // 选择实例
  const selectedInstance = selectInstance(content, instances);
  if (!selectedInstance) {
    console.warn('[ai-local-os-router] 无法选择合适的实例，回退到内核处理');
    return;
  }
  
  console.log(`[ai-local-os-router] 选择实例: ${selectedInstance.id} (${selectedInstance.label})`);
  
  // 获取 API Key（从环境变量）
  const apiKeyEnvVar = `HERMES_${selectedInstance.id.toUpperCase().replace('-', '_')}_API_KEY`;
  const apiKey = process.env[apiKeyEnvVar];
  
  // 调用 Hermes API
  const result = await callHermesApi(selectedInstance, content, apiKey);
  
  if (result.success) {
    console.log(`[ai-local-os-router] Hermes 调用成功，返回 ${result.content.length} 字符`);
    
    // 将结果发送给用户
    event.messages.push({
      role: 'assistant',
      content: `🧠 [${selectedInstance.label}] ${result.content}`
    });
  } else {
    console.error(`[ai-local-os-router] Hermes 调用失败: ${result.error}`);
    
    // 失败时回退到内核处理
    event.messages.push({
      role: 'assistant', 
      content: `⚠️ 垂类心智暂时不可用 (${result.error})，已回退到通用处理。`
    });
  }
};

export default handler;
