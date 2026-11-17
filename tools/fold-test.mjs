// 折叠区间的不变量检查：结构和行为都要能复算，不靠肉眼看。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpret } from '../js/core/mac.mjs';
import { foldRegions, visibleRows } from '../js/core/fold.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SYN = path.join(ROOT, 'assets', 'reference', 'syntax');

const dec = (buf) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
};

const files = {};
for (const f of fs.readdirSync(SYN)) if (f.endsWith('.mac')) files[f] = dec(fs.readFileSync(path.join(SYN, f)));

let fail = 0;
const check = (name, cond, detail = '') => {
  if (!cond) {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`);
  }
};

function metaOf(syntax) {
  const r = interpret(files[syntax], { files, file: syntax });
  return (r.root && r.root.meta) || {};
}

function linesOf(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
}

for (const [file, syntax] of [
  ['samples/hello.c', 'c99.mac'],
  ['samples/demo.py', 'python.mac'],
]) {
  const lines = linesOf(file);
  const regions = foldRegions(lines, metaOf(syntax), 4);
  console.log(`${file}（${syntax}）：${lines.length} 行 → ${regions.length} 个可折叠块`);

  check('至少有一个折叠块', regions.length > 0);
  for (const r of regions) {
    check('区间非空', r.end > r.start, `第 ${r.start + 1} 行`);
    check('块首行存在', r.start >= 0 && r.start < lines.length);
    check('块尾不越界', r.end < lines.length);
    check('块首行有内容', lines[r.start].trim().length > 0, `第 ${r.start + 1} 行`);
  }

  // 区间之间只能"包含"或"不相交"，不能半重叠
  for (let i = 1; i < regions.length; i++) {
    const a = regions[i - 1];
    const b = regions[i];
    const ok = b.start > a.end || b.end <= a.end;
    check('区间不半重叠', ok, `${a.start + 1}-${a.end + 1} 与 ${b.start + 1}-${b.end + 1}`);
  }

  if (regions.length) {
    const r = regions[0];
    const { rows } = visibleRows(lines.length, regions, new Set([r.start]));
    check('折叠后行数正好少 (end-start)', rows.length === lines.length - (r.end - r.start),
      `期望 ${lines.length - (r.end - r.start)}，实得 ${rows.length}`);
    check('块首行仍可见', rows.includes(r.start));
    check('块内的行都不可见', !rows.some((x) => x > r.start && x <= r.end));
  }
}

// 折叠规则来源：声明了 FoldText/FoldingMethod 的语法要走声明，其余按缩进兜底
let declared = 0;
let fallback = 0;
for (const name of Object.keys(files)) {
  if (name === 'const.mac') continue;
  const m = metaOf(name);
  if ((m.fold && m.fold[0]) || m.indent || String(m.foldingmethod || '').toLowerCase() === 'indent') declared++;
  else fallback++;
}
console.log(`\n折叠规则来源：${declared} 个语法自带声明，${fallback} 个按缩进兜底`);
check('声明折叠的语法不少于 40 个', declared >= 40, String(declared));

if (fail) {
  console.log(`\n失败 ${fail} 项`);
  process.exit(1);
}
console.log('全部不变量通过');
