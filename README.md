# 研究文献库 · 研究问题工作台

本地优先的研究工具：管理文献与研究问题，把文献按「支持 / 反驳 / 存疑」立场关联为问题的证据（含摘录、去重），提供证据覆盖、未关联文献、立场筛选、双问题对比与结构化 JSON 导出。数据保存在浏览器 `localStorage`，刷新不丢。

技术栈：React + Vite，无后端。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 本地开发
npm run build      # 生产构建（输出 dist/）
npm run preview    # 预览构建产物
```

## 浏览器回归（统一入口）

```bash
npm run e2e              # 一条命令：构建 → 起预览 → 跑完全部 4 套回归
npm run e2e:desktop      # 仅桌面主流程（1440px，44 项断言）
npm run e2e:mobile       # 仅手机主流程（390px，37 项断言，含横向溢出检查）
npm run e2e:compare       # 双问题对比（桌面 30 + 手机 34 项断言）
npm run e2e:env          # 只准备浏览器环境（幂等），不跑测试
npm run e2e:test         # 入口轻量测试（不下载浏览器、不起真实服务，秒级）
npm run e2e:build        # 等同于 npm run build（走统一脚本的构建路径）
# 也可以：bash scripts/e2e.sh [all|desktop|mobile|compare|build]
```

**`npm run e2e:test`**（`scripts/test-entry.sh`）是统一入口本身的快速冒烟测试，与浏览器回归解耦：用临时目录 + 伪造的浏览器/vite/npx，校验正常输出、非零退出与关键中文提示——未知模式退出 2、预览起不来退出 1、浏览器缺失退出 1 且提示保留「产物目录」、build 成功退出 0，并静态扫描确认中文标点前的变量都用 `${var}` 定界。不访问网络、不下载浏览器、不改业务代码，建议改脚本后先跑它。

四套 Playwright 用例：`e2e.mjs`（桌面主流程）、`e2e-mobile.mjs`（手机主流程）、`e2e-compare.mjs`（对比，`MOBILE=1` 切换手机视口）。每个用例启动时都会清空本站点的 `localStorage` 键并从内置种子数据起步，**不依赖也不改动你在浏览器里的真实数据**；失败时在对应截图目录留下 `FAIL.png`。

### 环境准备做了什么（`scripts/e2e-env.sh`，幂等、无 root）

脚本做了平台检测，同时兼容 **macOS 自带 Bash 3.2** 与 **Linux（含精简 Debian 容器）**；不使用关联数组、`mapfile` 等 Bash 4+ 语法，数组展开统一用 `${arr[@]+"${arr[@]}"}` 形式。首次运行自动完成、已就绪即跳过，产物都在项目内 `.e2e-tools/`（已 gitignore），不写系统目录：

1. 缺 npm 依赖时 `npm ci`（回退 `npm install`）；
2. 通过 `PLAYWRIGHT_BROWSERS_PATH=.e2e-tools/pw-browsers` 在项目内下载 Playwright Chromium（按平台自动定位二进制，不写死 linux 路径）；
3. **仅 Linux**：若 `ldd` 发现浏览器缺系统共享库，逐包用项目内 apt 缓存 `apt-get download` 拉 **.deb**、通过完整性校验后解包到 `.e2e-tools/sysroot`，运行时以 `LD_LIBRARY_PATH` 加载——不执行 sudo、不改系统库。**macOS 直接跳过**（Playwright 浏览器自包含依赖、系统自带中文字体），不调用 `ldd/apt/dpkg`；
4. 无中文字体的 Linux：下载 `fonts-wqy-zenhei` 安装到用户字体目录 `~/.fonts`（仅为截图中文不成方框；失败只警告，不影响断言）。

健壮性细节：下载的每个 .deb 都会用 `dpkg-deb --fsys-tarfile | tar t` **全量校验**（慢网络可能留下“字节数看似正确、数据段却截断”的包，仅 `-I` 查不出来），损坏即删除重下、最多 3 次；系统库只解包通过校验的包，避免截断的 `libnss3.so` 等导致浏览器 `SIGBUS` 崩溃。所有“探测型”命令（如 `ldd`）都在函数里兜底为成功返回。

退出码保证（曾在 macOS Bash 3.2 上踩坑）：脚本用 `set -eo pipefail` 而**不使用 `set -u`**——Bash 3.2 下未绑定变量导致的中止退出码竟是 0，且 EXIT trap 里 `$?` 也是 0，会把变量展开错误伪装成成功；因此统一用 `${var:-}` 默认值规避未绑定展开。EXIT trap 会先保存进入时的 `$?`、清理预览进程后再以该码 `exit`，避免 trap 末尾命令把退出码重置为 0。因此：任一用例失败 / 构建失败 / 预览起不来，`npm run e2e` 一律返回**非零**；全部通过才返回 0。

运行配置：`scripts/e2e.sh` 构建后直接用 `node_modules/.bin/vite preview --port 4173 --strictPort` 起服务（避免 `npx` 多一层进程导致清理时泄漏；启动前会检查 vite 可执行存在、轮询到 HTTP 200 才继续；端口被占用则复用），把地址经 `E2E_BASE` 传给用例，`trap` 在退出时关掉自己启动的预览进程；单个用例首次失败会自动重试一次。

可用环境变量：

| 变量 | 作用 |
|---|---|
| `E2E_PORT` | 覆盖预览端口（默认 4173），如 `E2E_PORT=4200 npm run e2e` |
| `E2E_SKIP_SYSDEPS=1` | 跳过第 3 步本地解包系统库（宿主机已自备 Chromium 依赖时使用） |
| `MOBILE=1` | 仅对 `e2e-compare.mjs` 有效：以 390px 手机视口运行（脚本已自动处理） |

## 失败排查

- **macOS 自带 Bash 一进入环境准备就退出**：已修复（原因是 `set -e` 下命令替换调用了不存在的 `ldd`）。请确认脚本是最新版；可用 `bash scripts/e2e-env.sh` 单独验证，应直接提示“非 Linux…跳过”并以 0 退出。脚本无需 Homebrew 的新版 Bash，Bash 3.2 即可运行。
- **浏览器起不来 / `error while loading shared libraries: libxxx.so`**：说明系统库没解析成功。单独跑 `npm run e2e:env` 查看仍缺哪些库；Debian/Ubuntu 会自动解包，其它 Linux 发行版请用系统包管理器装 Chromium 依赖后加 `E2E_SKIP_SYSDEPS=1` 重跑。`.e2e-tools/libdirs.txt` 是当前本地库目录，`env.summary` 记录了实际使用的变量。
- **浏览器一启动就崩溃（如退出码 135/SIGBUS）**：通常是慢网络留下了截断的系统库/字体 .deb。脚本已会校验并自动删除重下；若仍遇到，可直接删掉 `.e2e-tools/sysroot` 与 `.e2e-tools/debs` 后重跑（会重新下载、解包）。
- **下载失败（npm / Playwright / apt / 字体）**：脚本可安全重跑，已下载且完整的内容不会重复拉取；网络恢复后再执行即可。Playwright 浏览器体积大，若 CDN 超时，可单独多执行几次 `npx playwright install chromium`，或设 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=600000`。字体失败只影响截图字形，不影响断言。
- **端口冲突**：`E2E_PORT=4200 npm run e2e` 换端口；或脚本检测到端口上已有可用站点会直接复用。
- **某条用例失败**：看终端最后一个「断言失败」名称，并打开它打印的截图目录中的 `FAIL.png`；预览服务日志在 `.e2e-tools/preview.log`。用例之间互不影响（每个用例都从内置种子起步，且各用例自身清空 localStorage）。注意对比用例会在无头临时 profile 里创建「空问题甲/乙」等数据，不影响本机浏览器。
- **想手动点开页面验证**：`npm run build && npm run preview`，浏览器打开 `http://localhost:4173/`。应用首次访问写入的是内置示例数据，之后全部存于 `localStorage`（键 `research-workbench-v1`，旧版 `research-library` 会自动迁移）。
