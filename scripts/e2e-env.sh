#!/usr/bin/env bash
# =============================================================================
# e2e-env.sh — 浏览器回归环境的幂等准备
#
# 兼容：
#   * macOS（自带 Bash 3.2）与 Linux（含精简 Debian 容器）。
#   * 不需要 root：Linux 下的系统库通过下载 .deb 并解包到本地 sysroot、
#     再用 LD_LIBRARY_PATH 加载；macOS 的 Playwright 浏览器自包含依赖，直接跳过。
#   * 幂等：已就绪的步骤自动跳过，可反复执行。
#   * 不碰业务数据与既有交互：不修改 src/、不访问真实浏览器用户数据；
#     测试运行时只操作 Playwright 自己的临时 profile。
#
# 可单独执行（bash scripts/e2e-env.sh），也可被 e2e.sh source。
# 可设 E2E_OS=Darwin 在 Linux 上模拟走 macOS 分支（仅用于脚本自测）。
# =============================================================================
# 不使用 `set -u`(nounset)：Bash 3.2（macOS 自带）下未绑定变量的中止退出码是 0，
# 且 EXIT trap 里 $? 也是 0，会把展开错误伪装成成功。这里统一用 ${var:-} 默认值
# 规避未绑定展开；真实失败由 errexit / 调用方的退出码体现（非零）。
set -eo pipefail

E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_TOOLS="$E2E_ROOT/.e2e-tools"
E2E_SYSROOT="$E2E_TOOLS/sysroot"
E2E_APT="$E2E_TOOLS/apt"
E2E_DEBS="$E2E_TOOLS/debs"
E2E_LIBDIRS="$E2E_TOOLS/libdirs.txt"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$E2E_TOOLS/pw-browsers}"
mkdir -p "$E2E_TOOLS" "$E2E_SYSROOT"

# 平台检测（E2E_OS 仅供脚本自测覆盖）
E2E_OS="${E2E_OS:-$(uname -s)}"
IS_MAC=0; IS_LINUX=0
case "$E2E_OS" in
  Darwin*) IS_MAC=1 ;;
  Linux*)  IS_LINUX=1 ;;
esac

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
# 跨平台定位二进制（Linux: chrome-headless-shell-linux-*，macOS: chrome-headless-shell-mac-*）。
# 用 find 而非写死路径的 glob；本函数恒返回 0，找不到时输出空串。
find_headless_shell() {
  find "$PLAYWRIGHT_BROWSERS_PATH" -maxdepth 3 \
    \( -name 'chrome-headless-shell' -o -name 'headless_shell' \) -type f 2>/dev/null \
    | head -1 || true
}

HEADLESS_SHELL="$(find_headless_shell)"
if [ -z "$HEADLESS_SHELL" ]; then
  log "下载 Playwright Chromium 到 $PLAYWRIGHT_BROWSERS_PATH …"
  (cd "$E2E_ROOT" && npx playwright install chromium)
  HEADLESS_SHELL="$(find_headless_shell)"
fi
[ -n "$HEADLESS_SHELL" ] || die "Chromium 下载失败，请检查网络后重试（产物目录：$PLAYWRIGHT_BROWSERS_PATH）。"
log "浏览器：$HEADLESS_SHELL"

# ---------- 3. 中文字体（截图里中文不能是方框） ------------------------------
ensure_cjk_font() {
  # macOS 自带 PingFang/STHeiti 等中文字体，无需处理。
  if [ "$IS_MAC" = "1" ]; then
    log "macOS 自带中文字体（PingFang 等），跳过字体准备。"
    return 0
  fi
  if command -v fc-list >/dev/null 2>&1 && \
     fc-list 2>/dev/null | grep -qiE 'wqy|zenhei|noto.*cjk|source han'; then
    log "系统已有中文字体，跳过字体准备。"
    return 0
  fi
  # 没有 fc-list/apt-get 的最小化 Linux：无法自动处理，仅警告（不影响断言）。
  if ! command -v apt-get >/dev/null 2>&1; then
    warn "未检测到 fc-list/apt-get，跳过中文字体自动安装（仅截图中文可能显示为方框，不影响回归）。"
    return 0
  fi
  mkdir -p "$HOME/.fonts"
  if ls "$HOME/.fonts"/wqy-zenhei.ttc >/dev/null 2>&1; then
    log "用户字体目录已有文泉驿正黑。"
  else
    log "下载文泉驿正黑（fonts-wqy-zenhei）到 ~/.fonts …"
    mkdir -p "$E2E_DEBS/font"
    if apt_download_one fonts-wqy-zenhei "$E2E_DEBS/font"; then
      local fontroot fontfile
      fontroot="$E2E_TOOLS/font-extract"
      rm -rf "$fontroot"; mkdir -p "$fontroot"
      if dpkg-deb -x "$E2E_DEBS"/font/fonts-wqy-zenhei*.deb "$fontroot" 2>/dev/null; then
        fontfile="$(find "$fontroot" \( -name '*.ttc' -o -name '*.ttf' \) 2>/dev/null | head -1 || true)"
        if [ -n "$fontfile" ]; then
          cp "$fontfile" "$HOME/.fonts/wqy-zenhei.ttc"
          log "中文字体已安装到 ~/.fonts。"
        else
          warn "字体包已下载但未找到字体文件，跳过。"
        fi
      else
        warn "字体包解包失败（可能下载损坏），跳过；重跑会自动重试。"
      fi
    else
      warn "中文字体下载失败；功能回归不受影响，但截图中的中文可能显示为方框。"
    fi
  fi
  command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$HOME/.fonts" >/dev/null 2>&1 || true
  return 0
}

# ---------- 4. 系统共享库（仅 Linux；无 root，解包 .deb 到本地 sysroot） ------
# Debian/Ubuntu 下 Chromium 需要的库（bookworm 的包名；arm64/amd64 通用）。
E2E_DEB_PACKAGES=(
  libnspr4 libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2
  libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libxi6 libdrm2
  libwayland-server0 libasound2
)

# 探测缺少的共享库。非 Linux 或没有 ldd（如 macOS）时直接视为"无缺失"。
# 关键：本函数必须恒返回 0——否则在 set -e 下，`v="$(missing_libs)"`
# 这类命令替换赋值会直接终止整个脚本（macOS 上 ldd 不存在即踩中此问题）。
missing_libs() {
  command -v ldd >/dev/null 2>&1 || { printf ''; return 0; }
  local lp=""
  if [ -f "$E2E_LIBDIRS" ]; then
    lp="$(paste -sd: "$E2E_LIBDIRS" 2>/dev/null || true)"
  fi
  LD_LIBRARY_PATH="${lp}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    ldd "$HEADLESS_SHELL" 2>/dev/null | awk '/not found/{print $1}' | sort -u || true
  return 0
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

# 校验 .deb 是否可完整解包。强制读完整 data 成员（管道到 tar t），
# 能发现“归档头正常但数据段中途截断”的包——仅 --contents 在个别 dpkg 版本
# 上会漏掉这类截断，--fsys-tarfile 全量读取更可靠。
deb_intact() {
  command -v dpkg-deb >/dev/null 2>&1 || return 0
  if command -v tar >/dev/null 2>&1; then
    dpkg-deb --fsys-tarfile "$1" 2>/dev/null | tar t >/dev/null 2>&1
  else
    dpkg-deb --contents "$1" >/dev/null 2>&1
  fi
}

# 在指定目录下载单个包（包列表缺失时先 update）。
# 成功判定：出现能完整解包的 .deb。最多尝试 3 次。成功返回 0。
apt_download_one() {
  local pkg="$1" dest="$2" attempt f
  apt_configure
  mkdir -p "$dest"
  if ! compgen -G "$E2E_APT/lists/*_Packages" >/dev/null 2>&1 && [ ! -f "$E2E_APT/.updated" ]; then
    log "apt 包列表为空，执行 update（使用项目内缓存目录）…"
    apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} update >/dev/null 2>&1 || true
    touch "$E2E_APT/.updated"
  fi
  for attempt in 1 2 3; do
    f="$(find "$dest" -maxdepth 1 -name "${pkg}_*.deb" -type f -size +1k 2>/dev/null | head -1 || true)"
    if [ -n "$f" ] && deb_intact "$f"; then return 0; fi
    [ -n "$f" ] && rm -f "$f"   # 截断/损坏包删除后重下
    (cd "$dest" && apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} download "$pkg" >/dev/null 2>&1) || true
    f="$(find "$dest" -maxdepth 1 -name "${pkg}_*.deb" -type f -size +1k 2>/dev/null | head -1 || true)"
    if [ -n "$f" ] && deb_intact "$f"; then return 0; fi
    [ "$attempt" -lt 3 ] && sleep 2
  done
  return 1
}

ensure_sys_libs() {
  # macOS / Windows(MSYS) 等：Playwright 浏览器自带依赖，不需要 .deb。
  if [ "$IS_LINUX" != "1" ]; then
    log "当前平台 $E2E_OS 非 Linux：Playwright 浏览器自包含系统依赖，跳过系统库准备。"
    return 0
  fi

  local missing
  missing="$(missing_libs)" || true
  if [ -z "$missing" ]; then
    log "Chromium 系统库已齐全，跳过。"
    return 0
  fi
  if [ "${E2E_SKIP_SYSDEPS:-0}" = "1" ]; then
    warn "E2E_SKIP_SYSDEPS=1，跳过本地系统库准备。仍缺少："
    printf '%s\n' "$missing" | sed 's/^/    - /' >&2
    return 0
  fi
  if [ ! -r /etc/os-release ] || ! . /etc/os-release 2>/dev/null || \
     ! case " ${ID:-} ${ID_LIKE:-} " in *" debian "*|*" ubuntu "*) true;; *) false;; esac; then
    warn "非 Debian/Ubuntu 的 Linux，无法自动解包 .deb。请用系统包管理器安装 Chromium 依赖，或重跑时加 E2E_SKIP_SYSDEPS=1。"
    printf '%s\n' "$missing" | sed 's/^/    缺少: /' >&2
    return 0
  fi

  log "浏览器缺少系统库，开始无 root 解包 .deb："
  printf '%s\n' "$missing" | sed 's/^/    - /'
  mkdir -p "$E2E_DEBS/libs"
  apt_configure
  if [ ! -f "$E2E_APT/.updated" ]; then
    log "apt update（使用项目内缓存目录）…"
    apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} update >/dev/null 2>&1 || true
    touch "$E2E_APT/.updated"
  fi

  # 逐包准备（比一次性批量更稳：内存占用小、个别失败可单独重试）。
  # 统一走 apt_download_one：已存在且完整的 .deb 直接复用；截断/损坏会删除重下；
  # 每包最多尝试 3 次。兼容精简容器里偶发的进程被杀/断流。
  local pkg
  for pkg in ${E2E_DEB_PACKAGES[@]+"${E2E_DEB_PACKAGES[@]}"}; do
    if apt_download_one "$pkg" "$E2E_DEBS/libs"; then
      :
    else
      warn "  $pkg 下载失败，跳过（重跑本脚本会再试）。"
    fi
  done

  # 只解包通过完整性校验的包，避免把截断的 .so 写进 sysroot 导致浏览器崩溃。
  local f
  for f in "$E2E_DEBS"/libs/*.deb; do
    [ -e "$f" ] || continue
    if deb_intact "$f"; then
      dpkg-deb -x "$f" "$E2E_SYSROOT" 2>/dev/null || true
    else
      warn "  跳过损坏的系统库包：$(basename "$f")（重跑本脚本会自动重下）。"
    fi
  done

  : > "$E2E_LIBDIRS"
  find "$E2E_SYSROOT" -type f -name '*.so*' 2>/dev/null \
    | while IFS= read -r so; do dirname "$so"; done | sort -u > "$E2E_LIBDIRS" || true

  # 库目录变化后重新导出，供最终自检使用。
  if [ -s "$E2E_LIBDIRS" ]; then
    export LD_LIBRARY_PATH="$(paste -sd: "$E2E_LIBDIRS")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  fi
  local still
  still="$(missing_libs)" || true
  if [ -n "$still" ]; then
    warn "仍有库无法在本地解析："
    printf '%s\n' "$still" | sed 's/^/    - /' >&2
    warn "可在有网络/权限的环境安装对应包后重跑（本脚本会自动跳过已就绪步骤）。"
  fi
  return 0
}

ensure_sys_libs
ensure_cjk_font

# 首次运行时 libdirs.txt 由 ensure_sys_libs 生成，必须在其后再导出一次，
# 否则 source 本脚本的父进程及后续 node 子进程拿不到库路径。
# 仅 Linux 会生成该文件；macOS 上即使存在残留也不导出（路径在 mac 无意义）。
if [ "$IS_LINUX" = "1" ] && [ -s "$E2E_LIBDIRS" ]; then
  export LD_LIBRARY_PATH="$(paste -sd: "$E2E_LIBDIRS")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# 最终自检（Linux 才有意义）：浏览器能否真正启动由测试套件负责。
if [ "$IS_LINUX" = "1" ]; then
  FINAL_MISSING="$(missing_libs)" || true
  if [ -n "$FINAL_MISSING" ] && [ "${E2E_SKIP_SYSDEPS:-0}" != "1" ]; then
    warn "环境准备完成，但以下库未能自动解析：$(printf '%s' "$FINAL_MISSING" | tr '\n' ' ')"
  fi
fi

# 供 source 使用：导出给子进程的关键变量汇总
cat > "$E2E_TOOLS/env.summary" <<EOF
E2E_OS=$E2E_OS
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
