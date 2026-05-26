#!/usr/bin/env node
/**
 * 调用 Hermes Agent 官方安装脚本（需网络）。
 * 不在此仓库内嵌安装逻辑，避免与上游分叉。
 */
import { spawn } from "node:child_process";
import process from "node:process";

const INSTALL_URL =
  process.env.HERMES_INSTALL_URL ??
  "https://hermes-agent.nousresearch.com/install.sh";

console.log("[@open-agent-teams/hermes-agent] 即将执行官方安装脚本：");
console.log(`  curl -fsSL ${INSTALL_URL} | bash`);
console.log("若需代理或镜像，请先设置环境变量 HERMES_INSTALL_URL。");
console.log(
  "已注入 Git 环境：无 SSH 密钥时 SSH 会快速失败，便于官方脚本回退到 HTTPS（避免卡在「Trying SSH clone…」）。\n",
);

/** 避免官方安装脚本优先走 git@github.com 时在无密钥终端挂死 */
const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND:
    process.env.GIT_SSH_COMMAND ??
    "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20",
};

const child = spawn("bash", ["-lc", `set -euo pipefail; curl -fsSL '${INSTALL_URL.replace(/'/g, "'\\''")}' | bash`], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
