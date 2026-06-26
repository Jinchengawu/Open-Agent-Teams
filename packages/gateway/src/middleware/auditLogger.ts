/**
 * Audit Logger — 审计日志中间件
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  agent?: string;
  mode?: string;
  error?: string;
}

export function writeAuditLog(entry: AuditEntry, file: string): void {
  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[audit] 写入失败:', err);
  }
}
