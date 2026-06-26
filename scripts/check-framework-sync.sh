#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(/usr/bin/dirname "$0")/.." && /bin/pwd)"
cd "$ROOT"

required_files=(
  "packages/dashboard/src/app/kanban/page.tsx"
  "packages/dashboard/src/app/pipeline/page.tsx"
  "packages/dashboard/src/app/knowledge/page.tsx"
  "packages/dashboard/src/app/api/kanban/route.ts"
  "packages/dashboard/src/app/api/knowledge/route.ts"
  "packages/dashboard/src/app/api/pipelines/route.ts"
  "packages/dashboard/src/app/api/pipeline-instances/route.ts"
  "packages/dashboard/src/app/api/milestones/route.ts"
  "packages/dashboard/src/app/api/readiness/route.ts"
  "packages/dashboard/src/app/api/snapshots/route.ts"
  "packages/core/src/knowledge/DocumentManager.ts"
  "packages/core/src/tools/document-tools-v2.ts"
  "packages/core/src/pipeline/Orchestrator.ts"
  "packages/core/src/session/WorkflowStateManager.ts"
  "packages/gateway/src/api-gateway.ts"
  "docs/open-agent-teams/framework-sync-policy.md"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "missing required framework file: $file" >&2
    exit 1
  fi
done

if command -v rg >/dev/null 2>&1; then
  if rg -q "@dev-agent/core|@dev-agent/" packages/core/src packages/gateway/src packages/dashboard/src; then
    echo "found downstream package imports in Open-Agent-Teams" >&2
    exit 1
  fi
elif grep -R -E "@dev-agent/core|@dev-agent/" packages/core/src packages/gateway/src packages/dashboard/src >/dev/null; then
  echo "found downstream package imports in Open-Agent-Teams" >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  if ! rg -q "nav\\.kanban" packages/dashboard/src/lib/constants.ts packages/dashboard/src/lib/i18n.tsx; then
    echo "console navigation does not expose kanban" >&2
    exit 1
  fi
elif ! grep -E "nav\\.kanban" packages/dashboard/src/lib/constants.ts packages/dashboard/src/lib/i18n.tsx >/dev/null; then
  echo "console navigation does not expose kanban" >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  if ! rg -q "pipeline-instances" packages/gateway/src/api-gateway.ts packages/dashboard/src/app/api/pipeline-instances; then
    echo "pipeline instance API is not exposed" >&2
    exit 1
  fi
elif ! grep -R "pipeline-instances" packages/gateway/src/api-gateway.ts packages/dashboard/src/app/api/pipeline-instances >/dev/null; then
  echo "pipeline instance API is not exposed" >&2
  exit 1
fi

echo "Open-Agent-Teams framework sync baseline OK"
