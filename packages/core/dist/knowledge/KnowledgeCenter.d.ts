/**
 * KnowledgeCenter — 跨 Agent 共享知识中心
 *
 * 提供文档存储、全文检索、语义搜索能力。
 * 所有 Agent 共享同一知识库，Pipeline 产物自动沉淀。
 *
 * 存储后端：SQLite + FTS5（全文检索）
 * 语义搜索：基于关键词频率的简单向量相似度（不依赖外部 embedding 服务）
 */
export interface KnowledgeDocument {
    id: string;
    title: string;
    content: string;
    type: 'prd' | 'code' | 'meeting' | 'report' | 'task' | 'general';
    source: string;
    tags: string[];
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, any>;
}
export interface KnowledgeQuery {
    q: string;
    type?: string;
    tags?: string[];
    source?: string;
    limit?: number;
    semantic?: boolean;
}
export interface KnowledgeResult {
    document: KnowledgeDocument;
    score: number;
    matchType: 'fts' | 'semantic' | 'tag' | 'source';
}
export interface KnowledgeCenterConfig {
    dbPath?: string;
    maxResults?: number;
    enableFTS?: boolean;
}
export declare class KnowledgeCenter {
    private db;
    private maxResults;
    constructor(config?: KnowledgeCenterConfig);
    private initSchema;
    /**
     * 添加文档到知识中心
     */
    addDocument(doc: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt'> & {
        id?: string;
    }): KnowledgeDocument;
    /**
     * 更新文档
     */
    updateDocument(id: string, updates: Partial<Omit<KnowledgeDocument, 'id' | 'createdAt'>>): KnowledgeDocument | null;
    /**
     * 获取单个文档
     */
    getDocument(id: string): KnowledgeDocument | null;
    /**
     * 删除文档
     */
    deleteDocument(id: string): boolean;
    /**
     * 列出所有文档（支持分页）
     */
    listDocuments(options?: {
        type?: string;
        source?: string;
        limit?: number;
        offset?: number;
    }): KnowledgeDocument[];
    /**
     * 综合搜索：FTS + 语义 + 标签
     */
    search(query: KnowledgeQuery): KnowledgeResult[];
    /**
     * 自然语言查询（带上下文摘要）
     */
    query(question: string, options?: {
        limit?: number;
    }): Promise<{
        answer: string;
        sources: KnowledgeResult[];
    }>;
    /**
     * FTS5 全文搜索
     */
    private searchFTS;
    /**
     * 语义搜索：基于关键词频率的简单向量相似度
     */
    private searchSemantic;
    /**
     * 标签搜索
     */
    private searchByTags;
    /**
     * 来源搜索
     */
    private searchBySource;
    /**
     * 提取关键词（简单的分词）
     */
    private extractKeywords;
    /**
     * 余弦相似度计算
     */
    private cosineSimilarity;
    /**
     * 归一化 FTS 分数到 0-1
     */
    private normalizeScore;
    /**
     * 数据库行转文档对象
     */
    private rowToDocument;
    /**
     * 统计信息
     */
    stats(): {
        total: number;
        types: Record<string, number>;
        sources: Record<string, number>;
    };
    /**
     * 关闭数据库连接
     */
    close(): void;
}
export declare function getGlobalKnowledgeCenter(config?: KnowledgeCenterConfig): KnowledgeCenter;
export declare function resetGlobalKnowledgeCenter(): void;
export declare function createKnowledgeCenter(config?: KnowledgeCenterConfig): KnowledgeCenter;
//# sourceMappingURL=KnowledgeCenter.d.ts.map