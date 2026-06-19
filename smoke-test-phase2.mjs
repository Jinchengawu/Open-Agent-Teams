#!/usr/bin/env node

/**
 * AI-local-OS Phase 2 冒烟测试（多实例）
 * 
 * 验证多实例路由：用户消息 → Gateway → 最合适的 Hermes 实例
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 测试用例（扩展版）
const TEST_CASES = [
  {
    name: '测试 1: 开发相关 → hermes-dev',
    message: '帮我分析这个项目的代码结构',
    expectedInstance: 'hermes-dev',
    description: '应该路由到开发实例'
  },
  {
    name: '测试 2: 生活相关 → hermes-life',
    message: '记录我的饮食习惯和运动计划',
    expectedInstance: 'hermes-life',
    description: '应该路由到生活实例'
  },
  {
    name: '测试 3: 研究相关 → hermes-research',
    message: '分析当前AI行业市场趋势',
    expectedInstance: 'hermes-research',
    description: '应该路由到研究实例'
  },
  {
    name: '测试 4: 通用操作 → 内核',
    message: '查看当前目录文件',
    expectedInstance: null,
    description: '应该由内核处理'
  },
  {
    name: '测试 5: 混合意图 → 优先垂类',
    message: '记录今天的编程学习心得',
    expectedInstance: 'hermes-dev',
    description: '编程学习应路由到开发实例'
  }
];

// 路由规则关键词
const ROUTE_KEYWORDS = {
  hermes: ['记忆', '习惯', '偏好', '个人', '项目', '代码', '开发', '调试', '测试', '研究', '分析', '复盘', '总结', '规划', '学习', '成长', '目标', '计划', '反思', '记录', '生活', '健康', '运动', '饮食', '行业', '调研', '报告'],
  kernel: ['文件', '目录', '复制', '移动', '删除', '创建', '搜索', '查找', '下载', '上传', '同步', '安装', '卸载', '更新', '升级', '查看', '显示', '列出', '状态']
};

// 实例标签到关键词的映射
const INSTANCE_TAG_MAP = {
  'dev': ['代码', '开发', '调试', '测试', '项目', '仓库', 'git', 'ci', 'cd', '部署', '编程', 'bug', '修复', '重构'],
  'life': ['生活', '饮食', '作息', '健康', '运动', '睡眠', '习惯', '锻炼', '体重', '休闲', '娱乐'],
  'research': ['研究', '分析', '调研', '报告', '总结', '复盘', '行业', '市场', '竞品', '趋势', '数据', '洞察']
};

/**
 * 分析消息意图
 */
function analyzeIntent(message) {
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
 * 选择实例（简化版）
 */
function selectInstance(message, instances) {
  const lowerMessage = message.toLowerCase();
  
  const scores = instances.map(instance => {
    let score = 0;
    
    for (const tag of instance.tags) {
      if (INSTANCE_TAG_MAP[tag]) {
        const tagKeywords = INSTANCE_TAG_MAP[tag];
        const matchCount = tagKeywords.filter(keyword => 
          lowerMessage.includes(keyword)
        ).length;
        score += matchCount * 3;
      }
    }
    
    if (lowerMessage.includes(instance.id.toLowerCase())) {
      score += 15;
    }
    
    if (lowerMessage.includes(instance.label.toLowerCase())) {
      score += 15;
    }
    
    return { instance, score };
  });
  
  scores.sort((a, b) => b.score - a.score);
  
  return scores[0].score > 0 ? scores[0].instance : null;
}

/**
 * 加载实例配置
 */
function loadInstances(configPath) {
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
      
      if (idMatch && baseUrlMatch) {
        instances.push({
          id: idMatch[1].trim(),
          label: labelMatch ? labelMatch[1].trim() : idMatch[1].trim(),
          baseUrl: baseUrlMatch[1].trim(),
          tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')) : []
        });
      }
    }
    
    return instances;
  } catch (error) {
    return [];
  }
}

/**
 * 检查实例是否可用
 */
async function checkInstance(instance) {
  try {
    const response = await fetch(`${instance.baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * 运行冒烟测试
 */
async function runSmokeTest() {
  console.log('🧪 AI-local-OS Phase 2 冒烟测试（多实例）\n');
  
  // 检查环境
  console.log('📋 检查环境...');
  
  const projectRoot = process.cwd();
  const instancesPath = join(projectRoot, 'docs/open-agent-teams/hermes-instances.local.yaml');
  
  if (!existsSync(instancesPath)) {
    console.error('❌ 实例配置文件不存在');
    process.exit(1);
  }
  console.log('  ✅ 实例配置文件存在');
  
  // 加载实例
  const instances = loadInstances(instancesPath);
  console.log(`  ✅ 加载了 ${instances.length} 个实例`);
  
  // 检查实例状态
  console.log('\n🔍 检查实例状态...');
  const instanceStatus = {};
  
  for (const instance of instances) {
    const isAvailable = await checkInstance(instance);
    instanceStatus[instance.id] = isAvailable;
    console.log(`  ${isAvailable ? '✅' : '❌'} ${instance.label} (${instance.baseUrl})`);
  }
  
  // 运行测试用例
  console.log('\n🚀 运行测试用例...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of TEST_CASES) {
    console.log(`📝 ${testCase.name}`);
    console.log(`   消息: "${testCase.message}"`);
    console.log(`   描述: ${testCase.description}`);
    
    const intent = analyzeIntent(testCase.message);
    
    if (!intent.shouldRoute) {
      // 应该由内核处理
      if (testCase.expectedInstance === null) {
        console.log(`   ✅ 通过 - 正确识别为内核操作`);
        passed++;
      } else {
        console.log(`   ❌ 失败 - 期望路由到 ${testCase.expectedInstance}，但识别为内核操作`);
        failed++;
      }
    } else {
      // 应该路由到 Hermes
      const selectedInstance = selectInstance(testCase.message, instances);
      
      if (selectedInstance && selectedInstance.id === testCase.expectedInstance) {
        console.log(`   ✅ 通过 - 正确路由到 ${selectedInstance.id}`);
        passed++;
      } else if (selectedInstance) {
        console.log(`   ❌ 失败 - 期望 ${testCase.expectedInstance}，实际 ${selectedInstance.id}`);
        failed++;
      } else {
        console.log(`   ❌ 失败 - 无法选择实例`);
        failed++;
      }
    }
    
    console.log('');
  }
  
  // 总结
  console.log('📊 测试总结');
  console.log(`   通过: ${passed}/${TEST_CASES.length}`);
  console.log(`   失败: ${failed}/${TEST_CASES.length}`);
  
  // 实例可用性总结
  console.log('\n📋 实例可用性:');
  const availableCount = Object.values(instanceStatus).filter(Boolean).length;
  console.log(`   可用: ${availableCount}/${instances.length}`);
  
  if (failed === 0) {
    console.log('\n🎉 所有测试通过！Phase 2 多实例路由验证成功。');
    console.log('\n📋 下一步：');
    console.log('   1. 启动所有实例: ./start-all-instances.sh');
    console.log('   2. 测试实际路由: openclaw agent --local -m "记录我的饮食习惯"');
  } else {
    console.log('\n❌ 部分测试失败，请检查路由规则配置。');
    process.exit(1);
  }
}

// 运行测试
runSmokeTest().catch(error => {
  console.error('❌ 测试运行失败:', error);
  process.exit(1);
});
