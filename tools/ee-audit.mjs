// 从 EverEdit 安装目录里抽出完整的功能面：
//   lang/2052.lng  → 菜单树 + 对话框 + 零散字符串（UTF-16LE）
//   key.ini        → 全部命令 ID 与默认快捷键
// 输出 docs/everedit-功能清单.md，并用 js/commands.mjs 的注册表算复刻覆盖率。
//
// 用法：node tools/ee-audit.mjs [--ref <everedit 目录>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argRef = process.argv.indexOf('--ref');
const refDir = argRef > 0 ? process.argv[argRef + 1] : path.join(root, '..', 'everedit-ref');

const lngPath = path.join(refDir, 'lang', '2052.lng');
const keyPath = path.join(refDir, 'key.ini');

if (!fs.existsSync(lngPath)) {
  console.error(`找不到 ${lngPath}`);
  process.exit(1);
}

// ---- 解析 .lng：段 → 有序条目 ----
const raw = fs.readFileSync(lngPath, 'utf16le').replace(/^\uFEFF/, '');
const sections = new Map();
let cur = null;
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\[(.+?)\]\s*$/);
  if (m) {
    cur = m[1];
    sections.set(cur, []);
    continue;
  }
  if (!cur) continue;
  const kv = line.match(/^([A-Za-z]?)(\d+)=(.*)$/);
  if (!kv) continue;
  sections.get(cur).push({ sub: kv[1] === 'P', id: Number(kv[2]), text: kv[3] });
}

// ---- 解析 key.ini：命令 → 快捷键 ----
const keys = new Map();
if (fs.existsSync(keyPath)) {
  for (const line of fs.readFileSync(keyPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^=\s][^=]*)=(cm_[a-z0-9_]+)\s*$/);
    if (!m) continue;
    const [, combo, cmd] = m;
    if (!keys.has(cmd)) keys.set(cmd, []);
    keys.get(cmd).push(combo);
  }
}

const cmds = [...keys.keys()];
const group = {};
for (const c of cmds) {
  const g = c.split('_')[1] || 'other';
  (group[g] ||= []).push(c);
}

// ---- 已实现的命令（js/commands.mjs 里的注册表）----
// 直接 import 注册表来数，比正则可靠（折叠层级那批是循环生成的）
let implemented = new Set();
let extraCount = 0;
const regPath = path.join(root, 'js', 'commands.mjs');
if (fs.existsSync(regPath)) {
  const mod = await import(pathToFileURL(regPath).href);
  for (const id of mod.COMMANDS.keys()) {
    if (id.startsWith('cm_')) implemented.add(id);
    else extraCount++;
  }
}

// ---- 生成清单 ----
const out = [];
out.push('# EverEdit 功能清单（从安装目录的 lang/2052.lng 与 key.ini 抽出）');
out.push('');
out.push(`数据来源：\`${refDir}\``);
out.push('');
out.push('## 总数');
out.push('');
out.push(`- 菜单段 ${[...sections.keys()].filter((k) => /MENU/i.test(k)).length} 个`);
out.push(`- 对话框段 ${[...sections.keys()].filter((k) => /^DLG/i.test(k)).length} 个`);
out.push(`- 命令 ${cmds.length} 条，其中 MiniEdit 已实现 ${implemented.size} 条` +
  (extraCount ? `（另有 ${extraCount} 条原版没有快捷键、自己补的命令）` : ''));
out.push('');

const byMenu = [...sections.keys()].filter((k) => /MENU/i.test(k));
out.push('## 菜单');
out.push('');
for (const name of byMenu) {
  const items = sections.get(name);
  out.push(`### ${name}（${items.length} 项）`);
  out.push('');
  out.push('```');
  for (const it of items) {
    out.push(it.sub ? `${it.text}` : `    ${it.text}`);
  }
  out.push('```');
  out.push('');
}

out.push('## 命令（按类别）');
out.push('');
for (const g of Object.keys(group).sort((a, b) => group[b].length - group[a].length)) {
  out.push(`### ${g}（${group[g].length}）`);
  out.push('');
  out.push('| 命令 | 快捷键 | 状态 |');
  out.push('| --- | --- | --- |');
  for (const c of group[g].sort()) {
    const k = (keys.get(c) || []).join(' / ').replace(/\|/g, '\\|');
    out.push(`| \`${c}\` | ${k} | ${implemented.has(c) ? '已实现' : '—'} |`);
  }
  out.push('');
}

const dlgs = [...sections.keys()].filter((k) => /^DLG/i.test(k));
if (dlgs.length) {
  out.push('## 对话框');
  out.push('');
  out.push('| 段 | 条目数 | 前几项 |');
  out.push('| --- | --- | --- |');
  for (const d of dlgs) {
    const items = sections.get(d);
    const head = items.slice(0, 4).map((i) => i.text).join('；').replace(/\|/g, '\\|');
    out.push(`| ${d} | ${items.length} | ${head} |`);
  }
  out.push('');
}

const outPath = path.join(root, 'docs', 'everedit-功能清单.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'), 'utf8');

console.log(`菜单 ${byMenu.length} 段 / 对话框 ${dlgs.length} 段 / 命令 ${cmds.length} 条`);
console.log(`已注册 ${implemented.size} 条，覆盖率 ${((implemented.size / cmds.length) * 100).toFixed(1)}%`);
console.log(`清单已写入 ${path.relative(root, outPath)}`);
