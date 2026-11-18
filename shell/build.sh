#!/usr/bin/env bash
# 出 WebView2 版安装包：cargo 编译 → NSIS 打包
# 需要：Rust 工具链（windows-gnu 即可，不用 MSVC）、NSIS 3（winget install NSIS.NSIS）
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release

# 防回归：PE 子系统必须是 GUI(2)。GNU 工具链默认 console(3)，双击会多弹一个黑框。
node -e '
const fs = require("fs");
const b = fs.readFileSync("target/release/miniedit-shell.exe");
const sub = b.readUInt16LE(b.readUInt32LE(0x3c) + 24 + 68);
if (sub !== 2) {
  console.error("PE 子系统是 " + sub + "，应为 2（GUI）；检查 main.rs 顶上的 windows_subsystem 属性");
  process.exit(1);
}
console.log("PE 子系统 = GUI(2) ✓");
'

MAKENSIS="${MAKENSIS:-/c/Program Files (x86)/NSIS/makensis.exe}"
if [ ! -x "$MAKENSIS" ]; then
  MAKENSIS="$(command -v makensis || true)"
fi
if [ -z "$MAKENSIS" ] || [ ! -x "$MAKENSIS" ]; then
  echo "找不到 makensis，请先 winget install NSIS.NSIS" >&2
  exit 1
fi

"$MAKENSIS" installer.nsi

ls -lh ../dist-shell/
