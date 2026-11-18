# MiniEdit 1.3.0

一个能装进 Windows 的代码编辑器。**高亮规则不写在程序里**——它直接解释 EverEdit 分发格式的
`syntax/*.mac` 与 `theme/*.ini`，所以"像不像"可以逐条数出来，不用靠肉眼比。

![MiniEdit 界面](build/screenshot.png)

## 装与用

到 [Releases](../../releases/latest) 下载 `miniedit_1.3.0_setup.exe`，双击安装，可自选目录，装完自动启动。
安装后开始菜单和桌面会有 MiniEdit。第一次启动会打开两个示例文件，直接敲字就能编辑。
工具条是图标按钮，悬停有名称和快捷键提示。

安装包 **108 MB**，装完约 **311 MB**，其中**我们的代码只有 1.5 MB**（`resources/app.asar`）——
剩下全是 Electron 自带的 Chromium + Node 运行时（`MiniEdit.exe` 本体未压缩就有 238 MB）。
已经把能省的地方都省了：`compression: maximum`（LZMA）、47 MB 的多语言包裁到只剩简体中文和英文
（`locales/` 从 49 MB 降到 1.2 MB）。要再往下，只有不用 Chromium 一条路，见文末「体积这件事」。

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
desktop/main.cjs      主进程：窗口、菜单、文件对话框、编码读写
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

数据在 asar 里只读，用户文件永远在外面读写，互不影响。

## 开发与打包

```bash
npm install
npm run serve       # 浏览器模式，http://127.0.0.1:5178
npm start           # 桌面模式（需要 electron）
npm run verify      # 打印每个语法文件的解释结果
npm run test:fold   # 折叠区间的不变量检查
npm run unsupported # 未支持语句排序（语句名 × 文件数）
npm run dist        # 出安装包 → dist/miniedit_1.3.0_setup.exe
```

安装包不进仓库（约 117 MB），只挂在 Releases 上；`dist/` 已在 `.gitignore` 里。

打包机注意两条：

- 环境里有 `ELECTRON_RUN_AS_NODE=1` 时 electron 会被当成纯 Node 跑，启动前要 `env -u ELECTRON_RUN_AS_NODE`；
- 若上一次的产物目录已存在，electron-builder 会先批量删旧目录，某些环境的安全策略会拦下这一步。
  换个输出目录即可：`npx electron-builder --win nsis -c.directories.output=dist-build`。

（`dist/` 下只留安装包；`.build-cache/` 里是历次中间产物，可以直接删。）

### 自检

主进程内置一条无头自检链路（`MINIEDIT_SMOKE=<png 路径>` 启动），它会：

1. 经 IPC 写一个 GBK + CRLF 的中文文件，再读回来，比对编码、行尾、正文是否一致；
2. 点一下行号栏的三角，确认可见行数正好少了 `end-start` 行、三角变成 `▸`、状态栏出现"折叠 N 处"；
3. 再派发一次 `beforeinput`，确认折叠自动展开且正文与折叠前逐字一致（`restored: true`）；
4. 抓取界面状态（标签、规则数、主题数、语法数、缩进线数量）；
5. 量一遍工具条和查找栏：每个按钮的文字必须单行、`scrollHeight` 不超出按钮高度，装不下时
   允许横向滚动而不是把按钮压扁（`SMOKE_LAYOUT ok=true`）；
6. 截一张图后退出。

窄窗口和缩放也能量：`MINIEDIT_SMOKE_SIZE=720x480` 把窗口压到最小宽度，
`MINIEDIT_SMOKE_ZOOM=1.8` 模拟系统缩放 / 页面放大。

`npm run dist` 出来的包已用这条链路验证过：`SMOKE_IO ok=true`、24 套主题、67 个语法、
`SMOKE_FOLD removed=21 shrunk=true arrow="▸" restored=true`（在自带的 `assets/samples/demo.php`
上折 `class Greeter` 那一块，21 行收进去、正文逐字复原）。

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

## 体积这件事

EverEdit 的安装包不到 5 MB，因为它是一个纯 Win32 C++ 程序，编辑器控件、语法引擎、渲染全是自己写的，
没有第三方运行时。MiniEdit 反过来：界面是 HTML/CSS/JS，跑在 Chromium 里。

| 部分 | 未压缩 | 说明 |
|---|---|---|
| `MiniEdit.exe`（Chromium + Node） | 238 MB | Electron 的硬成本，压不下去 |
| `dxcompiler.dll` / `swiftshader` / `d3dcompiler` | 34 MB | GPU / WebGPU 着色器编译，删了在无独显机器上可能花屏 |
| `resources.pak` / `icudtl.dat` | 23 MB | Chromium 资源与 ICU 数据 |
| `locales/` | 1.2 MB | 已从 49 MB 裁到 zh-CN + en-US |
| **我们的代码（`app.asar`）** | **1.5 MB** | 解释器 + 界面 + 原版 75 个 `.mac`、24 套主题 |

所以 Electron 路线的安装包下限就在 100 MB 上下（LZMA 压完 108 MB）。想接近 5 MB，需要换成
**WebView2 外壳**：界面代码一行不用改，把主进程的文件对话框、编码读写、菜单换成 Rust/C++ 实现，
安装包可以做到 3–6 MB——代价是依赖系统的 Edge WebView2 运行时（Win11 自带，Win10 需装过 Edge），
不再自带浏览器。这条路线还没做，当前版本走的是"自带运行时、双击就能跑"的取舍。

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

## 数据来源

`syntax/` 与 `theme/` 取自 EverEdit 安装包（NSIS-2 + LZMA，7-Zip 可直接解开），
版权归原作者。本程序仅把它们当兼容性参考数据读取，不包含原版任何可执行代码。
