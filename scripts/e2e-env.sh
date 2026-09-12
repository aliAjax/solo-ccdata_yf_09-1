#!/usr/bin/env bash
# =============================================================================
# e2e-env.sh — 浏览器回归环境的幂等准备
#
# 设计原则：
#   * 不需要 root：所有产物都在项目目录 .e2e-tools/ 与用户缓存内；
#     系统库通过下载 .deb 并解包到本地 sysroot、再用 LD_LIBRARY_PATH 加载。
#   * 幂等：已就绪的步骤自动跳过，可反复执行。
#   * 不碰业务数据与既有交互：不修改 src/、不访问真实浏览器用户数据；
#     测试运行时只操作 Playwright 自己的临时 profile。
#
# 可单独执行（bash scripts/e2e-env.sh），也可被 e2e.sh source。
# =============================================================================
set -euo pipefail

E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_TOOLS="$E2E_ROOT/.e2e-tools"
E2E_SYSROOT="$E2E_TOOLS/sysroot"
E2E_APT="$E2E_TOOLS/apt"
E2E_DEBS="$E2E_TOOLS/debs"
E2E_LIBDIRS="$E2E_TOOLS/libdirs.txt"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$E2E_TOOLS/pw-browsers}"
mkdir -p "$E2E_TOOLS" "$E2E_SYSROOT"

log()  { printf '\033[2m[e2e-env]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[e2e-env]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[e2e-env]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. npm 依赖 -------------------------------------------------------
if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  log "安装 npm 依赖（优先 npm ci）…"
  if [ -f "$E2E_ROOT/package-lock.json" ]; then
    (cd "$E2E_ROOT" && npm ci) || (cd "$E2E_ROOT" && npm install)
  else
    (cd "$E2E_ROOT" && npm install)
  fi
else
  log "npm 依赖已就绪，跳过。"
fi

# ---------- 2. Playwright Chromium（headless shell） -------------------------
HEADLESS_SHELL="$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/chrome-headless-shell-linux-*/chrome-headless-shell 2>/dev/null | head -1 || true)"
if [ -z "$HEADLESS_SHELL" ]; then
  log "下载 Playwright Chromium 到 $PLAYWRIGHT_BROWSERS_PATH …"
  (cd "$E2E_ROOT" && npx playwright install chromium)
  HEADLESS_SHELL="$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/chrome-headless-shell-linux-*/chrome-headless-shell 2>/dev/null | head -1 || true)"
fi
[ -n "$HEADLESS_SHELL" ] || die "Chromium 下载失败，请检查网络后重试（产物目录：$PLAYWRIGHT_BROWSERS_PATH）。"
log "浏览器：$HEADLESS_SHELL"

# ---------- 3. 中文字体（截图里中文不能是方框） ------------------------------
ensure_cjk_font() {
  if fc-list 2>/dev/null | grep -qiE 'wqy|zenhei|noto.*cjk|source han'; then
    log "系统已有中文字体，跳过字体准备。"
    return
  fi
  mkdir -p "$HOME/.fonts"
  if ls "$HOME/.fonts"/wqy-zenhei.ttc >/dev/null 2>&1; then
    log "用户字体目录已有文泉驿正黑。"
  else
    log "下载文泉驿正黑（fonts-wqy-zenhei）到 ~/.fonts …"
    mkdir -p "$E2E_DEBS/font"
    if apt_download_one fonts-wqy-zenhei "$E2E_DEBS/font"; then
      dpkg-deb -x "$E2E_DEBS"/font/fonts-wqy-zenhei*.deb "$E2E_SYSROOT"
      cp "$(find "$E2E_SYSROOT/usr/share/fonts" -name '*.ttc' -o -name '*.ttf' | head -1)" "$HOME/.fonts/wqy-zenhei.ttc"
    else
      warn "中文字体下载失败；功能回归不受影响，但截图中的中文可能显示为方框。"
    fi
  fi
  command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$HOME/.fonts" >/dev/null 2>&1 || true
}

# ---------- 4. 系统共享库（无 root，解包 .deb 到本地 sysroot） ---------------
# Debian/Ubuntu 下 Chromium 需要的库（bookworm 的包名；arm64/amd64 通用）。
E2E_DEB_PACKAGES=(
  libnspr4 libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2
  libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libxi6 libdrm2
  libwayland-server0 libasound2
)

# 检查缺库时总是带上已解包的本地库目录，保证幂等（第二次运行能识别已就绪）
missing_libs() {
  local lp=""
  [ -f "$E2E_LIBDIRS" ] && lp="$(paste -sd: "$E2E_LIBDIRS")"
  LD_LIBRARY_PATH="${lp}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    ldd "$HEADLESS_SHELL" 2>/dev/null | awk '/not found/{print $1}' | sort -u
}

apt_configure() {
  mkdir -p "$E2E_APT/lists/partial" "$E2E_APT/archives/partial"
  APT_OPTS=(
    -o "Dir::State::Lists=$E2E_APT/lists"
    -o "Dir::Cache=$E2E_APT"
    -o "Dir::Cache::Archives=$E2E_APT/archives"
    -o "Dir::State::status=$E2E_APT/status"
  )
  touch "$E2E_APT/status"
}

# 在指定目录下载单个包（包列表缺失时先 update）。成功返回 0。
apt_download_one() {
  local pkg="$1" dest="$2"
  apt_configure
  mkdir -p "$dest"
  if ! compgen -G "$E2E_APT/lists/*_Packages" >/dev/null 2>&1 && [ ! -f "$E2E_APT/.updated" ]; then
    log "apt 包列表为空，执行 update（使用项目内缓存目录）…"
    apt-get "${APT_OPTS[@]}" update >/dev/null 2>&1 || true
    touch "$E2E_APT/.updated"
  fi
  (cd "$dest" && apt-get "${APT_OPTS[@]}" download "$pkg" >/dev/null 2>&1)
}

ensure_sys_libs() {
  local missing
  missing="$(missing_libs)"
  if [ -z "$missing" ]; then
    log "Chromium 系统库已齐全，跳过。"
    return
  fi
  if [ "${E2E_SKIP_SYSDEPS:-0}" = "1" ]; then
    warn "E2E_SKIP_SYSDEPS=1，跳过本地系统库准备。仍缺少："
    echo "$missing" | sed 's/^/    - /' >&2
    return
  fi
  if [ ! -r /etc/os-release ] || ! . /etc/os-release 2>/dev/null || \
     ! case " ${ID:-} ${ID_LIKE:-} " in *" debian "*|*" ubuntu "*) true;; *) false;; esac; then
    warn "非 Debian/Ubuntu 发行版，无法自动解包 .deb。请用系统包管理器安装 Chromium 依赖，或重跑时加 E2E_SKIP_SYSDEPS=1。"
    echo "$missing" | sed 's/^/    缺少: /' >&2
    return
  fi

  log "浏览器缺少系统库，开始无 root 解包 .deb："
  echo "$missing" | sed 's/^/    - /'
  mkdir -p "$E2E_DEBS/libs"
  apt_configure
  if [ ! -f "$E2E_APT/.updated" ]; then
    log "apt update（使用项目内缓存目录）…"
    apt-get "${APT_OPTS[@]}" update >/dev/null 2>&1 || true
    touch "$E2E_APT/.updated"
  fi

  # 整组安装；若个别包名在当前发行版不存在（如 trixie 的 libasound2t64），
  # 退化为逐包下载，保证其余库照常就位。
  if ! (cd "$E2E_DEBS/libs" && apt-get "${APT_OPTS[@]}" download "${E2E_DEB_PACKAGES[@]}" >/dev/null 2>&1); then
    for pkg in "${E2E_DEB_PACKAGES[@]}" libasound2t64; do
      compgen -G "$E2E_DEBS/libs/${pkg}_*.deb" >/dev/null 2>&1 || \
        apt_download_one "$pkg" "$E2E_DEBS/libs" || true
    done
  fi
  for f in "$E2E_DEBS"/libs/*.deb; do
    [ -e "$f" ] && dpkg-deb -x "$f" "$E2E_SYSROOT" 2>/dev/null || true
  done

  find "$E2E_SYSROOT" -type f -name '*.so*' | xargs -n1 dirname 2>/dev/null | sort -u > "$E2E_LIBDIRS"
  local still
  still="$(LD_LIBRARY_PATH="$(paste -sd: "$E2E_LIBDIRS")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" missing_libs)"
  if [ -n "$still" ]; then
    warn "仍有库无法在本地解析："
    echo "$still" | sed 's/^/    - /' >&2
    warn "可在有网络/权限的环境安装对应包后重跑（本脚本会自动跳过已就绪步骤）。"
  fi
}

ensure_sys_libs
ensure_cjk_font

# 首次运行时 libdirs.txt 由 ensure_sys_libs 生成，必须在其后再导出一次，
# 否则 source 本脚本的父进程及后续 node 子进程拿不到库路径。
if [ -f "$E2E_LIBDIRS" ]; then
  export LD_LIBRARY_PATH="$(paste -sd: "$E2E_LIBDIRS")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# 最终自检：浏览器能否真正启动由测试套件负责，这里先确认 ldd 无缺。
FINAL_MISSING="$(missing_libs || true)"
if [ -n "$FINAL_MISSING" ] && [ "${E2E_SKIP_SYSDEPS:-0}" != "1" ]; then
  warn "环境准备完成，但以下库未能自动解析：$(echo "$FINAL_MISSING" | tr '\n' ' ')"
fi

# 供 source 使用：导出给子进程的关键变量汇总
cat > "$E2E_TOOLS/env.summary" <<EOF
PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH
LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-}
HEADLESS_SHELL=$HEADLESS_SHELL
EOF

# 仅在直接执行（而非被 source）时打印摘要
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  log "环境就绪。关键变量："
  sed 's/^/    /' "$E2E_TOOLS/env.summary"
  log "运行全部回归：npm run e2e"
fi
