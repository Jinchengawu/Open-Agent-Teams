/**
 * Document Tools — 产品文档沉淀工具
 *
 * 让 Agent 可以将讨论结果写入文件系统，形成可沉淀的文档。
 */

import { defineTool } from '@open-multi-agent/core';
import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DOC_DIR = process.env.DOC_OUTPUT_DIR || './docs';

export function createDocumentTools() {
  return [
    defineTool({
      name: 'create_document',
      description:
        '将内容写入文件系统，生成可沉淀的产品文档。支持 Markdown 格式。' +
        '路径使用相对路径（如 "prd/login-system.md"），会自动创建目录。',
      inputSchema: z.object({
        path: z.string().describe('文档路径（如 "prd/login-system.md"）'),
        content: z.string().describe('文档内容（Markdown 格式）'),
        title: z.string().optional().describe('文档标题'),
      }),
      execute: async (input, _context) => {
        try {
          const fullPath = join(DOC_DIR, input.path);
          const dir = dirname(fullPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }

          const header = input.title ? `---\ntitle: ${input.title}\ndate: ${new Date().toISOString()}\n---\n\n` : '';
          writeFileSync(fullPath, header + input.content, 'utf-8');

          return {
            data: `文档已保存: ${fullPath} (${input.content.length} 字符)`,
            isError: false,
          };
        } catch (err) {
          return {
            data: `保存文档失败: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      },
    }),

    defineTool({
      name: 'append_document',
      description: '在现有文档末尾追加内容。用于分章节编写长文档。',
      inputSchema: z.object({
        path: z.string().describe('文档路径'),
        content: z.string().describe('追加内容'),
      }),
      execute: async (input, _context) => {
        try {
          const fullPath = join(DOC_DIR, input.path);
          const { appendFileSync } = await import('node:fs');
          appendFileSync(fullPath, '\n\n' + input.content, 'utf-8');
          return {
            data: `已追加到: ${fullPath}`,
            isError: false,
          };
        } catch (err) {
          return {
            data: `追加失败: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      },
    }),
  ];
}
