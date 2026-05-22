# @ai-local-os/hermes-agent

**Hermes Agent**（Nous Research）的**官方主分发**为安装脚本 + Python 运行时，**不是**像 OpenClaw 一样以单一 `npm install hermes-agent` 作为核心交付。本包在 **Node/pnpm 工作区**中的职责是：

- 用 **Node 脚本** 调用官方安装入口（`curl … | bash`），便于与 `@ai-local-os/openclaw` 同一套 `pnpm` 命令管理；
- 提供 `doctor` 检查本机是否已有 `hermes` 命令。

## 使用

```bash
pnpm install
pnpm hermes:bootstrap
pnpm hermes:doctor
```

## 官方参考

- 文档：<https://hermes-agent.nousresearch.com/>
- 安装（官方）：`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
- 源码：<https://github.com/NousResearch/hermes-agent>

## 与 Open-Agent-Teams 方案 A 的关系

多实例 Hermes 的端口与注册表仍见仓库根 [docs/ai-local-os/hermes-instances.template.yaml](../../docs/ai-local-os/hermes-instances.template.yaml)；本包不负责替代 Hermes 自带配置目录（通常为 `~/.hermes`）。

## 排障（常见）

### 1. 卡在「Trying SSH clone…」后无进展

官方脚本会先尝试 SSH 拉取 `git@github.com:...`；本机**未配置 GitHub SSH 密钥**时，默认 `ssh` 可能长时间等待输入，表现为挂死。

**处理**：自本仓库更新后，`pnpm hermes:bootstrap` 已为子进程设置 `GIT_SSH_COMMAND`（`BatchMode=yes` + 超时），SSH 会快速失败并走 HTTPS。若你仍自定义了 `GIT_SSH_COMMAND`，请先 `unset GIT_SSH_COMMAND` 再执行。

**半截安装**：若上次 `^C` 中断，可清理后重跑（会重新 clone，注意备份 `~/.hermes` 内自有数据）：

```bash
rm -rf ~/.hermes/hermes-agent
pnpm hermes:bootstrap
```

### 2. Homebrew：`pkgconf` 与 `pkg-config`  symlink 冲突

日志类似 `Could not symlink bin/pkg-config`。与 Hermes 无直接关系，但会污染终端输出。任选其一：

```bash
brew unlink pkg-config && brew link pkgconf
# 或按 brew 提示：brew link --overwrite pkgconf
```

### 3. 安装成功后 `hermes` 仍不在 PATH

官方脚本通常把二进制放在 `~/.local/bin` 或安装日志指定目录。请把该目录加入 shell 的 `PATH` 后重开终端，再执行 `pnpm hermes:doctor`。
