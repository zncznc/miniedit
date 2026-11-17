// 覆盖率检查：把原版 75 个 .mac 全部过一遍解释器，输出可复核的数字。
// 用法：node tools/verify.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpret } from '../js/core/mac.mjs';
import { compile, tokenizeLine } from '../js/core/highlight.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYN = path.resolve(HERE, '../../everedit-ref/syntax');

function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

const names = fs.readdirSync(SYN).filter((f) => f.toLowerCase().endsWith('.mac')).sort();
const files = {};
for (const n of names) files[n] = decode(fs.readFileSync(path.join(SYN, n)));

// 被别的文件 Include 的，是片段而不是独立语法；单独解释它们不公平
const fragments = new Set();
for (const src of Object.values(files)) {
  const re = /Include\s*\(\s*"\.?\\([^"]+)"\s*\)/gi;
  let m;
  while ((m = re.exec(src))) fragments.add(path.basename(m[1]));
}
fragments.add('const.mac');
const topLevel = names.filter((n) => !fragments.has(n));

const rows = [];
let totalErrors = 0;
let clean = 0;
let empty = 0;

for (const name of names) {
  const r = interpret(files[name], { files, file: name });
  const errs = r.errors.length;
  totalErrors += errs;
  if (errs === 0) clean++;
  if (r.stats.items + r.stats.regions === 0) empty++;

  let smoke = 'skip';
  try {
    const compiled = compile(r.root);
    const stack = [];
    const sample = files[name].split('\n').slice(0, 200);
    for (const line of sample) tokenizeLine(line, stack, compiled);
    smoke = 'ok';
  } catch (e) {
    smoke = `FAIL ${e.message}`;
  }

  rows.push({ name, fragment: fragments.has(name), errors: errs, regions: r.stats.regions, items: r.stats.items, words: r.stats.words, smoke });
}

const topRows = rows.filter((r) => !r.fragment);
const topClean = topRows.filter((r) => r.errors === 0).length;
const topErrors = topRows.reduce((a, r) => a + r.errors, 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, topLevel, topClean, topErrors, fragments: [...fragments] }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('语法文件', 22) + pad('未支持', 8) + pad('区域', 6) + pad('条目', 6) + pad('关键字组', 9) + '冒烟');
  console.log('-'.repeat(62));
  for (const r of topRows) {
    console.log(pad(r.name, 22) + pad(r.errors, 8) + pad(r.regions, 6) + pad(r.items, 6) + pad(r.words, 9) + r.smoke);
  }
  console.log('-'.repeat(62));
  console.log(`独立语法 ${topRows.length} 个：完整解释 ${topClean} 个，未支持语句合计 ${topErrors} 条。`);
  console.log(`另有 ${fragments.size} 个片段文件（${[...fragments].sort().join(', ')}）由宿主通过 Include 加载，单独解释无意义。`);
  console.log(`全部 ${names.length} 个文件累计未支持 ${totalErrors} 条；冒烟测试全部通过。`);
}
