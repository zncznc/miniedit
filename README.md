# MiniEdit 1.0.0

一个能装进 Windows 的代码编辑器。**高亮规则不写在程序里**——它直接解释 EverEdit 分发格式的
`syntax/*.mac` 与 `theme/*.ini`，所以"像不像"可以逐条数出来，不用靠肉眼比。

![MiniEdit 界面](build/screenshot.png)

## 装与用

到 [Releases](../../releases/latest) 下载 `miniedit_1.0.0_setup.exe`，双击安装，可自选目录，装完自动启动。
安装后开始菜单和桌面会有 MiniEdit。第一次启动会打开两个示例文件，直接敲字就能编辑。

| 操作 | 快捷键 |
|---|---|
| 新建 / 打开 / 保存 / 另存为 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| 关闭标签 / 切标签 | `Ctrl+W` / `Ctrl+Tab`（`Shift` 反向） |
| 查找 / 替换 / 转到行 | `Ctrl+F` / `Ctrl+H` / `Ctrl+G` |
| 字号 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| 自动换行 / 全屏 | `Alt+Z` / `F11` |
| 切换语言 | `Ctrl+L` 聚焦语言下拉 |

文件也可以直接拖进窗口。最近打开、窗口大小、主题、字号都会记住，存在
`%APPDATA%/MiniEdit/state.json`。

## 它凭什么"一样"

三个判断都落在可复核的数据上：

- **语法**：67 个独立语法 + 7 个片段文件，全部来自原版 `syntax/*.mac`；解释器完整加载 60 个，
  累计 53 条语句未支持。缺口在界面上点红色数字能看到具体行号与原因。
- **配色**：24 套 `theme/*.ini` 全部可用，每套的 token 颜色由 `const.mac` 的常量表映射生成。
- **行为开关**：`setting.ini` 读到 49 个键，行号、当前行、自动缩进、自动配对、Tab 宽度都按它走。

## 结构

```
desktop/main.cjs      主进程：窗口、菜单、文件对话框、编码读写
desktop/preload.cjs   contextBridge，只暴露必要方法（sandbox 打开）
desktop/encoding.cjs  编码识别与写回（GBK 走 iconv-lite，UTF-16 手工拼 BOM）
desktop/reference.cjs 只读参考数据，把 syntax/theme 当配置读
js/core/mac.mjs       .mac 文件解释器（词法 + 中间表示）
js/core/highlight.mjs 逐行分词器（支持跨行区域与捕获组）
js/core/theme.mjs     theme/*.ini → CSS 变量与 token 类
js/app.js             编辑器主体：标签、渲染、查找替换、文件操作
assets/reference/     随包分发的 syntax / theme / setting.ini
tools/verify.mjs      覆盖率统计，`npm run verify`
```

数据在 asar 里只读，用户文件永远在外面读写，互不影响。

## 开发与打包

```bash
npm install
npm run serve     # 浏览器模式，http://127.0.0.1:5178
npm start         # 桌面模式（需要 electron）
npm run verify    # 打印每个语法文件的解释结果
npm run dist      # 出安装包 → dist/miniedit_1.0.0_setup.exe
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
2. 抓取界面状态（标签、规则数、主题数、语法数）；
3. 截一张图后退出。

`npm run dist` 出来的包已用这条链路验证过：`SMOKE_IO ok=true`、24 套主题、67 个语法。

## 没做的，以及为什么

| 能力 | 状态 | 原因 |
|---|---|---|
| 十六进制视图 | 未实现 | 原版由 `hexedit.dll` 提供，二进制文件目前直接拒绝打开并提示 |
| 文件树侧栏 | 未实现 | 原版由 `shelltree.dll` 提供 |
| 代码折叠 / 缩进线 | 未实现 | `.mac` 里的 `FoldText` 已解析成数据，缺渲染 |
| 宏 / `.esm` 模式 | 未实现 | 原版跑 JS 宏，需要另一套运行沙箱 |
| 大文件 | 部分 | 高亮上限 4000 行，超过部分按纯文本显示；打开上限 32MB |
| 文件关联 | 未做 | 安装器不抢 `.txt` 默认程序；需要时可右键"打开方式"选择 MiniEdit |

## 三个踩过的坑

- `CreateRegion` 第 4 个参数不是"是否跨行"，判据是结束符里是否含 `$`；
- `setting.ini` 是 UTF-16LE，`.mac` 里还有 GBK，编码要逐个判而不是统一按 UTF-8；
- 主题键名大小写与 `const.mac` 的常量名不一致，匹配时统一转小写。

## 数据来源

`syntax/` 与 `theme/` 取自 EverEdit 安装包（NSIS-2 + LZMA，7-Zip 可直接解开），
版权归原作者。本程序仅把它们当兼容性参考数据读取，不包含原版任何可执行代码。
