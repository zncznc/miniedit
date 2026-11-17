// 用解释出来的规则树做逐行高亮。
// 规则优先级：当前区域结束符 → 子区域开始 → 子条目 → 关键字 → 纯文本

function rx(source, flags = 'y') {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function compile(root) {
  const prep = (node) => {
    const wordMap = new Map();
    for (const w of node.words || []) {
      for (const x of w.words) wordMap.set(x, w.color);
    }
    return {
      color: typeof node.color === 'number' ? node.color : -1,
      startRe: node.start ? rx(node.start) : null,
      endRe: node.end ? rx(node.end) : null,
      multiline: !!node.multiline,
      items: (node.items || []).map((it) => ({
        color: it.color,
        re: rx(it.pattern, 'dy'),
        captures: it.captures || null,
      })),
      regions: (node.regions || []).map(prep),
      wordMap,
    };
  };
  return prep(root);
}

const WORD_RUN = /[A-Za-z0-9_$\u00c0-\uffff]+/y;
const WORD_START = /[A-Za-z_$\u00c0-\uffff]/;
const WORD_TAIL = /[A-Za-z0-9_$\u00c0-\uffff]/;

export function tokenizeLine(line, stack, root) {
  const spans = [];
  const len = line.length;
  let i = 0;
  let curColor = stack.length ? stack[stack.length - 1].color : -1;
  let curStart = 0;

  const setColor = (c, at) => {
    if (c === curColor) return;
    if (curColor >= 0 && at > curStart) spans.push([curStart, at, curColor]);
    curColor = c;
    curStart = at;
  };

  while (i < len) {
    const here = stack.length ? stack[stack.length - 1] : root;
    let handled = false;

    if (stack.length && here.endRe) {
      here.endRe.lastIndex = i;
      const m = here.endRe.exec(line);
      if (m && m[0].length) {
        i += m[0].length;
        stack.pop();
        setColor(stack.length ? stack[stack.length - 1].color : -1, i);
        continue;
      }
    }

    for (const r of here.regions) {
      if (!r.startRe) continue;
      r.startRe.lastIndex = i;
      const m = r.startRe.exec(line);
      if (!m || !m[0].length) continue;
      const startAt = i;
      if (r.multiline) {
        setColor(r.color, startAt);
        i = startAt + m[0].length;
        stack.push(r);
      } else {
        let endAt = len;
        if (r.endRe) {
          r.endRe.lastIndex = startAt + m[0].length;
          const e = r.endRe.exec(line);
          if (e && e[0].length) endAt = r.endRe.lastIndex;
        }
        setColor(r.color, startAt);
        i = endAt;
        setColor(here === root ? -1 : here.color, i);
      }
      handled = true;
      break;
    }
    if (handled) continue;

    for (const it of here.items) {
      if (!it.re) continue;
      it.re.lastIndex = i;
      const m = it.re.exec(line);
      if (!m || !m[0].length) continue;
      const startAt = i;
      const endAt = startAt + m[0].length;

      if (it.captures && it.captures.length && m.indices) {
        const segs = [];
        let cursor = startAt;
        const ordered = it.captures
          .map((c) => ({ color: c.color, range: m.indices[c.group] }))
          .filter((c) => c.range && c.range[0] >= startAt && c.range[1] <= endAt)
          .sort((a, b) => a.range[0] - b.range[0]);
        for (const c of ordered) {
          if (c.range[0] > cursor) segs.push({ color: it.color, from: cursor, to: c.range[0] });
          segs.push({ color: c.color, from: c.range[0], to: c.range[1] });
          cursor = c.range[1];
        }
        if (cursor < endAt) segs.push({ color: it.color, from: cursor, to: endAt });
        for (const s of segs) setColor(s.color, s.from);
      } else {
        setColor(it.color, startAt);
      }

      i = endAt;
      setColor(here.color, i);
      handled = true;
      break;
    }
    if (handled) continue;

    const ch = line[i];
    if (WORD_START.test(ch) && (i === 0 || !WORD_TAIL.test(line[i - 1]))) {
      WORD_RUN.lastIndex = i;
      const m = WORD_RUN.exec(line);
      if (m) {
        const color = here.wordMap.get(m[0].toLowerCase());
        if (color !== undefined) {
          setColor(color, i);
          i += m[0].length;
          setColor(here.color, i);
          handled = true;
        }
      }
    }
    if (handled) continue;

    setColor(here.color, i);
    i++;
  }

  // 行尾：`$` 结尾的区域（单行注释）在这一行收口
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!top.endRe) break;
    top.endRe.lastIndex = len;
    const m = top.endRe.exec(line);
    if (m && m[0].length === 0) stack.pop();
    else break;
  }

  if (curColor >= 0 && len > curStart) spans.push([curStart, len, curColor]);
  return spans;
}

export function highlightLines(lines, root, maxLines = 4000) {
  const stack = [];
  const out = new Array(lines.length);
  const limit = Math.min(lines.length, maxLines);
  for (let n = 0; n < lines.length; n++) {
    if (n >= limit) { out[n] = null; continue; }
    out[n] = tokenizeLine(lines[n], stack, root);
  }
  return out;
}

export function spansToHtml(line, spans) {
  if (!spans || !spans.length) return escapeHtml(line) || '&nbsp;';
  let html = '';
  let pos = 0;
  for (const [start, end, color] of spans) {
    if (start > pos) html += escapeHtml(line.slice(pos, start));
    html += `<span class="t${color}">${escapeHtml(line.slice(start, end))}</span>`;
    pos = end;
  }
  if (pos < line.length) html += escapeHtml(line.slice(pos));
  return html || '&nbsp;';
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
