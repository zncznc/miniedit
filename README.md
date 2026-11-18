# MiniEdit 1.4.0

一个能装进 Windows 的代码编辑器。**高亮规则不写在程序里**——它直接解释 EverEdit 分发格式的
`syntax/*.mac` 与 `theme/*.ini`，所以"像不像"可以逐条数出来，不用靠肉眼比。

![MiniEdit 界面](build/screenshot.png)

## 装与用

到 [Releases](../../releases/latest) 下载 `miniedit_1.4.0_setup.exe`，双击安装，可自选目录，装完自动启动。
安装后开始菜单和桌面会有 MiniEdit。第一次启动会打开两个示例文件，直接敲字就能编辑。
工具条是图标按钮，悬停有名称和快捷键提示。

**安装包 848 KB，装完 2.19 MB**——用的是系统自带的 Edge WebView2 渲染界面，不再自带浏览器。
（Win11 自带 WebView2；Win10 装过 Edge 就有。）上一版走 Electron，安装包 108 MB、装完 311 MB，
代码同样是这些，差别全在运行时。两个外壳都在仓库里，见文末「两个外壳」。

| 操作 | 快捷键 |
|---|---|
| 新建 / 打开 / 保存 / 另存为 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| 关闭标签 / 切标签 | `Ctrl+W` / `Ctrl+Tab`（`Shift` 反向） |
| 查找 / 替换 / 转到行 | `Ctrl+F` / `Ctrl+H` / `Ctrl+G` |
| 字号 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| 自动换行 / 全屏 | `Alt+Z` / `F11` |
| 折叠全部 / 展开全部 | `Ctrl+Shift+[` / `Ctrl+Shift+]`（或点行号栏的小三角） |
| 切换语言 | `Ctrl+L` 聚焦语言下拉 |

文件也可以直接拖进窗口。最近打开、窗口大小、主题、字号都会记住，存在
`%APPDATA%/MiniEdit/state.json`。

## 它凭什么"一样"

三个判断都落在可复核的数据上：

- **语法**：67 个独立语法 + 7 个片段文件，全部来自原版 `syntax/*.mac`；解释器把 67 个全部
  完整解释，未支持语句 0 条，另有 7 处走降级链（PCRE 递归、条件组、宽松量词）做的近似实现。
- **配色**：24 套 `theme/*.ini` 全部可用，每套的 token 颜色由 `const.mac` 的常量表映射生成。
- **行为开关**：`setting.ini` 读到 49 个键，行号、当前行、自动缩进、自动配对、Tab 宽度都按它走。
- **折叠**：52 个语法自带 `FoldText` / `IndentText` / `FoldingMethod` 声明，照声明折；
  其余 21 个按缩进兜底，界面上会标出来源。声明挂在区域上也算数——`php.mac` 的根是 HTML
  解析器（按标签折），PHP 代码的 `{` 规则挂在 `rPhp` 区域，两套规则都会被考虑。
- **外挂词表**：`php.mac` 的关键字不在 `.mac` 里，而在 `php.kwd` 的四段（关键字 / 内置函数 /
  魔术常量，颜色各不同），解释器按 `AddWordFromFile` 真去读这份文件。

## 结构

```
shell/src/main.rs     WebView2 外壳：窗口、自定义协议、IPC 路由、原生对话框
shell/src/bridge.rs   注入页面的 window.miniedit（与 preload.cjs 接口一致）
shell/src/text.rs     编码与行尾（encoding_rs，UTF-16 手工拼 BOM）
shell/src/bundle.rs   assets/reference → /api/bundle 的 JSON
shell/src/state.rs    %APPDATA%/MiniEdit/state.json
shell/installer.nsi   NSIS 安装脚本（约 100 行）
desktop/main.cjs      Electron 主进程：窗口、菜单、文件对话框、编码读写
desktop/preload.cjs   contextBridge，只暴露必要方法（sandbox 打开）
desktop/encoding.cjs  编码识别与写回（GBK 走 iconv-lite，UTF-16 手工拼 BOM）
desktop/reference.cjs 只读参考数据，把 syntax/theme 当配置读
js/core/mac.mjs       .mac 文件解释器（词法 + 中间表示）
js/core/highlight.mjs 逐行分词器（支持跨行区域与捕获组）
js/core/theme.mjs     theme/*.ini → CSS 变量与 token 类
js/core/fold.mjs      折叠区间（配对法 / 缩进法，声明可挂在区域上）
js/app.js             编辑器主体：标签、渲染、查找替换、文件操作
assets/reference/     随包分发的 syntax / theme / setting.ini
tools/verify.mjs      覆盖率统计，`npm run verify`
tools/unsupported.mjs 未支持语句按「语句名 × 文件数」排序，`npm run unsupported`
tools/fold-test.mjs   折叠区间的不变量检查，`npm run test:fold`
tools/crop-png.mjs    裁剪放大截图（只依赖 zlib），查像素细节用
```

两套外壳共用同一份前端；数据在安装目录里只读，用户文件永远在外面读写，互不影响。

## 开发与打包

```bash
# WebView2 外壳（默认，出 848 KB 安装包）
cd shell && ./build.sh          # cargo build --release + makensis
MINIEDIT_WEB=<仓库根> MINIEDIT_SMOKE_SHELL=1 shell/target/release/miniedit-shell.exe

# Electron 外壳（备用）
npm install
npm run serve       # 浏览器模式，http://127.0.0.1:5178
npm start           # 桌面模式（需要 electron）
npm run verify      # 打印每个语法文件的解释结果
npm run test:fold   # 折叠区间的不变量检查
npm run unsupported # 未支持语句排序（语句名 × 文件数）
npm run dist        # 出安装包 → dist/miniedit_1.4.0_setup.exe
```

安装包不进仓库，只挂在 Releases 上；`dist/`、`dist-shell/` 已在 `.gitignore` 里。

打包机注意三条：

- WebView2 版要 NSIS 3：`winget install NSIS.NSIS`；Rust 用 `windows-gnu` 工具链即可，**不需要 MSVC**
  （wry 的 `WebView2Loader.dll` 从 `target/*/build/webview2-com-sys-*/out/x64/` 拷出来）；
- 环境里有 `ELECTRON_RUN_AS_NODE=1` 时 electron 会被当成纯 Node 跑，启动前要 `env -u ELECTRON_RUN_AS_NODE`；
- 本机 `NODE_OPTIONS` 里注入的 safe-delete shim 会让 electron-builder 清目录时 EPERM，打包要
  `env -u NODE_OPTIONS`。

### 自检

两套外壳各有自己的无头自检。

**WebView2 版**：`MINIEDIT_SMOKE_SHELL=1` 启动，3.5 秒后注入探针，逐步收集（每步单独 try/catch）：

1. `dom`：页面 URL、`#ta` 是否存在、body 长度；
2. `io`：经 IPC 写 GBK + CRLF 中文，再读回来比对编码 / 行尾 / 正文；
3. `fold`：点第一个三角，确认行数变少、箭头变 `▸`，再触发 `beforeinput` 确认正文复原；
4. `layout`：工具条按钮有没有被折行裁掉、缩进线数量；
5. `boot`：`/api/bundle` 里语法与恢复快照的数量。

结果一次性打印成 `SMOKE_SHELL {...}` + `SMOKE_OK`。安装后的 `D:\MiniEdit` 已用这条链路跑过：
67 个语法 / 24 套主题 / 69 行高亮 / `fold.restored=true` / GBK 往返 `same=true`。

**Electron 版**：`MINIEDIT_SMOKE=<png>` 启动，走 IPC 往返、点三角折叠、抓界面状态、量工具条，
最后截一张图退出。窄窗口和缩放也能量：`MINIEDIT_SMOKE_SIZE=720x480`、`MINIEDIT_SMOKE_ZOOM=1.8`。

## 折叠是怎么做的

文本框（`<textarea>`）没法只隐藏其中几行，所以折叠做成**视图层**：`tab.text` 永远是正文，
折叠只决定"把哪几行放进文本框"。有三条约束保证它不会写坏文件：

- **正文只有一个来源**：保存、查找、编码转换全部读 `tab.text`，不读文本框里的内容；
- **一改文本就先展开**：`beforeinput` 与 `keydown` 在插入/删除前调用 `unfoldAll()`，
  光标按"视图偏移 → 真实偏移"映射回去，所以不存在"从折叠视图取正文"的路径；
- **折叠不带脏标记**：折叠/展开不改 `tab.text`，也不置 dirty。

折叠区间优先用语法文件自己的声明（`FoldText` + `UnfoldText` 配对法、`IndentText` /
`FoldingMethod="indent"` 缩进法），没声明才按缩进兜底——这条"来源"在界面上可见，
不是黑箱。

## 从 53 条未支持，到 0 条

先把 53 条按「语句名 × 出现文件数」排序（`node tools/unsupported.mjs`），结果很反直觉：
看着像 53 个坑，其实是 6 个根因，而且大头不是新语法，是**一处失败带崩一片**。

| 根因 | 条数 | 说明 |
|---|---|---|
| 正则写法 JS 的 `RegExp` 不接受 | 7 | PCRE 递归 `(?R)`、条件组 `(?(?=…))`、`\|?` 这种宽松量词、多写一个右括号 |
| 上一行失败带出的级联 | 27 | `Set iX = CreateItem(...)` 失败后，后面每处 `AddItem(iX)` 都报"未定义标识符" |
| VBScript 过程 `Sub AddAutoCaseWord` | 8 | 原版脚本段：`wWord.AutoCase=True` 后重新 `AddWord` |
| 标识符大小写不一致 | 8 | 声明 `rLine20`、调用写 `rline20`——VBScript 本来就不区分大小写 |
| `AddWordFromFile` + `SCRIPT_PATH` 拼路径 | 2 | 关键字表是外挂的 `php.kwd` |
| 语句多写一个右括号 | 1 | 原版宿主容忍，JS 会整条作废 |

处理办法对应六处改动：

- **正则降级链**：原样编译 → 宽松量词按字面量 → 去掉多余右括号 → 递归降为一层 → 条件组降为
  普通分组。每降一级都在报告里留一条"近似理解"，和"不支持"分开记。真正救不回来的正则用
  `(?!)`（永不匹配）占位，规则树结构保持完整。
- **占位不级联**：`CreateItem` / `Set` 求值失败时给一个死节点，后面的 `AddItem` 变成无操作，
  错误数才等于真实缺口数。
- **标识符不区分大小写**：环境变量统一按小写存，这是 VBScript 的语义。
- **脚本过程**：先登记本文件所有 `Sub`/`Function`（nsis 的定义写在调用之后），再执行调用。
- **内置常量与外挂词表**：`SCRIPT_PATH` 指语法目录，`AddWordFromFile` 按文件名取 `php.kwd`，
  并保留它按 `#<颜色>,..` 分段的结构。
- **`&` 拼接**：表达式层的字符串加法。

改完的结果（`npm run verify` 可复现）：67/67 完整解释，未支持 0 条，近似 7 处；
规则总量只增不减 —— 条目 +41 条、关键字 +19 组，没有哪个语法少了解释出来的规则。

## 两个外壳

界面只有一份（`index.html` + `js/` + `css/` + `assets/`），外面套的"壳"有两套：

| 外壳 | 目录 | 安装包 | 装完 | 依赖 |
|---|---|---|---|---|
| **WebView2（默认）** | `shell/`（Rust + wry/tao） | **848 KB** | 2.19 MB | 系统的 Edge WebView2 运行时 |
| Electron（备用） | `desktop/` + `server.mjs` | 108 MB | 311 MB | 无，自带 Chromium |

**为什么能小两个数量级**：EverEdit 不到 5 MB，是因为它纯 Win32、渲染和语法引擎都自己写。MiniEdit 的
界面是 HTML/CSS/JS，Electron 版本质上附带了一整个 Chromium（`MiniEdit.exe` 未压缩就 238 MB）。
换成 WebView2 后，浏览器由系统提供，我们只剩：

| 部分 | 大小 |
|---|---|
| `MiniEdit.exe`（Rust 外壳） | 955 KB |
| `WebView2Loader.dll` | 162 KB |
| 前端 + 75 个 `.mac` + 24 套主题 | 1.3 MB |
| 安装包（LZMA 压完） | **848 KB** |

Electron 版为保留"没有 WebView2 也能跑"这条退路，一行没删；`npm run dist` 仍可出 108 MB 的包。

### 外壳差在哪

WebView2 版用 tao，没有跨平台菜单栏 API，所以**没有菜单条**：文件/编辑/查看的加速键改由前端
`document` 级 keydown 接管（Ctrl+N/O/S/Shift+S/W、Ctrl+=/−/0、Alt+Z、Ctrl+L…都通）。
另外 tao 的 `CloseRequested` 拦不住关窗，没法像 Electron 那样弹"要保存吗"，改成**未保存内容快照**：
改到 1.2 秒后自动写 `%APPDATA%/MiniEdit/recovery.json`，下次启动原样恢复成带 ● 的标签页，
点 × 直接走人也不丢字。

## 没做的，以及为什么

| 能力 | 状态 | 原因 |
|---|---|---|
| 十六进制视图 | 未实现 | 原版由 `hexedit.dll` 提供，二进制文件目前直接拒绝打开并提示 |
| 文件树侧栏 | 未实现 | 原版由 `shelltree.dll` 提供 |
| 宏 / `.esm` 模式 | 未实现 | 原版跑 JS 宏，需要另一套运行沙箱 |
| 大文件 | 部分 | 高亮上限 4000 行，超过部分按纯文本显示；打开上限 32MB |
| 文件关联 | 未做 | 安装器不抢 `.txt` 默认程序；需要时可右键"打开方式"选择 MiniEdit |

## 踩过的坑

- `CreateRegion` 第 4 个参数不是"是否跨行"，判据是结束符里是否含 `$`；
- `setting.ini` 是 UTF-16LE，`.mac` 里还有 GBK，编码要逐个判而不是统一按 UTF-8；
- 主题键名大小写与 `const.mac` 的常量名不一致，匹配时统一转小写；
- VBScript 的标识符不区分大小写——`rline20` 和 `rLine20` 是同一个变量，按大小写敏感查会漏掉一整个区域；
- `Sub` 过程可以写在调用之后（`nsis.mac` 就是这样），所以要先登记、再执行；
- `php.kwd` 不是「一行一个词」的平表：它按 `#16,1,0` 这样的段头分段，第一个数是颜色索引，
  整份表有四段、四种颜色，当成一段处理会把内置函数全涂成关键字色。
- wry 在 `windows-gnu` 工具链下能直接编（WebView2 的导入库由 `webview2-com-sys` 自带），
  但运行时**必须把 `WebView2Loader.dll` 放到 exe 旁边**，否则进程 236 毫秒就静默退出，一个字都不输出；
- tao 0.30 的 `WindowEvent::CloseRequested` 是空变体，**拦不住关窗**（winit 那些版本才有 `api`），
  所以"未保存要提示"改成了恢复快照；也没有菜单模块，`with_menu` 只收裸 `HMENU`；
- 原生对话框会自己跑消息循环，从 WebView2 的 IPC 回调里同步弹可能卡死，要丢到独立线程再回包。

## 数据来源

`syntax/` 与 `theme/` 取自 EverEdit 安装包（NSIS-2 + LZMA，7-Zip 可直接解开），
版权归原作者。本程序仅把它们当兼容性参考数据读取，不包含原版任何可执行代码。
