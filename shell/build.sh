#!/usr/bin/env bash
# 出 WebView2 版安装包：cargo 编译 → NSIS 打包
# 需要：Rust 工具链（windows-gnu 即可，不用 MSVC）、NSIS 3（winget install NSIS.NSIS）
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release

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
