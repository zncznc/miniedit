// 未支持语句排序：按「语句名 × 出现文件数」统计，用来决定补哪几个最划算。
// 用法：node tools/unsupported.mjs [--json] [--top N] [--show 语句名]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpret } from '../js/core/mac.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYN = path.resolve(HERE, '../../everedit-ref/syntax');

function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

// 和 verify.mjs 保持同一口径：被 Include 的是片段
const names = fs.readdirSync(SYN).filter((f) => f.toLowerCase().endsWith('.mac')).sort();
const files = {};
for (const n of names) files[n] = decode(fs.readFileSync(path.join(SYN, n)));
for (const n of fs.readdirSync(SYN).filter((f) => f.toLowerCase().endsWith('.kwd'))) {
  files[n] = decode(fs.readFileSync(path.join(SYN, n)));
}

const fragments = new Set();
for (const src of Object.values(files)) {
  const re = /Include\s*\(\s*"\.?\\([^"]+)"\s*\)/gi;
  let m;
  while ((m = re.exec(src))) fragments.add(path.basename(m[1]));
}
fragments.add('const.mac');

// 一条未支持语句归到哪个「语句名」名下。
// 优先取 `对象.方法` 或 `方法`，取不到就退回语句形态分类——分类仍然能指导实现。
function statementKey(text, reason) {
  const s = String(text || '').trim();
  let m = s.match(/^([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(/);
  if (m) return `${m[1]}.${m[2]}`;
  m = s.match(/^([A-Za-z_]\w*)\s*\(/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z_]\w*)\s*=/);
  if (m) return `${m[1]} =（赋值）`;
  if (/^#/.test(s)) return '#预处理指令';
  if (/^\/\//.test(s) || /^\/\*/.test(s)) return '注释';
  return reason.includes('未识别') ? '（无法归类的形态）' : reason;
}

const agg = new Map(); // key -> { key, count, files:Set, samples:[], reasons:Map }

for (const name of names) {
  if (fragments.has(name)) continue;
  const r = interpret(files[name], { files, file: name });
  for (const e of r.errors) {
    const key = statementKey(e.text, e.reason);
    let row = agg.get(key);
    if (!row) {
      row = { key, count: 0, files: new Set(), samples: [], reasons: new Map() };
      agg.set(key, row);
    }
    row.count++;
    row.files.add(name);
    row.reasons.set(e.reason, (row.reasons.get(e.reason) || 0) + 1);
    if (row.samples.length < 3) row.samples.push({ file: name, line: e.line, text: String(e.text).trim() });
  }
}

const rows = [...agg.values()]
  .map((r) => ({
    key: r.key,
    files: r.files.size,
    count: r.count,
    // 排序主键：先看影响多少个语法文件，再看总条数
    leverage: r.files.size * 100 + r.count,
    samples: r.samples,
    reasons: [...r.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}（${v}）`),
    fileList: [...r.files].sort(),
  }))
  .sort((a, b) => b.leverage - a.leverage || a.key.localeCompare(b.key));

const argv = process.argv.slice(2);
const showIdx = argv.indexOf('--show');
const topIdx = argv.indexOf('--top');
const topN = topIdx >= 0 ? Number(argv[topIdx + 1]) || 30 : 30;

if (argv.includes('--json')) {
  console.log(JSON.stringify({ total: rows.reduce((a, r) => a + r.count, 0), rows }, null, 2));
} else if (showIdx >= 0) {
  const want = argv[showIdx + 1];
  const hits = rows.filter((r) => r.key.toLowerCase() === String(want).toLowerCase());
  if (!hits.length) {
    console.log(`没有叫 ${want} 的未支持语句。`);
  } else {
    for (const r of hits) {
      console.log(`${r.key} — ${r.files} 个文件、${r.count} 处`);
      console.log(`  原因：${r.reasons.join('；')}`);
      console.log(`  文件：${r.fileList.join(', ')}`);
      console.log('  样例：');
      for (const s of r.samples) console.log(`    ${s.file}:${s.line}  ${s.text}`);
    }
  }
} else {
  const pad = (s, n) => {
    const str = String(s);
    const w = [...str].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
    return str + ' '.repeat(Math.max(0, n - w));
  };
  console.log(pad('语句名', 26) + pad('文件数', 8) + pad('条数', 6) + '出现位置');
  console.log('-'.repeat(96));
  for (const r of rows.slice(0, topN)) {
    console.log(pad(r.key, 26) + pad(r.files, 8) + pad(r.count, 6) + r.fileList.join(', ').slice(0, 44));
  }
  console.log('-'.repeat(96));
  const total = rows.reduce((a, r) => a + r.count, 0);
  console.log(`未支持语句 ${total} 条，归为 ${rows.length} 类。按「文件数优先、条数次之」排序。`);
  const cover = (n) => {
    let f = 0;
    let c = 0;
    for (const r of rows.slice(0, n)) {
      f += r.files;
      c += r.count;
    }
    return { f, c };
  };
  for (const n of [1, 3, 5, 10]) {
    if (n > rows.length) break;
    const { f, c } = cover(n);
    console.log(`  补前 ${n} 类：覆盖 ${c} 条（${Math.round((c / total) * 100)}%）`);
  }
}
