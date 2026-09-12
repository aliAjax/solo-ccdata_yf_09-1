#!/usr/bin/env bash
# =============================================================================
# e2e.sh — 统一入口：构建 + 启动预览 + 跑完全部浏览器回归（桌面 + 手机 + 对比）
#
# 用法：
#   npm run e2e               # 或 bash scripts/e2e.sh         全部
#   bash scripts/e2e.sh desktop   仅桌面主流程
#   bash scripts/e2e.sh mobile    仅手机主流程（390px）
#   bash scripts/e2e.sh compare   双问题对比（桌面 + 手机）
#   bash scripts/e2e.sh build     只构建
#
# 可选环境变量：
#   E2E_PORT=4200      覆盖预览端口（默认 4173）
#   E2E_SKIP_SYSDEPS=1 跳过浏览器系统库的本地解包（宿主已自备库时）
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-all}"
PORT="${E2E_PORT:-4173}"
BASE="http://localhost:${PORT}/"
export E2E_BASE="$BASE"

# 准备浏览器/系统库/字体（幂等，产物全在 .e2e-tools/，不需要 root）
# shellcheck source=scripts/e2e-env.sh
source "$ROOT/scripts/e2e-env.sh"

log() { printf '\033[2m[e2e]\033[0m %s\n' "$*"; }
PREVIEW_PID=""
cleanup() { [ -n "$PREVIEW_PID" ] && kill "$PREVIEW_PID" 2>/dev/null || true; }
trap cleanup EXIT

start_preview() {
  if curl -fsS -o /dev/null --max-time 2 "$BASE"; then
    log "端口 $PORT 上已有服务，直接复用。"
    return
  fi
  log "启动 vite preview（端口 $PORT，日志 .e2e-tools/preview.log）…"
  # 直接用本地 vite 可执行文件，使 $! 就是服务进程（npx 会再派生一层子进程，
  # 只杀 npx 会导致预览服务泄漏）。
  nohup "$ROOT/node_modules/.bin/vite" preview --port "$PORT" --strictPort \
    > "$E2E_TOOLS/preview.log" 2>&1 &
  PREVIEW_PID=$!
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null --max-time 2 "$BASE" && return 0
    sleep 0.3
  done
  echo "预览服务器启动失败，日志如下：" >&2
  cat "$E2E_TOOLS/preview.log" >&2 || true
  exit 1
}

run_case() { # $1 = 显示名，其余为 node 命令
  local name="$1"; shift
  echo
  echo "── $name ────────────────────────────────────────────────────"
  if "$@"; then
    echo "✔ $name 通过"
  else
    echo "✘ $name 失败（退出码 $?）" >&2
    FAIL=1
  fi
}

FAIL=0

log "构建生产产物…"
npm run build

case "$MODE" in
  build)
    log "仅构建，结束。"
    exit 0
    ;;
  desktop|mobile|compare|all) ;;
  *)
    echo "未知模式：$MODE（可选 all|desktop|mobile|compare|build）" >&2
    exit 2
    ;;
esac

start_preview
log "回归目标地址：$BASE"

case "$MODE" in
  desktop) run_case "桌面主流程（1440px）" node e2e.mjs ;;
  mobile)  run_case "手机主流程（390px）" node e2e-mobile.mjs ;;
  compare)
    run_case "桌面对比流程（1440px）" node e2e-compare.mjs
    run_case "手机对比流程（390px）"  env MOBILE=1 node e2e-compare.mjs
    ;;
  all)
    run_case "桌面主流程（1440px）" node e2e.mjs
    run_case "手机主流程（390px）"  node e2e-mobile.mjs
    run_case "桌面对比流程（1440px）" node e2e-compare.mjs
    run_case "手机对比流程（390px）"  env MOBILE=1 node e2e-compare.mjs
    ;;
esac

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部浏览器回归通过（模式：$MODE）"
else
  echo "❌ 存在失败的回归用例，请查看上方输出与失败截图（FAIL.png）。" >&2
  exit 1
fi
