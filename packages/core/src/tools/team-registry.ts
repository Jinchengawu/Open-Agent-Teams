/**
 * 全局 Team 注册表
 *
 * 用于打破 createTeam() 与 customTools 之间的循环依赖：
 * - createTeam() 需要 AgentConfig（含 customTools）
 * - customTools 的 execute 需要 Team 实例
 *
 * 流程：先创建 tool（通过 teamId 引用） → createTeam() → registerTeam()
 * tool 的 execute 在 agent 运行时才调用，此时 team 已注册。
 */

import type { Team } from '@open-multi-agent/core';

const teamRegistry = new Map<string, Team>();

export function registerTeam(id: string, team: Team): void {
  teamRegistry.set(id, team);
}

export function getTeam(id: string): Team | undefined {
  return teamRegistry.get(id);
}
