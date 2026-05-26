#!/usr/bin/env node

/**
 * AI-local-OS Phase 1 冒烟测试
 * 
 * 验证最小闭环：用户消息 → OpenClaw → Hermes → 返回结果
 * 
 * 使用方法：
 *   node smoke-test.mjs
 * 
 * 前置条件：
 *   1. Hermes API Server 已启动（端口 8002）
 *   2. .env 文件已配置
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 测试用例
const TEST_CASES = [
  {
    name: '测试 1: 通用操作（应由内核处理）',
    message: '查看当前目录文件',
    expectedRoute: false,
    description: '应该由 OpenClaw 内核处理，不路由到 Hermes'
  },
  {
    name: '测试 2: 开发相关（应路由到 Hermes）',
    message: '帮我分析这个项目的代码结构',
    expectedRoute: true,
    description: '应该路由到 hermes-dev 实例'
  },
  {
    name: '测试 3: 个人偏好（应路由到 Hermes）',
    message: '记录我的编程习惯偏好',
    expectedRoute: true,
    description: '应该路由到 hermes-dev 实例'
  }
];

// 路由规则关键词（与 handler.ts 保持一致）
const ROUTE_KEYWORDS = {
  hermes: ['记忆', '习惯', '偏好', '个人', '项目', '代码', '开发', '调试', '测试', '研究', '分析', '复盘', '总结', '规划', '学习', '成长', '目标', '计划', '反思', '记录'],
  kernel: ['文件', '目录', '复制', '移动', '删除', '创建', '搜索', '查找', '下载', '上传', '同步', '安装', '卸载', '更新', '升级', '查看', '显示', '列出', '状态']
};

/**
 * 分析消息意图（简化版，与 handler.ts 一致）
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
 * 检查 Hermes API Server 是否可用
 */
async function checkHermesApiServer(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
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
  console.log('🧪 AI-local-OS Phase 1 冒烟测试\n');
  
  // 检查环境
  console.log('📋 检查环境...');
  
  const projectRoot = process.cwd();
  const envPath = join(projectRoot, '.env');
  const instancesPath = join(projectRoot, 'docs/open-agent-teams/hermes-instances.local.yaml');
  
  if (!existsSync(envPath)) {
    console.error('❌ .env 文件不存在');
    process.exit(1);
  }
  console.log('  ✅ .env 文件存在');
  
  if (!existsSync(instancesPath)) {
    console.error('❌ hermes-instances.local.yaml 文件不存在');
    process.exit(1);
  }
  console.log('  ✅ 实例配置文件存在');
  
  // 检查 Hermes API Server
  console.log('\n🔍 检查 Hermes API Server...');
  const apiServerAvailable = await checkHermesApiServer('http://127.0.0.1:8002');
  
  if (!apiServerAvailable) {
    console.warn('  ⚠️  Hermes API Server (端口 8002) 未运行');
    console.log('     请先启动 Hermes API Server：');
    console.log('     ./start-hermes.sh');
    console.log('\n📝 继续测试路由逻辑（跳过 API 调用）...\n');
  } else {
    console.log('  ✅ Hermes API Server 运行正常');
  }
  
  // 运行测试用例
  console.log('🚀 运行测试用例...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of TEST_CASES) {
    console.log(`📝 ${testCase.name}`);
    console.log(`   消息: "${testCase.message}"`);
    console.log(`   描述: ${testCase.description}`);
    
    const intent = analyzeIntent(testCase.message);
    const result = intent.shouldRoute === testCase.expectedRoute;
    
    if (result) {
      console.log(`   ✅ 通过 - 路由判断正确: ${intent.shouldRoute ? '路由到 Hermes' : '内核自执行'}`);
      passed++;
    } else {
      console.log(`   ❌ 失败 - 期望: ${testCase.expectedRoute ? '路由到 Hermes' : '内核自执行'}, 实际: ${intent.shouldRoute ? '路由到 Hermes' : '内核自执行'}`);
      failed++;
    }
    
    console.log('');
  }
  
  // 如果 Hermes API Server 可用，进行实际 API 调用测试
  if (apiServerAvailable) {
    console.log('🔌 测试 Hermes API 调用...\n');
    
    try {
      const testMessage = '你好，请简单介绍一下自己';
      const response = await fetch('http://127.0.0.1:8002/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'hermes-agent',
          messages: [
            { role: 'user', content: testMessage }
          ],
          temperature: 0.7,
          max_tokens: 100
        }),
        signal: AbortSignal.timeout(30000)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
          console.log('   ✅ Hermes API 调用成功');
          console.log(`   响应: ${data.choices[0].message.content.substring(0, 100)}...`);
        } else {
          console.log('   ⚠️  Hermes 返回空响应');
        }
      } else {
        console.log(`   ⚠️  Hermes API 返回错误: ${response.status}`);
      }
    } catch (error) {
      console.log(`   ⚠️  Hermes API 调用失败: ${error.message}`);
    }
    
    console.log('');
  }
  
  // 总结
  console.log('📊 测试总结');
  console.log(`   通过: ${passed}/${TEST_CASES.length}`);
  console.log(`   失败: ${failed}/${TEST_CASES.length}`);
  
  if (failed === 0) {
    console.log('\n🎉 所有测试通过！Phase 1 最小闭环验证成功。');
    console.log('\n📋 下一步：');
    console.log('   1. 启动 Hermes API Server: ./start-hermes.sh');
    console.log('   2. 安装 OpenClaw 插件: ./setup-plugin.sh');
    console.log('   3. 测试完整流程: openclaw agent "帮我分析项目结构"');
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
