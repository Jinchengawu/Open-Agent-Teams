#!/bin/bash
# e2e-delivery-gate.sh — closed-loop framework verification for Open-Agent-Teams.
#
# This gate is intentionally framework-level: it verifies the shared Team
# Coordination Layer surfaces without requiring every Hermes Agent to be online.
# When local services are running, it also probes Gateway/Dashboard endpoints.

set -euo pipefail

ROOT="$(cd "$(/usr/bin/dirname "$0")/.." && /bin/pwd)"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8400}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
REPORT_DIR="$ROOT/scripts/test-reports"
TIMESTAMP="$(/bin/date +%Y%m%d_%H%M%S)"
REPORT_FILE="$REPORT_DIR/e2e-delivery-gate-$TIMESTAMP.md"

PASS=0
FAIL=0
WARN=0

/bin/mkdir -p "$REPORT_DIR"

write_report_header() {
  {
    printf '# E2E Delivery Gate\n\n'
    printf -- '- Time: %s\n' "$(/bin/date)"
    printf -- '- Root: %s\n' "$ROOT"
    printf -- '- Gateway: %s\n' "$GATEWAY_URL"
    printf -- '- Dashboard: %s\n\n' "$DASHBOARD_URL"
    printf '| Check | Status | Details |\n'
    printf '| --- | --- | --- |\n'
  } > "$REPORT_FILE"
}

record() {
  local name="$1"
  local check_status="$2"
  local details="$3"

  case "$check_status" in
    PASS) PASS=$((PASS + 1)); echo "  PASS $name - $details" ;;
    FAIL) FAIL=$((FAIL + 1)); echo "  FAIL $name - $details" ;;
    WARN) WARN=$((WARN + 1)); echo "  WARN $name - $details" ;;
    *) echo "unknown status: $check_status" >&2; exit 2 ;;
  esac

  printf '| %s | %s | %s |\n' "$name" "$check_status" "$(echo "$details" | /usr/bin/sed 's/|/\\|/g')" >> "$REPORT_FILE"
}

run_cmd() {
  local name="$1"
  shift
  local output

  set +e
  output="$("$@" 2>&1)"
  local code=$?
  set -e

  if [ "$code" -eq 0 ]; then
    record "$name" PASS "command succeeded"
  else
    record "$name" FAIL "exit $code: $(echo "$output" | /usr/bin/tail -n 3 | /usr/bin/tr '\n' ' ' | /usr/bin/sed 's/|/\\|/g')"
  fi
}

append_summary() {
  {
    printf '\n## Summary\n\n'
    printf -- '- PASS: %s\n' "$PASS"
    printf -- '- FAIL: %s\n' "$FAIL"
    printf -- '- WARN: %s\n\n' "$WARN"
  } >> "$REPORT_FILE"
}

probe_json() {
  local name="$1"
  local url="$2"
  local required_key="$3"
  local tmp
  tmp="$(/usr/bin/mktemp)"

  if curl -fsS --max-time 5 "$url" > "$tmp" 2>/dev/null; then
    if python3 - "$tmp" "$required_key" <<'PY'
import json
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
raise SystemExit(0 if key in data else 1)
PY
    then
      record "$name" PASS "$url exposes $required_key"
    else
      record "$name" FAIL "$url missing $required_key"
    fi
  else
    record "$name" WARN "$url unavailable; skipped live probe"
  fi

  /bin/rm -f "$tmp"
}

write_report_header

echo "E2E Delivery Gate"
echo "================="

cd "$ROOT"

run_cmd "startup scripts syntax" /bin/bash -n scripts/start-gateway.sh scripts/run-tests.sh scripts/e2e-delivery-gate.sh
run_cmd "core typecheck" pnpm --filter @open-agent-teams/core run check
run_cmd "gateway build" pnpm --filter @open-agent-teams/gateway run build
run_cmd "dashboard typecheck" pnpm --filter @open-agent-teams/dashboard exec tsc --noEmit

for file in \
  "packages/core/src/team/TeamOrchestrator.ts" \
  "packages/core/src/pipeline/Orchestrator.ts" \
  "packages/core/src/knowledge/KnowledgeCenter.ts" \
  "packages/core/src/tools/kanban-tools.ts" \
  "packages/core/src/event/EventBus.ts" \
  "packages/dashboard/src/app/api/team-loop/status/route.ts" \
  "packages/dashboard/src/app/api/team-architect/[...path]/route.ts" \
  "packages/dashboard/src/app/team-architect/page.tsx" \
  "packages/dashboard/src/app/api/delivery-gate/latest/route.ts" \
  "packages/dashboard/src/app/api/delivery-gate/history/route.ts" \
  "packages/dashboard/src/lib/delivery-gate-reports.ts"
do
  if [ -f "$file" ]; then
    record "required file: $file" PASS "present"
  else
    record "required file: $file" FAIL "missing"
  fi
done

if rg -q "toProviderSafeMessages" packages/core/src/agent-factory.ts packages/core/src/intent/IntentRouter.ts packages/gateway/src/api-gateway.ts; then
  record "provider-safe message normalization" PASS "Core AgentApp, IntentRouter and Gateway contain provider-safe folding"
else
  record "provider-safe message normalization" FAIL "missing provider-safe folding helper"
fi

if rg -q "dashboard-team-loop-card" packages/dashboard/src/app/page.tsx && rg -q "deliveryGate" packages/dashboard/src/app/api/team-loop/status/route.ts; then
  record "dashboard team-loop observability" PASS "Dashboard surfaces Team Loop and delivery gate readiness"
else
  record "dashboard team-loop observability" FAIL "Team Loop readiness surface not wired"
fi

if rg -q "pipeline-builder-drafts" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "pipeline-builder-save-draft" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "pipeline-builder-load-draft" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "pipeline-builder-delete-draft" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "pipeline-builder-version" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "pipeline-copy-builder-" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "pipelineVersion" packages/dashboard/src/app/pipeline/page.tsx \
  && rg -q "BUILDER_DRAFTS_STORAGE_KEY" packages/dashboard/src/app/pipeline/page.tsx; then
  record "dashboard pipeline builder drafts" PASS "Pipeline Builder exposes local draft persistence, versioning and template copy controls"
else
  record "dashboard pipeline builder drafts" FAIL "Pipeline Builder draft persistence controls are missing"
fi

dashboard_ux_output="$(python3 <<'PY' 2>&1
from pathlib import Path

files = {
    "health": Path("packages/dashboard/src/hooks/useAgentHealth.ts").read_text(encoding="utf-8"),
    "nav": Path("packages/dashboard/src/components/NavBar.tsx").read_text(encoding="utf-8"),
    "constants": Path("packages/dashboard/src/lib/constants.ts").read_text(encoding="utf-8"),
    "i18n": Path("packages/dashboard/src/lib/i18n.tsx").read_text(encoding="utf-8"),
    "home": Path("packages/dashboard/src/app/page.tsx").read_text(encoding="utf-8"),
    "meeting": Path("packages/dashboard/src/app/chat/MeetingView.tsx").read_text(encoding="utf-8"),
    "teamArchitectPage": Path("packages/dashboard/src/app/team-architect/page.tsx").read_text(encoding="utf-8"),
    "teamArchitectApi": Path("packages/dashboard/src/app/api/team-architect/[...path]/route.ts").read_text(encoding="utf-8"),
    "teamArchitectLib": Path("packages/dashboard/src/lib/team-architect.ts").read_text(encoding="utf-8"),
    "agents": Path("packages/dashboard/src/lib/agents.ts").read_text(encoding="utf-8"),
    "profile": Path("packages/core/src/team-profile/open-framework-profile.ts").read_text(encoding="utf-8"),
    "healthRoute": Path("packages/dashboard/src/app/api/health/route.ts").read_text(encoding="utf-8"),
}

requirements = [
    ("health status model", "AgentHealthStatus" in files["health"] and "HEALTH_CACHE_KEY" in files["health"] and "'stale'" in files["health"]),
    ("trusted cached health fallback", "setCachedHealth(data)" in files["health"] and "localStorage.setItem(HEALTH_CACHE_KEY" in files["health"]),
    ("navbar checking state", "health.checking" in files["nav"] and "health.lastKnown" in files["nav"] and "stats.statusReason" in files["nav"]),
    ("no hardcoded No Agents banner", "No Agents" not in files["nav"]),
    ("delivery-first nav order", files["constants"].find("href: '/chat'") < files["constants"].find("href: '/kanban'") and files["constants"].find("href: '/kanban'") < files["constants"].find("href: '/pipeline'") and files["constants"].find("href: '/sessions'") < files["constants"].find("href: '/agents'")),
    ("health i18n copy", "health.checking" in files["i18n"] and "health.lastKnown" in files["i18n"] and "未检测到在线 Agent" in files["i18n"] and "No agents online" in files["i18n"]),
    ("dashboard no transient error wall", "ErrorState" not in files["home"] and "stats.statusReason" in files["home"] and "stats.status === 'stale'" in files["home"]),
    ("dashboard delivery cockpit first screen", "dashboard-delivery-cockpit" in files["home"] and "dashboard-current-project-summary" in files["home"] and "dashboard-recent-evidence" in files["home"] and "dashboard-loop-timeline" in files["home"] and "dashboard-next-actions" in files["home"]),
    ("dashboard no marketing hero primary surface", "t('hero.title')" not in files["home"] and "t('hero.subtitle')" not in files["home"]),
    ("meeting collaboration process panel", "meeting-collaboration-panel" in files["meeting"] and "Meeting Coordination" in files["meeting"] and "需求澄清" in files["meeting"] and "多 Agent 分析" in files["meeting"]),
    ("meeting artifact links", "meeting-artifact-links" in files["meeting"] and "/knowledge" in files["meeting"] and "/kanban?source=coordination" in files["meeting"] and "/pipeline" in files["meeting"]),
    ("team architect nav and page", "href: '/team-architect'" in files["constants"] and "nav.teamArchitect" in files["i18n"] and "/team-architect" in files["home"] and "team-architect-page" in files["teamArchitectPage"]),
    ("team architect initialization api", "generate-blueprint" in files["teamArchitectApi"] and "generate-agents" in files["teamArchitectApi"] and "generate-workflow" in files["teamArchitectApi"] and "applyTeamArchitectSession" in files["teamArchitectApi"]),
    ("team architect deterministic assets", "generateBlueprint" in files["teamArchitectLib"] and "generateAgentSpecs" in files["teamArchitectLib"] and "validateGeneratedAssets" in files["teamArchitectLib"] and ".open-agent-teams/data" in files["teamArchitectLib"]),
    ("system team architect registered", "system-team-architect" in files["agents"] and "system-team-architect" in files["profile"] and "withSystemAgents" in files["healthRoute"]),
]

failed = [name for name, ok in requirements if not ok]
if failed:
    raise SystemExit(f"Dashboard UX requirements missing: {', '.join(failed)}")
print(f"requirements={len(requirements)} healthStatus=1 deliveryNav=1")
PY
)"
dashboard_ux_code=$?
if [ "$dashboard_ux_code" -eq 0 ]; then
  record "dashboard health and navigation UX" PASS "$(echo "$dashboard_ux_output" | /usr/bin/tail -n 1)"
else
  record "dashboard health and navigation UX" FAIL "exit $dashboard_ux_code: $(echo "$dashboard_ux_output" | /usr/bin/tail -n 3 | /usr/bin/tr '\n' ' ')"
fi

probe_json "gateway health" "$GATEWAY_URL/health" "status"
probe_json "dashboard health api" "$DASHBOARD_URL/api/health" "agents"
probe_json "dashboard team-loop api" "$DASHBOARD_URL/api/team-loop/status" "checks"

append_summary

echo ""
echo "Report: $REPORT_FILE"
echo "Summary: PASS=$PASS FAIL=$FAIL WARN=$WARN"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
