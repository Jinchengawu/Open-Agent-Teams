/**
 * ConflictResolver — 冲突解决引擎
 *
 * 当 Pipeline 中多个 Agent 产生冲突产物时，自动触发仲裁机制。
 * 支持多种解决策略：
 * - profile arbitration agent 仲裁（默认）
 * - 投票机制（多数决）
 * - 合并策略（取并集）
 * - 最新优先（取最后一次执行结果）
 */
// ============================================================================
// 冲突解决引擎
// ============================================================================
export class ConflictResolver {
    teamOrchestrator;
    knowledgeCenter;
    conflicts = new Map();
    defaultStrategy = 'arbitration';
    constructor(teamOrchestrator, knowledgeCenter, defaultStrategy) {
        this.teamOrchestrator = teamOrchestrator;
        this.knowledgeCenter = knowledgeCenter;
        if (defaultStrategy) {
            this.defaultStrategy = defaultStrategy;
        }
    }
    /**
     * 注册冲突（Pipeline 调用）
     */
    registerConflict(instanceId, surfaceIds, artifacts, description) {
        const conflictId = `conflict-${instanceId}-${Date.now()}`;
        const conflict = {
            id: conflictId,
            description,
            surfaceIds,
            artifacts,
            createdAt: Date.now(),
            status: 'pending',
        };
        this.conflicts.set(conflictId, conflict);
        console.log(`[ConflictResolver] 冲突已注册: ${conflictId} (${surfaceIds.join(' vs ')})`);
        return conflict;
    }
    /**
     * 解决冲突（主入口）
     */
    async resolve(conflictId, config) {
        const conflict = this.conflicts.get(conflictId);
        if (!conflict) {
            return { resolved: false, reason: '冲突未找到', strategy: config?.strategy || this.defaultStrategy };
        }
        const strategy = config?.strategy || this.defaultStrategy;
        console.log(`[ConflictResolver] 使用策略: ${strategy} 解决冲突 ${conflictId}`);
        let resolution;
        switch (strategy) {
            case 'arbitration':
                resolution = await this.arbitrate(conflict);
                break;
            case 'vote':
                resolution = await this.vote(conflict, config?.params);
                break;
            case 'merge':
                resolution = this.merge(conflict);
                break;
            case 'latest':
                resolution = this.latest(conflict);
                break;
            case 'manual':
                resolution = await this.manual(conflict);
                break;
            default:
                resolution = await this.arbitrate(conflict);
        }
        // 更新冲突状态
        conflict.resolution = resolution;
        conflict.status = resolution.resolved ? 'resolved' : 'rejected';
        // 记录到知识中心
        this.recordToKnowledgeCenter(conflict, resolution);
        return resolution;
    }
    /**
     * 策略 1: profile arbitration agent 仲裁（默认）
     */
    async arbitrate(conflict) {
        const arbitrationGoal = this.buildArbitrationPrompt(conflict);
        try {
            const arbitrationAgentId = this.teamOrchestrator.getArbitrationAgentId();
            const result = await this.teamOrchestrator.runAgent(arbitrationAgentId, arbitrationGoal, conflict.id);
            const resultText = result.output;
            let parsed;
            try {
                parsed = JSON.parse(resultText);
            }
            catch {
                // 解析失败，使用原始文本
                return {
                    resolved: true,
                    strategy: 'arbitration',
                    reason: `${arbitrationAgentId} 仲裁结果: ${resultText.substring(0, 500)}`,
                };
            }
            return {
                resolved: true,
                winner: parsed.winner,
                merged: parsed.merged,
                reason: parsed.reason || `${arbitrationAgentId} 仲裁完成`,
                strategy: 'arbitration',
                metadata: { rawResult: resultText },
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return {
                resolved: false,
                reason: `仲裁失败: ${errorMsg}`,
                strategy: 'arbitration',
            };
        }
    }
    /**
     * 策略 2: 投票机制（多数决）
     */
    async vote(conflict, params) {
        const voters = params?.voters || [
            this.teamOrchestrator.getDefaultAgentId(),
            this.teamOrchestrator.getArbitrationAgentId(),
        ];
        const votes = {};
        for (const surfaceId of conflict.surfaceIds) {
            votes[surfaceId] = 0;
        }
        const votePrompt = this.buildVotePrompt(conflict);
        for (const voter of voters) {
            try {
                const result = await this.teamOrchestrator.runAgent(voter, votePrompt, conflict.id);
                const winner = this.extractWinnerFromVote(result.output, conflict.surfaceIds);
                if (winner && votes[winner] !== undefined) {
                    votes[winner]++;
                }
            }
            catch (error) {
                console.warn(`[ConflictResolver] 投票者 ${voter} 投票失败:`, error);
            }
        }
        // 找出得票最多的
        let winner = '';
        let maxVotes = -1;
        for (const [sid, count] of Object.entries(votes)) {
            if (count > maxVotes) {
                maxVotes = count;
                winner = sid;
            }
        }
        const winningResult = conflict.artifacts[winner];
        return {
            resolved: true,
            winner,
            merged: winningResult?.artifacts,
            reason: `投票结果: ${winner} 获得 ${maxVotes}/${voters.length} 票`,
            strategy: 'vote',
            metadata: { votes, voters },
        };
    }
    /**
     * 策略 3: 合并策略（取并集）
     */
    merge(conflict) {
        const merged = {};
        for (const result of Object.values(conflict.artifacts)) {
            if (result.artifacts) {
                for (const [key, value] of Object.entries(result.artifacts)) {
                    // 如果键不冲突，直接合并
                    if (!(key in merged)) {
                        merged[key] = value;
                    }
                    else {
                        // 如果冲突，合并数组或取最新
                        if (Array.isArray(merged[key]) && Array.isArray(value)) {
                            merged[key] = [...new Set([...merged[key], ...value])];
                        }
                        else if (typeof merged[key] === 'string' && typeof value === 'string') {
                            merged[key] = `${merged[key]}\n\n---\n\n${value}`;
                        }
                        else {
                            // 复杂对象，取非空的
                            merged[key] = value || merged[key];
                        }
                    }
                }
            }
        }
        return {
            resolved: true,
            winner: 'merged',
            merged,
            reason: '所有冲突产物已合并（取并集）',
            strategy: 'merge',
        };
    }
    /**
     * 策略 4: 最新优先
     */
    latest(conflict) {
        // 按完成时间排序，取最新的
        let latest = conflict.surfaceIds[0];
        let latestTime = 0;
        for (const [sid, result] of Object.entries(conflict.artifacts)) {
            const completedAt = result.completedAt || 0;
            if (completedAt > latestTime) {
                latestTime = completedAt;
                latest = sid;
            }
        }
        const winningResult = conflict.artifacts[latest];
        return {
            resolved: true,
            winner: latest,
            merged: winningResult?.artifacts,
            reason: `最新优先: ${latest} 最后完成 (${new Date(latestTime).toISOString()})`,
            strategy: 'latest',
        };
    }
    /**
     * 策略 5: 人工介入（暂停等待）
     */
    async manual(conflict) {
        // 发布事件，等待人工介入
        console.log(`[ConflictResolver] 冲突 ${conflict.id} 等待人工介入`);
        // 在实际实现中，这里应该：
        // 1. 将冲突状态标记为 waiting_manual
        // 2. 通过 WebSocket/EventBus 通知 Dashboard
        // 3. 等待用户选择
        // 4. 继续执行
        // 暂时回退到仲裁策略
        return {
            resolved: false,
            reason: '人工介入模式待实现，已回退到仲裁策略',
            strategy: 'manual',
        };
    }
    /**
     * 获取所有未解决的冲突
     */
    getPendingConflicts() {
        return [...this.conflicts.values()].filter((c) => c.status === 'pending');
    }
    /**
     * 获取冲突详情
     */
    getConflict(id) {
        return this.conflicts.get(id);
    }
    /**
     * 列出所有冲突
     */
    listConflicts() {
        return [...this.conflicts.values()];
    }
    // ============================================================================
    // 辅助方法
    // ============================================================================
    /**
     * 构建仲裁提示词
     */
    buildArbitrationPrompt(conflict) {
        const artifactsSummary = Object.entries(conflict.artifacts)
            .map(([sid, result]) => {
            const artifactKeys = result.artifacts ? Object.keys(result.artifacts) : [];
            return `- ${sid}: 产物 keys=[${artifactKeys.join(', ')}], 状态=${result.status}`;
        })
            .join('\n');
        return `
你是团队仲裁 Agent，负责解决多 Agent 之间的冲突。

冲突描述：${conflict.description}

冲突面：${conflict.surfaceIds.join(', ')}

产物摘要：
${artifactsSummary}

请分析以下产物，决定最终方案：
${JSON.stringify(Object.fromEntries(Object.entries(conflict.artifacts).map(([k, v]) => [
            k,
            { status: v.status, artifacts: v.artifacts },
        ])), null, 2)}

请给出：
1. 哪个面的方案更优（或是否需要合并）
2. 最终产物（merged output）
3. 理由

请以 JSON 格式返回：
{
  "winner": "面ID 或 'merged'",
  "merged": { ...最终产物... },
  "reason": "解决理由"
}
`;
    }
    /**
     * 构建投票提示词
     */
    buildVotePrompt(conflict) {
        return `
请作为评审专家，对以下冲突进行投票。

冲突描述：${conflict.description}

候选方案：
${conflict.surfaceIds.map((sid) => `- ${sid}`).join('\n')}

请直接回复你认为最优的方案 ID（仅回复面 ID，不要额外解释）：
`;
    }
    /**
     * 从投票结果中提取胜出者
     */
    extractWinnerFromVote(result, candidates) {
        for (const candidate of candidates) {
            if (result.includes(candidate)) {
                return candidate;
            }
        }
        // 尝试匹配第一个出现的候选
        return candidates.find((c) => result.toLowerCase().includes(c.toLowerCase())) || null;
    }
    /**
     * 记录到知识中心
     */
    recordToKnowledgeCenter(conflict, resolution) {
        if (!this.knowledgeCenter)
            return;
        try {
            this.knowledgeCenter.addDocument({
                title: `冲突解决: ${conflict.description}`,
                content: `
冲突 ID: ${conflict.id}
冲突面: ${conflict.surfaceIds.join(', ')}
策略: ${resolution.strategy}
结果: ${resolution.resolved ? '已解决' : '未解决'}
胜出: ${resolution.winner || '无'}
理由: ${resolution.reason}
`,
                type: 'general',
                source: 'conflict-resolver',
                tags: ['conflict-resolution', resolution.strategy, ...conflict.surfaceIds],
                metadata: {
                    conflictId: conflict.id,
                    surfaceIds: conflict.surfaceIds,
                    strategy: resolution.strategy,
                    resolution,
                    timestamp: Date.now(),
                },
            });
        }
        catch (error) {
            console.warn('[ConflictResolver] 记录到知识中心失败:', error);
        }
    }
}
// ============================================================================
// 工厂函数
// ============================================================================
export function createConflictResolver(teamOrchestrator, knowledgeCenter, defaultStrategy) {
    return new ConflictResolver(teamOrchestrator, knowledgeCenter, defaultStrategy);
}
//# sourceMappingURL=ConflictResolver.js.map