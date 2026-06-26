/**
 * 全局 Team 注册表（已废弃）
 *
 * 原用于打破 createTeam() 与 customTools 之间的循环依赖。
 * 现在基于 Hermes Agent 架构，不再需要 Team 实例。
 * 保留空实现以兼容现有代码。
 */
const teamRegistry = new Map();
/** @deprecated 基于 Hermes 的架构不再使用 Team 注册 */
export function registerTeam(id, team) {
    teamRegistry.set(id, team);
}
/** @deprecated 基于 Hermes 的架构不再使用 Team 注册 */
export function getTeam(id) {
    return teamRegistry.get(id);
}
//# sourceMappingURL=team-registry.js.map