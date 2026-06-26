/**
 * Gateway 配置类型和加载
 */

import { join } from 'node:path';

export interface GatewayConfig {
  host: string;
  port: number;
  auditFile: string;
}

export function loadGatewayConfig(): GatewayConfig {
  return {
    host: process.env.GATEWAY_HOST || '127.0.0.1',
    port: parseInt(process.env.GATEWAY_PORT || '8400', 10),
    auditFile: process.env.AUDIT_FILE || join(
      process.env.HOME || '~',
      '.open-agent-teams/logs/audit.log',
    ),
  };
}
