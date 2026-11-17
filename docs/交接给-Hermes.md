# 交接：MiniEdit 1.0.0

这是一份项目交接说明。请阅读后确认你接收到的关键信息（不超过 15 行），
并说明你能如何继续推进它。**本轮不要修改、创建或删除任何文件**，只做阅读与确认。

---

## 这是什么

MiniEdit 是一个 Windows 代码编辑器，今天（2026-11-17）从零做出来的。
它的做法不是重写高亮引擎，而是**直接解释 EverEdit 分发格式的语法与主题文件**：

- `syntax/*.mac`：EverEdit 自有的 DSL（有 Include、Const、CreateRegion、CreateParser、
  CreateStringRegion、AddWord 等语句），我写了 JS 解释器把它变成规则树；
- `theme/*.ini`：24 套配色，token 颜色靠 `const.mac` 里的颜色常量表中转；
- `setting.ini`：49 个行为开关（行号、当前行、自动缩进、自动配对、Tab 宽度）。

这样做的意义：高亮的"像不像"可以数出来，不用靠肉眼比。

## 仓库

- https://github.com/zncznc/miniedit （public，main 分支，126 个文件，1.6 MB）
- 安装包在 Release：https://github.com/zncznc/miniedit/releases/tag/v1.0.0
  （`miniedit_1.0.0_setup.exe`，116 MB，NSIS 打包，不进 Git）
- 本地路径：`C:\Users\chaoc\Desktop\REA\miniedit`
- 已静默安装一份在 `D:\MiniEdit`，开始菜单有快捷方式

## 代码结构

```
desktop/main.cjs      Electron 主进程：窗口、中文菜单、文件对话框、编码读写、单实例
desktop/preload.cjs   contextBridge，只暴露必要方法
desktop/encoding.cjs  编码识别与写回（UTF-8/BOM/UTF-16/GBK，GBK 走 iconv-lite，含有损检测）
desktop/reference.cjs 把 syntax/theme 当只读配置读
js/core/mac.mjs       .mac 解释器
js/core/highlight.mjs 逐行 tokenizer（跨行区域、捕获组、状态栈）
js/core/theme.mjs     theme/*.ini → CSS 变量 + .tN 类
js/app.js             编辑器主体：标签、渲染、查找替换、文件操作
server.mjs            浏览器模式服务，和桌面模式共用同一份前端
tools/verify.mjs      覆盖率统计
```

同一份前端跑两种形态：浏览器走 `fetch /api/bundle`，桌面走 `window.miniedit`。

## 可复核的数字

- 67 个独立语法 + 7 个片段文件：完整解释 60 个，累计 53 条语句未支持；
- 24 套主题全部可用；
- IPC 往返 GBK + CRLF 一致（`SMOKE_IO ok=true`）；
- dev / win-unpacked / 已安装副本三种形态都跑过无头自检。

## 已知缺口（都在 README 的表里）

- 十六进制视图（原版 `hexedit.dll`）、文件树侧栏（`shelltree.dll`）未做；
- 代码折叠：`FoldText` 已解析成数据，缺渲染层；
- 宏 / `.esm` 模式未做；
- 53 条未支持语句集中在 PCRE 独有写法：`(?R)` 递归、`(?(?=…))` 条件子组、
  `AddWordFromFile` 加载外部关键字表。

## 三个技术坑（值得记住）

1. `CreateRegion` 第 4 个参数不是"是否跨行"，判据是结束符里是否含 `$`；
2. `setting.ini` 是 UTF-16LE，部分 `.mac` 是 GBK，编码要逐个判；
3. 主题键名大小写与 `const.mac` 常量名不一致，匹配时统一小写。

## 打包环境坑

- `ELECTRON_RUN_AS_NODE=1` 会让 electron 退化成纯 Node，启动前 `env -u`；
- Git Bash 会把 `/S`、`/D=` 当路径转换，静默安装参数要用单引号；
- electron-builder 清旧产物目录会被本机安全策略拦，改用 `-c.directories.output=新目录`。

## 我这边还想做的

1. 补折叠与缩进线（数据已在，只差渲染）；
2. 用 REA 的 `capture-process` 抓原版同名窗口，逐项对比，把"像"换成逐条结论；
3. 把 53 条未支持语句按频次排序，先补影响面最大的几个。
