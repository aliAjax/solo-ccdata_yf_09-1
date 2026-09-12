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
npm run e2e:build        # 等同于 npm run build（走统一脚本的构建路径）
# 也可以：bash scripts/e2e.sh [all|desktop|mobile|compare|build]
```

四套 Playwright 用例：`e2e.mjs`（桌面主流程）、`e2e-mobile.mjs`（手机主流程）、`e2e-compare.mjs`（对比，`MOBILE=1` 切换手机视口）。每个用例启动时都会清空本站点的 `localStorage` 键并从内置种子数据起步，**不依赖也不改动你在浏览器里的真实数据**；失败时在对应截图目录留下 `FAIL.png`。

### 环境准备做了什么（`scripts/e2e-env.sh`，幂等、无 root）

首次运行自动完成，已就绪的步骤会跳过，所有产物都在项目内 `.e2e-tools/`（已 gitignore），不写系统目录：

1. 缺 npm 依赖时 `npm ci`（回退 `npm install`）；
2. 通过 `PLAYWRIGHT_BROWSERS_PATH=.e2e-tools/pw-browsers` 在项目内下载 Playwright Chromium；
3. 若 `ldd` 发现浏览器缺系统共享库（精简 Debian 容器常见），用项目内 apt 缓存目录 `apt-get download` 拉取对应 **.deb** 并解包到 `.e2e-tools/sysroot`，运行时以 `LD_LIBRARY_PATH` 加载——不执行 sudo、不改系统库；
4. 无中文字体时下载 `fonts-wqy-zenhei` 安装到用户字体目录 `~/.fonts`（仅为截图中文不成方框；可删）。

运行配置：`scripts/e2e.sh` 构建后用 `vite preview --port 4173 --strictPort` 起服务（端口已被占用时直接复用），把地址经 `E2E_BASE` 传给用例，退出时自动关掉自己启动的预览进程。

可用环境变量：

| 变量 | 作用 |
|---|---|
| `E2E_PORT` | 覆盖预览端口（默认 4173），如 `E2E_PORT=4200 npm run e2e` |
| `E2E_SKIP_SYSDEPS=1` | 跳过第 3 步本地解包系统库（宿主机已自备 Chromium 依赖时使用） |
| `MOBILE=1` | 仅对 `e2e-compare.mjs` 有效：以 390px 手机视口运行（脚本已自动处理） |

## 失败排查

- **浏览器起不来 / `error while loading shared libraries: libxxx.so`**：说明系统库没解析成功。单独跑 `npm run e2e:env` 查看仍缺哪些库；Debian/Ubuntu 会自动解包，其它发行版请用系统包管理器装 Chromium 依赖后加 `E2E_SKIP_SYSDEPS=1` 重跑。`.e2e-tools/libdirs.txt` 是当前本地库目录，`env.summary` 记录了实际使用的变量。
- **下载失败（npm / Playwright / apt / 字体）**：脚本可安全重跑，已下载的内容不会重复拉取；网络恢复后再执行即可。字体下载失败只影响截图字形，不影响断言。
- **端口冲突**：`E2E_PORT=4200 npm run e2e` 换端口；或脚本检测到端口上已有可用站点会直接复用。
- **某条用例失败**：看终端最后一个「断言失败」名称，并打开它打印的截图目录中的 `FAIL.png`；预览服务日志在 `.e2e-tools/preview.log`。注意对比用例会真实创建「空问题甲/乙」等种子后数据——都在无头浏览器的临时 profile 里，不影响本机浏览器。
- **想手动点开页面验证**：`npm run build && npm run preview`，浏览器打开 `http://localhost:4173/`。应用首次访问写入的是内置示例数据，之后全部存于 `localStorage`（键 `research-workbench-v1`，旧版 `research-library` 会自动迁移）。
