/**
 * 厚胶水（ThickGlue）
 *
 * 多 Agent 协作会议模式（评论聚合/共识检测/决议生成/版本快照）
 */

import type {
  MeetingRequest,
  MeetingResponse,
  MeetingComment,
  ProfileManager,
  ThinGlue,
} from './types.js';

/** 会议快照 */
export interface MeetingSnapshot {
  version: number;
  goal: string;
  comments: MeetingComment[];
  resolution: string;
  timestamp: string;
}

export interface ThickGlueConfig {
  /** 最大轮数，默认 3 */
  maxRounds?: number;
  /** 共识阈值（0-1），默认 0.7 */
  consensusThreshold?: number;
  /** 是否启用版本快照，默认 true */
  enableSnapshots?: boolean;
}

export class ThickGlue {
  private profileManager: ProfileManager;
  private thinGlue: ThinGlue;
  private config: Required<ThickGlueConfig>;
  private snapshots: MeetingSnapshot[] = [];

  constructor(profileManager: ProfileManager, thinGlue: ThinGlue, config?: ThickGlueConfig) {
    this.profileManager = profileManager;
    this.thinGlue = thinGlue;
    this.config = {
      maxRounds: config?.maxRounds ?? 3,
      consensusThreshold: config?.consensusThreshold ?? 0.7,
      enableSnapshots: config?.enableSnapshots ?? true,
    };
  }

  /** 运行会议 */
  async runMeeting(request: MeetingRequest): Promise<MeetingResponse> {
    const startTime = Date.now();
    const goal = request.goal;
    const maxRounds = request.maxRounds ?? this.config.maxRounds;

    // 获取参与会议的 Agent
    const agentIds = request.agents ?? this.profileManager.getRunningProfiles().map(p => p.agentId);

    if (agentIds.length === 0) {
      throw new Error('No agents available for meeting');
    }

    const allComments: MeetingComment[] = [];
    let totalTokens = 0;

    // 多轮讨论
    for (let round = 1; round <= maxRounds; round++) {
      const roundComments = await this.runRound(goal, agentIds, round, allComments);
      allComments.push(...roundComments);
      totalTokens += roundComments.reduce((sum, c) => sum + c.tokens, 0);

      // 检测共识
      if (this.detectConsensus(roundComments)) {
        break;
      }
    }

    // 生成决议
    const resolution = this.generateResolution(goal, allComments);

    // 保存快照
    if (this.config.enableSnapshots) {
      this.saveSnapshot(goal, allComments, resolution);
    }

    return {
      goal,
      comments: allComments,
      resolution,
      totalTokens,
      duration: Date.now() - startTime,
    };
  }

  /** 运行一轮讨论 */
  private async runRound(
    goal: string,
    agentIds: string[],
    round: number,
    previousComments: MeetingComment[]
  ): Promise<MeetingComment[]> {
    const comments: MeetingComment[] = [];

    // 构建上下文
    const context = this.buildContext(goal, previousComments, round);

    // 顺序执行每个 Agent 的发言
    for (const agentId of agentIds) {
      try {
        const response = await this.thinGlue.executeTask({
          agentId,
          task: `请针对以下议题发表你的专业观点（第 ${round} 轮）：\n\n${goal}`,
          context,
        });

        comments.push({
          agentId,
          round,
          content: response.output,
          tokens: response.tokens,
        });
      } catch (error) {
        // Agent 发言失败，跳过
        console.error(`[ThickGlue] Agent ${agentId} failed in round ${round}:`, error);
      }
    }

    return comments;
  }

  /** 构建讨论上下文 */
  private buildContext(goal: string, previousComments: MeetingComment[], currentRound: number): string {
    if (previousComments.length === 0) {
      return `## 议题\n${goal}\n\n这是第 ${currentRound} 轮讨论，请发表你的初始观点。`;
    }

    const commentsByRound = new Map<number, MeetingComment[]>();
    for (const comment of previousComments) {
      const roundComments = commentsByRound.get(comment.round) ?? [];
      roundComments.push(comment);
      commentsByRound.set(comment.round, roundComments);
    }

    let context = `## 议题\n${goal}\n\n## 之前的讨论\n`;
    for (const [round, comments] of commentsByRound) {
      context += `\n### 第 ${round} 轮\n`;
      for (const comment of comments) {
        context += `- **${comment.agentId}**: ${comment.content}\n`;
      }
    }

    context += `\n这是第 ${currentRound} 轮讨论，请基于之前的观点继续发表意见。`;
    return context;
  }

  /** 检测共识 */
  private detectConsensus(comments: MeetingComment[]): boolean {
    if (comments.length < 2) return false;

    // 简单的共识检测：检查是否有关键词重叠
    const keywords = comments.map(c => this.extractKeywords(c.content));
    const allKeywords = keywords.flat();
    const uniqueKeywords = new Set(allKeywords);

    // 计算关键词重叠率
    const overlapRate = allKeywords.length > 0
      ? 1 - (uniqueKeywords.size / allKeywords.length)
      : 0;

    return overlapRate >= this.config.consensusThreshold;
  }

  /** 提取关键词 */
  private extractKeywords(text: string): string[] {
    // 简单的关键词提取（实际应用中可以使用 NLP 库）
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    // 去除停用词
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should']);
    return words.filter(w => !stopWords.has(w));
  }

  /** 生成决议 */
  private generateResolution(goal: string, comments: MeetingComment[]): string {
    if (comments.length === 0) {
      return '无讨论内容';
    }

    // 汇总所有观点
    const agentSummaries = new Map<string, string[]>();
    for (const comment of comments) {
      const summaries = agentSummaries.get(comment.agentId) ?? [];
      summaries.push(comment.content);
      agentSummaries.set(comment.agentId, summaries);
    }

    let resolution = `## 会议决议\n\n**议题**: ${goal}\n\n### 各方观点汇总\n\n`;
    for (const [agentId, contents] of agentSummaries) {
      resolution += `**${agentId}**:\n${contents.join('\n\n')}\n\n`;
    }

    resolution += `### 共识点\n\n基于多轮讨论，团队达成以下共识：\n`;
    resolution += `- 需要进一步明确具体实施细节\n`;
    resolution += `- 建议在下一阶段深入讨论技术方案\n`;

    return resolution;
  }

  /** 保存会议快照 */
  private saveSnapshot(goal: string, comments: MeetingComment[], resolution: string): void {
    const snapshot: MeetingSnapshot = {
      version: this.snapshots.length + 1,
      goal,
      comments,
      resolution,
      timestamp: new Date().toISOString(),
    };
    this.snapshots.push(snapshot);
  }

  /** 获取会议快照 */
  getSnapshots(): MeetingSnapshot[] {
    return [...this.snapshots];
  }

  /** 获取最新快照 */
  getLatestSnapshot(): MeetingSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /** 基于文档的会议 */
  async runDocumentMeeting(request: {
    documentTitle: string;
    documentContent: string;
    agenda: string;
    agents?: string[];
    maxRounds?: number;
  }): Promise<MeetingResponse> {
    const context = `## 讨论文档\n\n**标题**: ${request.documentTitle}\n\n**内容**:\n${request.documentContent}\n\n**议题**: ${request.agenda}\n\n请针对以上文档和议题发表你的专业观点。`;

    return this.runMeeting({
      goal: request.agenda,
      agents: request.agents,
      maxRounds: request.maxRounds,
    });
  }

  /** 清空快照 */
  clearSnapshots(): void {
    this.snapshots = [];
  }
}
