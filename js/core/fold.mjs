// 折叠区间计算：优先用语法文件自己声明的规则，没声明就按缩进兜底。
//
// 数据来源（都在 .mac 里，解析结果在 root.meta）：
//   FoldText "<[...]>", False        → meta.fold[0]      配对法：开始模式
//   UnfoldText "</[...]>"            → meta.unfold[0]    配对法：结束模式
//   IndentText "\{\s*$", False, "^}$"→ meta.indent      缩进法：开始模式
//   FoldingMethod="indent"           → meta.foldingmethod
//
// 返回 [{ start, end }]，0 基、闭区间、end > start。end 是最后一行被收进块里的行。

function toRe(src) {
  if (!src) return null;
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

function indentCols(line, tabSize) {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += tabSize - (n % tabSize);
    else break;
  }
  return n;
}

// 从 i 往下找同块的最后一行：空行跳过，缩进不深于基准就收尾
function indentEnd(lines, i, indents) {
  const base = indents[i];
  let end = i;
  for (let k = i + 1; k < lines.length; k++) {
    if (!lines[k].trim()) continue;
    if (indents[k] > base) end = k;
    else break;
  }
  return end;
}

function pairRegions(lines, startRe, endRe, tabSize) {
  const out = [];
  const stack = [];
  let indents = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const closes = !!endRe && endRe.test(line);
    if (closes && stack.length) {
      const s = stack.pop();
      if (i > s) out.push({ start: s, end: i });
    }
    if (startRe && startRe.test(line) && !closes) stack.push(i);
  }
  // 到文件末尾都没收口的块：按缩进收尾，不把整个文件吞进去
  if (stack.length) {
    indents = indents || lines.map((l) => indentCols(l, tabSize));
    for (const s of stack) {
      const e = indentEnd(lines, s, indents);
      if (e > s) out.push({ start: s, end: e });
    }
  }
  return out;
}

function indentRegions(lines, tabSize, startRe) {
  const indents = lines.map((l) => indentCols(l, tabSize));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (startRe && !startRe.test(lines[i])) continue;
    const end = indentEnd(lines, i, indents);
    if (end > i) out.push({ start: i, end });
  }
  return out;
}

// 折叠声明不总在根上：php.mac 的根是 html 解析器（按标签折），PHP 代码的 `{` 规则挂在
// `rPhp` 区域上。所以把整棵树上的声明都收集起来，按「根优先、声明先后」的顺序试。
export function foldMetas(root) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    const m = (n && n.meta) || {};
    const has = (m.fold && m.fold[0]) || (m.indent && m.indent[0]) || m.foldingmethod;
    if (has) {
      const key = JSON.stringify([m.fold, m.unfold, m.indent, m.foldingmethod]);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    }
    for (const r of n.regions || []) walk(r);
  };
  walk(root);
  return out;
}

export function foldRegions(lines, metaOrList, tabSize = 4) {
  if (!Array.isArray(lines) || lines.length < 2) return [];
  const metas = Array.isArray(metaOrList) ? metaOrList : [metaOrList || {}];
  if (!metas.length) metas.push({});

  let regions = [];
  let usedDeclaration = false;
  for (const m of metas) {
    const foldStart = toRe(m.fold && m.fold[0]);
    const foldEnd = toRe((m.fold && m.fold[1]) || (m.unfold && m.unfold[0]));
    const indentStart = toRe(m.indent && m.indent[0]);
    const method = String(m.foldingmethod || '').toLowerCase();
    if (!foldStart && !indentStart && method !== 'indent') continue;
    const got = foldStart
      ? pairRegions(lines, foldStart, foldEnd, tabSize)
      : indentRegions(lines, tabSize, indentStart);
    if (got.length) {
      regions = got;
      usedDeclaration = true;
      break;
    }
  }

  if (!usedDeclaration) {
    // 该语法没声明折叠规则：按缩进兜底，并在界面上标明是兜底
    regions = indentRegions(lines, tabSize, null);
  }

  // 去掉重叠里被完全包住的内层？不——保留嵌套，折叠时外层优先
  regions.sort((a, b) => a.start - b.start || b.end - a.end);
  return regions;
}

// 把"已折叠的块"套到行列表上，返回可见行的真实下标
export function visibleRows(lineCount, regions, collapsed) {
  const byStart = new Map();
  for (const r of regions) if (!byStart.has(r.start)) byStart.set(r.start, r);
  const skip = new Map();
  for (const s of collapsed) {
    const r = byStart.get(s);
    if (r) skip.set(r.start, r.end);
  }
  const rows = [];
  for (let i = 0; i < lineCount; ) {
    rows.push(i);
    i = skip.has(i) ? skip.get(i) + 1 : i + 1;
  }
  return { rows, byStart, skip };
}
