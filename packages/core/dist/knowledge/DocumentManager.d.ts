/**
 * DocumentManager — 增强版文档管理中心
 *
 * 在 KnowledgeCenter 基础上扩展：
 * - 项目/类型/任务分类归档
 * - 时间排序
 * - 文档关联（任务看板、Agent 个体）
 * - 评论系统（多 Agent 迭代）
 * - 文档追踪（作者、版本历史）
 */
export interface Project {
    id: string;
    name: string;
    description: string;
    createdAt: number;
    updatedAt: number;
}
export interface Task {
    id: string;
    projectId: string;
    title: string;
    description: string;
    status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
    assignee: string;
    createdAt: number;
    updatedAt: number;
}
export interface DocumentV2 {
    id: string;
    title: string;
    content: string;
    type: 'prd' | 'tech_spec' | 'meeting' | 'report' | 'task' | 'general' | 'review' | 'code_review';
    projectId?: string;
    taskId?: string;
    authorId: string;
    authorName: string;
    version: number;
    parentId?: string;
    tags: string[];
    relatedDocIds: string[];
    relatedTaskIds: string[];
    relatedAgentIds: string[];
    commentCount: number;
    createdAt: number;
    updatedAt: number;
    metadata: Record<string, any>;
}
export interface DocumentComment {
    id: string;
    documentId: string;
    authorId: string;
    authorName: string;
    content: string;
    parentId?: string;
    resolved: boolean;
    createdAt: number;
}
export interface DocumentQuery {
    projectId?: string;
    taskId?: string;
    type?: string;
    authorId?: string;
    tag?: string;
    keyword?: string;
    sortBy: 'createdAt' | 'updatedAt' | 'title';
    sortOrder: 'asc' | 'desc';
    limit?: number;
    offset?: number;
}
export interface DocumentManagerConfig {
    dbPath?: string;
    maxResults?: number;
}
export declare class DocumentManager {
    private db;
    private maxResults;
    constructor(config?: DocumentManagerConfig);
    private initSchema;
    createProject(name: string, description?: string): Project;
    getProject(id: string): Project | null;
    listProjects(): Project[];
    createTask(projectId: string, title: string, description?: string, assignee?: string): Task;
    getTask(id: string): Task | null;
    listTasks(projectId?: string): Task[];
    listTasksByAssignee(assignee: string): Task[];
    updateTaskStatus(id: string, status: Task['status']): Task | null;
    createDocument(doc: Omit<DocumentV2, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'commentCount'>): DocumentV2;
    getDocument(id: string): DocumentV2 | null;
    updateDocument(id: string, updates: Partial<Omit<DocumentV2, 'id' | 'createdAt' | 'version' | 'commentCount'>>, authorId?: string, authorName?: string): DocumentV2 | null;
    deleteDocument(id: string): boolean;
    queryDocuments(query: DocumentQuery): {
        documents: DocumentV2[];
        total: number;
    };
    /**
     * 全文搜索
     */
    searchDocuments(keyword: string, options?: {
        projectId?: string;
        taskId?: string;
        type?: string;
        limit?: number;
    }): DocumentV2[];
    /**
     * 获取 Agent 最近活动（文档 + 评论 + 任务）
     */
    getAgentActivities(agentId: string, limit?: number): Array<{
        action: string;
        time: string;
        type: 'document' | 'comment' | 'task' | 'meeting' | 'code';
        details?: string;
    }>;
    private timeAgo;
    /**
     * 获取 Agent 产出的所有文档（供其他 Agent 查看）
     */
    getDocumentsByAgent(agentId: string, options?: {
        projectId?: string;
        type?: string;
    }): DocumentV2[];
    /**
     * 获取与某任务关联的所有文档
     */
    getDocumentsByTask(taskId: string): DocumentV2[];
    /**
     * 获取某项目的所有文档（按类型分组）
     */
    getDocumentsByProject(projectId: string): {
        type: string;
        documents: DocumentV2[];
    }[];
    addComment(comment: Omit<DocumentComment, 'id' | 'createdAt'>): DocumentComment;
    getComments(documentId: string): DocumentComment[];
    resolveComment(commentId: string): boolean;
    deleteComment(commentId: string): boolean;
    getVersions(documentId: string): Array<{
        id: string;
        version: number;
        title: string;
        authorId: string;
        createdAt: number;
    }>;
    stats(): {
        totalDocuments: number;
        totalProjects: number;
        totalTasks: number;
        totalComments: number;
        typeDistribution: Record<string, number>;
        authorDistribution: Record<string, number>;
        recentDocuments: DocumentV2[];
    };
    private rowToProject;
    private rowToTask;
    private rowToDocument;
    private rowToComment;
    close(): void;
}
export declare function getGlobalDocumentManager(config?: DocumentManagerConfig): DocumentManager;
export declare function resetGlobalDocumentManager(): void;
export declare function createDocumentManager(config?: DocumentManagerConfig): DocumentManager;
//# sourceMappingURL=DocumentManager.d.ts.map