#!/usr/bin/env bash
# =============================================================================
# test-entry.sh — 统一回归入口（scripts/e2e.sh、scripts/e2e-env.sh）的轻量测试
#
# 覆盖：
#   * 正常路径输出（环境就绪、build 模式成功）
#   * 非零退出（未知模式=2、预览起不来=1、浏览器缺失=1）
#   * 关键中文提示完整（模式值、产物目录、预览失败等，不被变量边界吞掉）
#   * 静态扫描：不存在“$变量名 紧跟多字节标点”的写法
#
# 特点：不下载真实浏览器、不启动真实预览、不改业务代码；
#       通过临时目录 + 伪造浏览器/vite/npx + 覆盖用环境变量实现隔离。
#       兼容 macOS 自带 Bash 3.2（不使用关联数组/mapfile/set -u）。
#
# 用法：bash scripts/test-entry.sh
# 依赖：已执行 npm install（build 模式需要 node_modules）。
# =============================================================================
set -o pipefail

RUN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_SH="$RUN_ROOT/scripts/e2e-env.sh"
E2E_SH="$RUN_ROOT/scripts/e2e.sh"
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t e2etest)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

PASS=0; FAIL=0

# 断言：$1=描述 $2=期望退出码 $3=实际退出码 $4=输出文件，其后为“必须包含”的串
check() {
  local desc="$1" exp="$2" rc="$3" out="$4"; shift 4
  local ok=1 p
  if [ "$rc" != "$exp" ]; then ok=0; echo "    退出码：期望 $exp，实际 $rc"; fi
  for p in "$@"; do
    if ! grep -qF -- "$p" "$out" 2>/dev/null; then ok=0; echo "    缺少提示：$p"; fi
  done
  if [ "$ok" = 1 ]; then
    echo "  ✔ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✘ $desc"; FAIL=$((FAIL + 1))
    echo "    --- 输出末尾 ---"; tail -n 8 "$out" 2>/dev/null | sed 's/^/    | /'
  fi
}

# 断言输出“不得包含”某串
check_absent() {
  local desc="$1" out="$2"; shift 2
  local ok=1 p
  for p in "$@"; do
    if grep -qF -- "$p" "$out" 2>/dev/null; then ok=0; echo "    不应出现：$p"; fi
  done
  if [ "$ok" = 1 ]; then
    echo "  ✔ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✘ $desc"; FAIL=$((FAIL + 1))
  fi
}

# 构造一个“已就位”的工具目录（含伪造浏览器，跳过系统库与字体），全程无网络。
setup_fake_tools() { # $1=目录
  local d="$1"
  mkdir -p "$d/pw-browsers/chromium_headless_shell-test/chrome-headless-shell-linux-arm64"
  printf '#!/bin/sh\nexit 0\n' \
    > "$d/pw-browsers/chromium_headless_shell-test/chrome-headless-shell-linux-arm64/chrome-headless-shell"
  chmod +x "$d/pw-browsers/chromium_headless_shell-test/chrome-headless-shell-linux-arm64/chrome-headless-shell"
}

# 跑 e2e.sh 的公共环境前缀
fake_env() { # $1=工具目录，其后输出额外 VAR=val
  local d="$1"; shift
  env E2E_TOOLS_DIR="$d" E2E_SKIP_SYSDEPS=1 E2E_SKIP_FONT=1 "$@"
}

echo "── 1. 未知模式：构建前退出，码=2，中文提示完整 ─────────────────────"
D="$TMP/t-bogus"; setup_fake_tools "$D"
fake_env "$D" bash "$E2E_SH" bogus >"$TMP/bogus.out" 2>&1; RC=$?
check "未知模式返回 2 且提示完整" 2 "$RC" "$TMP/bogus.out" \
  "未知模式：bogus" "可选 all|desktop|mobile|compare|build"
check_absent "未知模式不应触发构建" "$TMP/bogus.out" "构建生产产物"

echo "── 2. build 模式：成功，码=0，中文提示完整 ─────────────────────────"
D="$TMP/t-build"; setup_fake_tools "$D"
fake_env "$D" bash "$E2E_SH" build >"$TMP/build.out" 2>&1; RC=$?
check "build 模式返回 0 并提示结束" 0 "$RC" "$TMP/build.out" \
  "构建生产产物" "仅构建，结束" "✓ built"

echo "── 3. 预览起不来：码=1，明确失败提示且打印日志 ─────────────────────"
D="$TMP/t-preview"; setup_fake_tools "$D"
mkdir -p "$TMP/stubbin"
printf '#!/bin/sh\necho "stub vite: 故意启动失败" >&2\nexit 1\n' > "$TMP/stubbin/fake-vite"
chmod +x "$TMP/stubbin/fake-vite"
fake_env "$D" E2E_VITE_BIN="$TMP/stubbin/fake-vite" E2E_PREVIEW_TRIES=2 E2E_PORT=48317 \
  bash "$E2E_SH" desktop >"$TMP/preview.out" 2>&1; RC=$?
check "预览失败返回 1 并给出中文诊断" 1 "$RC" "$TMP/preview.out" \
  "预览服务器在限定时间内未就绪" "stub vite: 故意启动失败"

echo "── 4. 浏览器缺失：码=1，失败提示保留产物目录 ───────────────────────"
D="$TMP/t-nobrowser"; mkdir -p "$D"
mkdir -p "$TMP/offline-bin"
# 伪造离线的 npx：playwright 安装步骤立刻失败，绝不触网。
printf '#!/bin/sh\necho "npx stub: simulated offline" >&2\nexit 127\n' > "$TMP/offline-bin/npx"
chmod +x "$TMP/offline-bin/npx"
env PATH="$TMP/offline-bin:$PATH" E2E_TOOLS_DIR="$D" E2E_SKIP_FONT=1 \
  bash "$ENV_SH" >"$TMP/nobrowser.out" 2>&1; RC=$?
check "浏览器缺失返回 1 且提示含产物目录" 1 "$RC" "$TMP/nobrowser.out" \
  "Chromium 下载失败" "产物目录：$D/pw-browsers"
check_absent "失败提示中的变量没被多字节标点吞空" "$TMP/nobrowser.out" "产物目录：）"

echo "── 5. 环境就绪：伪造浏览器，码=0，输出环境就绪 ─────────────────────"
D="$TMP/t-ok"; setup_fake_tools "$D"
env E2E_TOOLS_DIR="$D" E2E_SKIP_SYSDEPS=1 E2E_SKIP_FONT=1 \
  bash "$ENV_SH" >"$TMP/envok.out" 2>&1; RC=$?
check "环境准备返回 0 并打印就绪" 0 "$RC" "$TMP/envok.out" "环境就绪" "HEADLESS_SHELL="

echo "── 6. 静态：中文标点前的变量必须花括号定界 ─────────────────────────"
STATIC_RC=0
# LC_ALL=C 下高字节(>=0x80)即多字节 UTF-8 标点；[:cntrl:] 排除换行等控制符。
if LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~[:cntrl:]]' "$E2E_SH" "$ENV_SH" >"$TMP/static.out" 2>&1; then
  STATIC_RC=1
  echo "  ✘ 发现变量名后紧跟多字节字符："; sed 's/^/    | /' "$TMP/static.out"
  FAIL=$((FAIL + 1))
fi
grep -qF '（模式：${MODE}）' "$E2E_SH" || { STATIC_RC=1; echo "  ✘ 成功提示未用 \${MODE} 定界"; FAIL=$((FAIL + 1)); }
grep -qF '产物目录：${PLAYWRIGHT_BROWSERS_PATH}' "$ENV_SH" || { STATIC_RC=1; echo "  ✘ 浏览器失败提示未用 \${PLAYWRIGHT_BROWSERS_PATH} 定界"; FAIL=$((FAIL + 1)); }
[ "$STATIC_RC" = 0 ] && { echo "  ✔ 全部中文提示变量均已花括号定界"; PASS=$((PASS + 1)); }

echo
echo "──────────────────────────────────────────────────────────────────"
echo "入口轻量测试结果：通过 $PASS，失败 $FAIL"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
