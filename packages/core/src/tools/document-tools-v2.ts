/**
 * Document Tools V2 — 增强版文档沉淀工具
 *
 * 支持项目/任务/Agent关联、评论、版本追踪的完整文档管理能力。
 */

import { defineTool } from '@open-multi-agent/core';
import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DocumentManager,
  getGlobalDocumentManager,
} from '../knowledge/DocumentManager.js';

const DOC_DIR = process.env.DOC_OUTPUT_DIR || './docs';

let globalDocMgr: DocumentManager | null = null;
function getDocMgr(): DocumentManager {
  if (!globalDocMgr) {
    globalDocMgr = getGlobalDocumentManager();
  }
  return globalDocMgr;
}

export function createDocumentToolsV2() {
  return [
    // ── 1. 创建项目 ──
    defineTool({
      name: 'create_project',
      description: '创建一个新项目，用于归档文档和任务。返回项目ID。',
      inputSchema: z.object({
        name: z.string().describe('项目名称'),
        description: z.string().optional().describe('项目描述'),
      }),
      execute: async (input) => {
        try {
          const project = getDocMgr().createProject(input.name, input.description);
          return { data: `项目创建成功: ${project.name} (ID: ${project.id})`, isError: false, projectId: project.id };
        } catch (err) {
          return { data: `创建失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 2. 创建任务 ──
    defineTool({
      name: 'create_task',
      description: '在项目中创建任务，关联看板系统。',
      inputSchema: z.object({
        projectId: z.string().describe('项目ID'),
        title: z.string().describe('任务标题'),
        description: z.string().optional().describe('任务描述'),
        assignee: z.string().optional().describe('指派给哪个 Agent（如 dev-frontend）'),
      }),
      execute: async (input) => {
        try {
          const task = getDocMgr().createTask(input.projectId, input.title, input.description, input.assignee);
          return { data: `任务创建成功: ${task.title} (ID: ${task.id})`, isError: false, taskId: task.id };
        } catch (err) {
          return { data: `创建失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 3. 创建文档（增强版）──
    defineTool({
      name: 'create_document_v2',
      description:
        '创建可沉淀的文档，支持项目/任务/Agent关联。' +
        '类型可选: prd, tech_spec, meeting, report, task, general, review, code_review',
      inputSchema: z.object({
        title: z.string().describe('文档标题'),
        content: z.string().describe('文档内容（Markdown格式）'),
        type: z.enum(['prd', 'tech_spec', 'meeting', 'report', 'task', 'general', 'review', 'code_review']).describe('文档类型'),
        authorId: z.string().describe('作者 Agent ID（如 dev-frontend）'),
        authorName: z.string().describe('作者显示名称'),
        projectId: z.string().optional().describe('所属项目ID'),
        taskId: z.string().optional().describe('关联任务ID'),
        tags: z.array(z.string()).optional().describe('标签数组'),
        relatedAgentIds: z.array(z.string()).optional().describe('关联的Agent ID数组'),
        relatedTaskIds: z.array(z.string()).optional().describe('关联的任务ID数组'),
      }),
      execute: async (input) => {
        try {
          const doc = getDocMgr().createDocument({
            title: input.title,
            content: input.content,
            type: input.type,
            authorId: input.authorId,
            authorName: input.authorName,
            projectId: input.projectId,
            taskId: input.taskId,
            tags: input.tags || [],
            relatedDocIds: [],
            relatedTaskIds: input.relatedTaskIds || [],
            relatedAgentIds: input.relatedAgentIds || [],
            metadata: {},
          });

          // 同时写入文件系统（向后兼容）
          const filePath = input.projectId
            ? join(DOC_DIR, input.projectId, `${doc.type}_${doc.id}.md`)
            : join(DOC_DIR, `${doc.type}_${doc.id}.md`);
          const dir = dirname(filePath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const header = `---\ntitle: ${input.title}\nauthor: ${input.authorName}\ntype: ${input.type}\ndate: ${new Date().toISOString()}\n---\n\n`;
          writeFileSync(filePath, header + input.content, 'utf-8');

          return { data: `文档创建成功: ${doc.title} (ID: ${doc.id})`, isError: false, docId: doc.id };
        } catch (err) {
          return { data: `创建失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 4. 查询文档 ──
    defineTool({
      name: 'query_documents',
      description: '按项目/任务/类型/作者等多维度查询文档。',
      inputSchema: z.object({
        projectId: z.string().optional().describe('项目ID过滤'),
        taskId: z.string().optional().describe('任务ID过滤'),
        type: z.string().optional().describe('文档类型过滤'),
        authorId: z.string().optional().describe('作者Agent ID过滤'),
        sortBy: z.enum(['createdAt', 'updatedAt', 'title']).optional().describe('排序字段'),
        sortOrder: z.enum(['asc', 'desc']).optional().describe('排序方向'),
        limit: z.number().optional().describe('返回数量限制'),
      }),
      execute: async (input) => {
        try {
          const result = getDocMgr().queryDocuments({
            projectId: input.projectId,
            taskId: input.taskId,
            type: input.type,
            authorId: input.authorId,
            sortBy: input.sortBy || 'updatedAt',
            sortOrder: input.sortOrder || 'desc',
            limit: input.limit || 20,
          });
          const summary = result.documents.map(d =>
            `- [${d.type}] ${d.title} | ${d.authorName} | ${new Date(d.updatedAt).toLocaleDateString()} (${d.commentCount}评论)`
          ).join('\n');
          return { data: `找到 ${result.total} 篇文档:\n${summary}`, isError: false, total: result.total };
        } catch (err) {
          return { data: `查询失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 5. 搜索文档 ──
    defineTool({
      name: 'search_documents',
      description: '全文搜索文档内容。',
      inputSchema: z.object({
        keyword: z.string().describe('搜索关键词'),
        projectId: z.string().optional().describe('项目ID过滤'),
        type: z.string().optional().describe('文档类型过滤'),
      }),
      execute: async (input) => {
        try {
          const docs = getDocMgr().searchDocuments(input.keyword, {
            projectId: input.projectId,
            type: input.type,
          });
          const summary = docs.map(d => `- [${d.type}] ${d.title} | ${d.authorName}`).join('\n');
          return { data: `找到 ${docs.length} 篇相关文档:\n${summary}`, isError: false, count: docs.length };
        } catch (err) {
          return { data: `搜索失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 6. 查看某Agent的文档 ──
    defineTool({
      name: 'get_agent_documents',
      description: '查看某个Agent产出的所有文档（用于跨Agent协作）。',
      inputSchema: z.object({
        agentId: z.string().describe('Agent ID（如 dev-frontend）'),
        projectId: z.string().optional().describe('项目ID过滤'),
        type: z.string().optional().describe('文档类型过滤'),
      }),
      execute: async (input) => {
        try {
          const docs = getDocMgr().getDocumentsByAgent(input.agentId, {
            projectId: input.projectId,
            type: input.type,
          });
          const summary = docs.map(d =>
            `- [${d.type}] ${d.title} | ${new Date(d.updatedAt).toLocaleDateString()} | ${d.commentCount}评论`
          ).join('\n');
          return { data: `${input.agentId} 产出 ${docs.length} 篇文档:\n${summary}`, isError: false, count: docs.length };
        } catch (err) {
          return { data: `查询失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 7. 添加评论 ──
    defineTool({
      name: 'add_document_comment',
      description: '对文档添加评论（支持多Agent迭代）。',
      inputSchema: z.object({
        documentId: z.string().describe('文档ID'),
        authorId: z.string().describe('评论者 Agent ID'),
        authorName: z.string().describe('评论者名称'),
        content: z.string().describe('评论内容'),
        parentId: z.string().optional().describe('回复某条评论的ID'),
      }),
      execute: async (input) => {
        try {
          const comment = getDocMgr().addComment({
            documentId: input.documentId,
            authorId: input.authorId,
            authorName: input.authorName,
            content: input.content,
            parentId: input.parentId,
            resolved: false,
          });
          return { data: `评论已添加 (ID: ${comment.id})`, isError: false, commentId: comment.id };
        } catch (err) {
          return { data: `添加失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 8. 查看评论 ──
    defineTool({
      name: 'get_document_comments',
      description: '查看文档的所有评论。',
      inputSchema: z.object({
        documentId: z.string().describe('文档ID'),
      }),
      execute: async (input) => {
        try {
          const comments = getDocMgr().getComments(input.documentId);
          const summary = comments.map(c =>
            `${c.resolved ? '✅' : '💬'} ${c.authorName}: ${c.content.substring(0, 50)}${c.content.length > 50 ? '...' : ''}`
          ).join('\n');
          return { data: `共 ${comments.length} 条评论:\n${summary}`, isError: false, count: comments.length };
        } catch (err) {
          return { data: `查询失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 9. 获取文档版本历史 ──
    defineTool({
      name: 'get_document_versions',
      description: '查看文档的版本历史。',
      inputSchema: z.object({
        documentId: z.string().describe('文档ID'),
      }),
      execute: async (input) => {
        try {
          const versions = getDocMgr().getVersions(input.documentId);
          const summary = versions.map(v =>
            `- v${v.version}: ${v.title} | ${v.authorId} | ${new Date(v.createdAt).toLocaleDateString()}`
          ).join('\n');
          return { data: `共 ${versions.length} 个版本:\n${summary}`, isError: false, count: versions.length };
        } catch (err) {
          return { data: `查询失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),

    // ── 10. 获取文档统计 ──
    defineTool({
      name: 'get_document_stats',
      description: '获取文档系统的统计概览。',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const stats = getDocMgr().stats();
          const data = [
            `📊 文档统计概览`,
            ``,
            `总文档数: ${stats.totalDocuments}`,
            `项目数: ${stats.totalProjects}`,
            `任务数: ${stats.totalTasks}`,
            `评论数: ${stats.totalComments}`,
            ``,
            `按类型分布:`,
            ...Object.entries(stats.typeDistribution).map(([t, c]) => `  - ${t}: ${c}`),
            ``,
            `按作者分布:`,
            ...Object.entries(stats.authorDistribution).map(([a, c]) => `  - ${a}: ${c}`),
            ``,
            `最近更新:`,
            ...stats.recentDocuments.map(d => `  - [${d.type}] ${d.title} | ${d.authorName} | ${new Date(d.updatedAt).toLocaleDateString()}`),
          ].join('\n');
          return { data, isError: false };
        } catch (err) {
          return { data: `查询失败: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    }),
  ];
}

// 向后兼容：保留 V1 工具
export { createDocumentTools } from './document-tools.js';
