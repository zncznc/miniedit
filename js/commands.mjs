// 命令注册表。
//
// 命名规则：id 直接沿用 EverEdit 的 cm_* 命令名，快捷键也照抄 key.ini，
// 这样 node tools/ee-audit.mjs 能算出复刻覆盖率，用户按原版键位也能直接上手。
// 只注册真做完了的命令——没实现的宁可在菜单里不出现，也不放个空壳充数。
//
// run(h) 里的 h 由 app.js 提供：
//   h.doc()            当前文档 { text, start, end }
//   h.apply(fn)        fn(doc) → { text, start, end }，改动进撤销栈并重绘
//   h.act(name, arg)   交给 app.js 的既有动作（保存、查找、折叠、缩放…）
//   h.tab()            当前标签
//   h.tabSize()        缩进宽度
//   h.toast(msg)       底部提示

export const COMMANDS = new Map();

// menu: 在菜单里的显示名；keys: 原版快捷键（仅用于展示与分发）
// noBind: 只登记不接管按键（剪切/复制/粘贴交给浏览器原生行为，接管反而容易失灵）
function def(id, menu, keys, run, opts = {}) {
  COMMANDS.set(id, { id, menu, keys: keys || [], run, ...opts });
}

export const commands = () => COMMANDS;
export const command = (id) => COMMANDS.get(id) || null;

// ---------- 文本工具（纯函数，不碰 DOM） ----------

const isWordChar = (c) => !!c && /[A-Za-z0-9_\u4e00-\u9fa5]/.test(c);
const lineStart = (t, i) => t.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (t, i) => {
  const j = t.indexOf('\n', i);
  return j < 0 ? t.length : j;
};

function blockRange(t, s, e) {
  const a = lineStart(t, s);
  const b = lineEnd(t, e > s && t[e - 1] === '\n' ? e - 1 : e);
  return [a, b];
}

function wordAt(t, i) {
  if (!isWordChar(t[i]) && !isWordChar(t[i - 1])) return null;
  let s = i;
  let e = i;
  if (!isWordChar(t[s])) s--;
  while (s > 0 && isWordChar(t[s - 1])) s--;
  while (e < t.length && isWordChar(t[e])) e++;
  return [s, e];
}

// 选区 → 整行范围；没选区就是当前行
function linesOf(d) {
  const [a, b] = blockRange(d.text, d.start, d.end);
  return { a, b, text: d.text.slice(a, b) };
}

// 对选中的每一行做变换，返回新的整段文本
function mapLines(text, fn) {
  return text.split('\n').map(fn).join('\n');
}

// 语言的注释符号：按语法文件名推，推不出来当无注释
const COMMENT = {
  python: ['#', ''], py: ['#', ''],
  bash: ['#', ''], sh: ['#', ''], ruby: ['#', ''], perl: ['#', ''], yaml: ['#', ''],
  ini: [';', ''], conf: ['#', ''], toml: ['#', ''], powershell: ['#', ''], ps1: ['#', ''],
  js: ['//', ''], javascript: ['//', ''], c99: ['//', ''], cpp: ['//', ''], csharp: ['//', ''],
  java: ['//', ''], go: ['//', ''], php: ['//', ''], rust: ['//', ''], mac: ["'", ''],
  sql: ['--', ''], lua: ['--', ''], vbs: ["'", ''], ahk: [';', ''],
  css: ['', ['/*', '*/']], html: ['', ['<!--', '-->']], xml: ['', ['<!--', '-->']],
};

function commentOf(syntax) {
  const key = String(syntax || '').replace(/\.mac$/, '').toLowerCase();
  return COMMENT[key] || ['//', ''];
}

// ---------- 文件 ----------

def('cm_file_new', '新建', ['C+N'], (h) => h.act('new'));
def('cm_file_open', '打开...', ['C+O'], (h) => h.act('open'));
def('cm_file_save', '保存', ['C+S'], (h) => h.act('save'));
def('cm_file_saveas', '另存为...', ['CS+S'], (h) => h.act('save-as'));
def('cm_file_close', '关闭', ['C+W', 'C+F4'], (h) => h.act('close'));
def('cm_file_closeothers', '关闭其它窗口', ['CS+F4'], (h) => h.act('close-others'));
def('cm_file_exit', '退出', ['A+F4'], (h) => h.act('close-all'));
def('cm_file_reload', '重新读取', ['F5'], (h) => h.act('reload'));

// ---------- 剪贴板 ----------

def('cm_edit_cut', '剪切', ['C+X'], (h) => h.act('exec', 'cut'), { noBind: true });
def('cm_edit_copy', '复制', ['C+C'], (h) => h.act('exec', 'copy'), { noBind: true });
def('cm_edit_paste', '粘贴', ['C+V'], (h) => h.act('exec', 'paste'), { noBind: true });
def('cm_edit_copyappend', '复制并追加', ['CS+C'], async (h) => {
  const d = h.doc();
  if (!d || d.start === d.end) return;
  const sel = d.text.slice(d.start, d.end);
  try {
    const old = await navigator.clipboard.readText();
    await navigator.clipboard.writeText((old || '') + sel);
    h.toast(`已追加 ${sel.length} 个字符到剪贴板`);
  } catch {
    h.toast('剪贴板不可读，改用普通复制');
    h.act('exec', 'copy');
  }
});

// ---------- 撤销 ----------

def('cm_edit_undo', '撤消', ['C+Z'], (h) => h.act('undo'));
def('cm_edit_redo', '重做', ['C+Y'], (h) => h.act('redo'));

// ---------- 大小写与对调 ----------

def('cm_edit_toupper', '转为大写', ['C+U'], (h) => h.apply((d) => {
  const [s, e] = d.start === d.end ? (wordAt(d.text, d.start) || [d.start, d.end]) : [d.start, d.end];
  if (s === e) return null;
  return { text: d.text.slice(0, s) + d.text.slice(s, e).toUpperCase() + d.text.slice(e), start: s, end: e };
}));

def('cm_edit_tolower', '转为小写', ['CS+U'], (h) => h.apply((d) => {
  const [s, e] = d.start === d.end ? (wordAt(d.text, d.start) || [d.start, d.end]) : [d.start, d.end];
  if (s === e) return null;
  return { text: d.text.slice(0, s) + d.text.slice(s, e).toLowerCase() + d.text.slice(e), start: s, end: e };
}));

// EverEdit 的「对调」：交换光标两侧的字符，光标右移一格
def('cm_edit_transpose', '对调字符', ['C+T'], (h) => h.apply((d) => {
  const i = d.start;
  if (i <= 0 || i >= d.text.length) return null;
  const a = d.text[i - 1];
  const b = d.text[i];
  return { text: d.text.slice(0, i - 1) + b + a + d.text.slice(i + 1), start: i + 1 };
}));

// ---------- 行操作 ----------

def('cm_edit_duplicateline', '复制当前行', ['C+J'], (h) => h.apply((d) => {
  const { a, b, text } = linesOf(d);
  const ins = `\n${text}`;
  return { text: d.text.slice(0, b) + ins + d.text.slice(b), start: d.start + ins.length, end: d.end + ins.length };
}));

def('cm_edit_joinlines', '合并行', ['CS+J'], (h) => h.apply((d) => {
  const { a, b, text } = linesOf(d);
  if (!text.includes('\n')) return null;
  const joined = text.split('\n').map((l) => l.trim()).join(' ');
  return { text: d.text.slice(0, a) + joined + d.text.slice(b), start: a, end: a + joined.length };
}));

def('cm_delete_line', '删除整行', ['C+L'], (h) => h.apply((d) => {
  const { a, b } = linesOf(d);
  let s = a;
  let e = b;
  if (b < d.text.length) e = b + 1;      // 后面还有行：连这行的换行一起删
  else if (a > 0) s = a - 1;             // 末行没有换行：把上一行末尾的换行删掉
  else return null;
  const text = d.text.slice(0, s) + d.text.slice(e);
  return { text, start: Math.min(s, text.length) };
}));

def('cm_edit_increaseindent', '增加缩进', ['C+I'], (h) => h.apply((d) => {
  const { a, b } = linesOf(d);
  const pad = ' '.repeat(h.tabSize());
  const seg = mapLines(d.text.slice(a, b), (l) => (l ? pad + l : l));
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('cm_edit_decreaseindent', '减少缩进', ['CS+I'], (h) => h.apply((d) => {
  const { a, b } = linesOf(d);
  let n = h.tabSize();
  const seg = mapLines(d.text.slice(a, b), (l) => {
    if (l.startsWith('\t')) return l.slice(1);
    const cut = Math.min(n, (l.match(/^ */) || [''])[0].length);
    return l.slice(cut);
  });
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('cm_edit_linecomment', '行注释 / 取消行注释', ['C+/'], (h) => {
  const tab = h.tab();
  const [lineTok, block] = commentOf(tab && tab.syntax);
  if (!lineTok) {
    h.toast(block[0] ? '这种语法只有块注释，用「块注释」(Ctrl+Shift+/)' : '该语法没有注释定义');
    return;
  }
  h.apply((d) => {
    const { a, b } = linesOf(d);
    const lines = d.text.slice(a, b).split('\n');
    const meaningful = lines.filter((l) => l.trim());
    if (!meaningful.length) return null;
    const allCommented = meaningful.every((l) => l.trim().startsWith(lineTok));
    const seg = lines
      .map((l) => {
        if (!l.trim()) return l;
        if (allCommented) {
          const i = l.indexOf(lineTok);
          const rest = l.slice(i + lineTok.length);
          return l.slice(0, i) + (rest.startsWith(' ') ? rest.slice(1) : rest);
        }
        const indent = (l.match(/^[ \t]*/) || [''])[0];
        return `${indent}${lineTok} ${l.slice(indent.length)}`;
      })
      .join('\n');
    return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
  });
});

def('cm_edit_blockcomment', '块注释 / 取消块注释', ['CS+/'], (h) => {
  const tab = h.tab();
  const [, block] = commentOf(tab && tab.syntax);
  const pair = block && block[0] ? block : ['/*', '*/'];
  h.apply((d) => {
    const s = d.start;
    const e = d.end > d.start ? d.end : lineEnd(d.text, d.start);
    const seg = d.text.slice(s, e);
    const wrapped = seg.startsWith(pair[0]) && seg.endsWith(pair[1]);
    const next = wrapped ? seg.slice(pair[0].length, seg.length - pair[1].length) : `${pair[0]}${seg}${pair[1]}`;
    return { text: d.text.slice(0, s) + next + d.text.slice(e), start: s, end: s + next.length };
  });
});

def('cm_delete_prevword', '向左删除单词', ['C+Backspace'], (h) => h.apply((d) => {
  if (d.start !== d.end) return { text: d.text.slice(0, d.start) + d.text.slice(d.end), start: d.start };
  let s = d.start;
  while (s > 0 && !isWordChar(d.text[s - 1])) s--;
  while (s > 0 && isWordChar(d.text[s - 1])) s--;
  return { text: d.text.slice(0, s) + d.text.slice(d.start), start: s };
}));

def('cm_delete_nextword', '向右删除单词', ['C+Del'], (h) => h.apply((d) => {
  if (d.start !== d.end) return { text: d.text.slice(0, d.start) + d.text.slice(d.end), start: d.start };
  let e = d.start;
  while (e < d.text.length && !isWordChar(d.text[e])) e++;
  while (e < d.text.length && isWordChar(d.text[e])) e++;
  return { text: d.text.slice(0, d.start) + d.text.slice(e), start: d.start };
}));

// ---------- 插入 ----------

def('cm_insert_date', '插入日期时间', ["C+'"], (h) => {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const s = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  h.apply((d) => ({ text: d.text.slice(0, d.start) + s + d.text.slice(d.end), start: d.start + s.length }));
});

def('cm_insert_newlineafter', '在下方插入空行', ['C+Enter'], (h) => h.apply((d) => {
  const e = lineEnd(d.text, d.start);
  const ins = `\n${(d.text.slice(lineStart(d.text, d.start), e).match(/^[ \t]*/) || [''])[0]}`;
  return { text: d.text.slice(0, e) + ins + d.text.slice(e), start: e + ins.length };
}));

def('cm_insert_newlinebefore', '在上方插入空行', ['S+Enter'], (h) => h.apply((d) => {
  const a = lineStart(d.text, d.start);
  const indent = (d.text.slice(a, lineEnd(d.text, a)).match(/^[ \t]*/) || [''])[0];
  const ins = `${indent}\n`;
  return { text: d.text.slice(0, a) + ins + d.text.slice(a), start: a + ins.length };
}));

// ---------- 光标与选择 ----------

def('cm_move_goto', '转到行...', ['C+G'], (h) => h.act('goto'));
def('cm_move_linedown', '下移当前行', ['A+Down'], (h) => h.apply((d) => {
  const { a, b } = linesOf(d);
  const nl = d.text.indexOf('\n', b);
  if (nl < 0) return null;
  const nextEnd = lineEnd(d.text, nl + 1);
  const cur = d.text.slice(a, b);
  const next = d.text.slice(nl + 1, nextEnd);
  const text = d.text.slice(0, a) + next + '\n' + cur + d.text.slice(nextEnd);
  return { text, start: a + next.length + 1, end: a + next.length + 1 + cur.length };
}));
def('cm_move_lineup', '上移当前行', ['A+Up'], (h) => h.apply((d) => {
  const { a, b } = linesOf(d);
  if (a === 0) return null;
  const pa = lineStart(d.text, a - 1);
  const prev = d.text.slice(pa, a - 1);
  const cur = d.text.slice(a, b);
  const text = d.text.slice(0, pa) + cur + '\n' + prev + d.text.slice(b);
  return { text, start: pa, end: pa + cur.length };
}));

// 跳到匹配的括号。只做同一行/全文的简单配对，够用且可预期
const PAIR_OPEN = { '(': ')', '[': ']', '{': '}' };
const PAIR_CLOSE = { ')': '(', ']': '[', '}': '{' };

def('cm_move_brace', '跳到匹配括号', ['C+]'], (h) => {
  const d = h.doc();
  if (!d) return;
  const t = d.text;
  let i = d.start;
  // 光标右边先看，左边再看
  if (!PAIR_OPEN[t[i]] && !PAIR_CLOSE[t[i]]) {
    if (PAIR_OPEN[t[i - 1]] || PAIR_CLOSE[t[i - 1]]) i -= 1;
    else {
      for (let k = d.start; k < Math.min(d.start + 200, t.length); k++) {
        if (PAIR_OPEN[t[k]] || PAIR_CLOSE[t[k]]) { i = k; break; }
      }
    }
  }
  const ch = t[i];
  if (!ch || (!PAIR_OPEN[ch] && !PAIR_CLOSE[ch])) { h.toast('附近没有括号'); return; }
  const forward = !!PAIR_OPEN[ch];
  const open = forward ? ch : PAIR_CLOSE[ch];
  const close = forward ? PAIR_OPEN[ch] : ch;
  let depth = 0;
  if (forward) {
    for (let k = i; k < t.length; k++) {
      if (t[k] === open) depth++;
      else if (t[k] === close && --depth === 0) { h.setSel(k, k); return; }
    }
  } else {
    for (let k = i; k >= 0; k--) {
      if (t[k] === close) depth++;
      else if (t[k] === open && --depth === 0) { h.setSel(k, k); return; }
    }
  }
  h.toast('没有找到匹配的括号');
});

def('cm_select_topair', '选择到匹配括号', ['CS+]'], (h) => {
  const d = h.doc();
  if (!d) return;
  const t = d.text;
  let i = d.start;
  if (!PAIR_OPEN[t[i]] && !PAIR_CLOSE[t[i]]) {
    if (PAIR_OPEN[t[i - 1]] || PAIR_CLOSE[t[i - 1]]) i -= 1;
    else { h.toast('附近没有括号'); return; }
  }
  const ch = t[i];
  const forward = !!PAIR_OPEN[ch];
  const open = forward ? ch : PAIR_CLOSE[ch];
  const close = forward ? PAIR_OPEN[ch] : ch;
  let depth = 0;
  if (forward) {
    for (let k = i; k < t.length; k++) {
      if (t[k] === open) depth++;
      else if (t[k] === close && --depth === 0) { h.setSel(i + 1, k); return; }
    }
  } else {
    for (let k = i; k >= 0; k--) {
      if (t[k] === close) depth++;
      else if (t[k] === open && --depth === 0) { h.setSel(k + 1, i); return; }
    }
  }
  h.toast('没有找到匹配的括号');
});

def('cm_select_topair2', '选择到匹配括号（含括号）', ['CS+['], (h) => {
  const d = h.doc();
  if (!d) return;
  const t = d.text;
  let i = d.start;
  if (!PAIR_OPEN[t[i]] && !PAIR_CLOSE[t[i]]) {
    if (PAIR_OPEN[t[i - 1]] || PAIR_CLOSE[t[i - 1]]) i -= 1;
    else { h.toast('附近没有括号'); return; }
  }
  const ch = t[i];
  const forward = !!PAIR_OPEN[ch];
  const open = forward ? ch : PAIR_CLOSE[ch];
  const close = forward ? PAIR_OPEN[ch] : ch;
  let depth = 0;
  if (forward) {
    for (let k = i; k < t.length; k++) {
      if (t[k] === open) depth++;
      else if (t[k] === close && --depth === 0) { h.setSel(i, k + 1); return; }
    }
  } else {
    for (let k = i; k >= 0; k--) {
      if (t[k] === close) depth++;
      else if (t[k] === open && --depth === 0) { h.setSel(k, i + 1); return; }
    }
  }
  h.toast('没有找到匹配的括号');
});

def('cm_select_word', '选择单词', ['A+W'], (h) => {
  const d = h.doc();
  if (!d) return;
  const r = wordAt(d.text, d.start);
  if (!r) { h.toast('光标不在单词上'); return; }
  h.setSel(r[0], r[1]);
});

def('cm_select_quick', '快速选择（选中光标处单词）', ['C+D'], (h) => {
  const d = h.doc();
  if (!d) return;
  if (d.start !== d.end) { h.toast('已选中，多选留到 P2'); return; }
  const r = wordAt(d.text, d.start);
  if (!r) return;
  h.setSel(r[0], r[1]);
});

def('cm_select_all', '全选', ['C+A'], (h) => h.setSel(0, (h.doc() || { text: '' }).text.length));

// ---------- 排序与清理 ----------

// 有选区排选区，没选区排整个文件
function sortTarget(d) {
  const hasSel = d.end > d.start;
  const [a, b] = hasSel ? blockRange(d.text, d.start, d.end) : [0, d.text.length];
  return { a, b, lines: d.text.slice(a, b).split('\n') };
}

const byText = (x, y) => x.localeCompare(y, 'zh');

def('cm_tool_sortasc', '升序排序', ['F9'], (h) => h.apply((d) => {
  const { a, b, lines } = sortTarget(d);
  if (lines.length < 2) return null;
  const seg = [...lines].sort(byText).join('\n');
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('cm_tool_sortdec', '降序排序', ['S+F9'], (h) => h.apply((d) => {
  const { a, b, lines } = sortTarget(d);
  if (lines.length < 2) return null;
  const seg = [...lines].sort((x, y) => byText(y, x)).join('\n');
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('cm_tool_sort', '排序（升序，同 F9）', ['C+F9'], (h) => COMMANDS.get('cm_tool_sortasc').run(h));

// 下面几条原版在「删除更多 / 扩展」菜单里，没有独立快捷键，这里给它们自己的 id
def('mx_delete_blanklines', '删除空白行', [], (h) => h.apply((d) => {
  const { a, b, lines } = sortTarget(d);
  const kept = lines.filter((l) => l.trim());
  const seg = kept.join('\n');
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('mx_delete_duplicatelines', '删除重复行（保留首次出现）', [], (h) => h.apply((d) => {
  const { a, b, lines } = sortTarget(d);
  const seen = new Set();
  const kept = lines.filter((l) => {
    if (!l.trim()) return true;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
  const seg = kept.join('\n');
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('mx_trim_trailing', '删除行尾空白', [], (h) => h.apply((d) => {
  const { a, b } = sortTarget(d);
  const seg = d.text.slice(a, b).replace(/[ \t]+$/gm, '');
  if (seg === d.text.slice(a, b)) return null;
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

def('mx_align_equals', '按等号对齐', [], (h) => h.apply((d) => {
  const { a, b, lines } = sortTarget(d);
  const rows = lines.map((l) => {
    const i = l.indexOf('=');
    return i < 0 ? null : [l.slice(0, i).replace(/\s+$/, ''), l.slice(i + 1).trim()];
  });
  if (!rows.some(Boolean)) return null;
  const width = Math.max(...rows.filter(Boolean).map((r) => r[0].length));
  const seg = lines
    .map((l, i) => (rows[i] ? `${rows[i][0].padEnd(width)} = ${rows[i][1]}` : l))
    .join('\n');
  return { text: d.text.slice(0, a) + seg + d.text.slice(b), start: a, end: a + seg.length };
}));

// ---------- Base64 ----------

function b64(s, decode) {
  const bytes = new TextEncoder().encode(s);
  if (!decode) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

def('mx_base64_encode', 'Base64 编码选区', [], (h) => h.apply((d) => {
  if (d.start === d.end) return null;
  const s = b64(d.text.slice(d.start, d.end), false);
  return { text: d.text.slice(0, d.start) + s + d.text.slice(d.end), start: d.start, end: d.start + s.length };
}));

def('mx_base64_decode', 'Base64 解码选区', [], (h) => h.apply((d) => {
  const src = d.start === d.end ? d.text : d.text.slice(d.start, d.end);
  const s = b64(src, true);
  const a = d.start;
  return { text: d.text.slice(0, a) + s + d.text.slice(d.start === d.end ? d.text.length : d.end), start: a, end: a + s.length };
}));

// ---------- 查找 ----------

def('cm_find', '查找...', ['C+F'], (h) => h.act('find'));
def('cm_replace', '替换...', ['C+H', 'C+R'], (h) => h.act('replace'));
def('cm_find_next', '查找下一个', ['F3'], (h) => h.act('find-next'));
def('cm_find_prev', '查找上一个', ['S+F3'], (h) => h.act('find-prev'));
def('cm_find_nextword', '查找光标处单词（下一个）', ['C+F3'], (h) => h.act('find-word', 1));
def('cm_find_prevword', '查找光标处单词（上一个）', ['CS+F3'], (h) => h.act('find-word', -1));

// ---------- 折叠 ----------

def('cm_folding_foldall', '折叠全部', ['C+K,C+1'], (h) => h.act('fold-all'));
def('cm_folding_expandall', '展开全部', ['C+K,C+J'], (h) => h.act('unfold-all'));
def('cm_folding_foldcurlevel', '折叠到当前层', ['C+K,C+['], (h) => h.act('fold-cur'));
def('cm_folding_expandcurlevel', '展开当前层', ['C+K,C+]'], (h) => h.act('unfold-cur'));
for (let n = 2; n <= 9; n++) {
  def(`cm_folding_level${n}`, `折叠到第 ${n} 层`, [`C+K,C+${n}`], ((lv) => (h) => h.act('fold-level', lv))(n));
}

// ---------- 书签 ----------

def('cm_marker_toggle', '切换书签', ['C+F2'], (h) => h.act('bookmark-toggle'));
def('cm_marker_next', '下一个书签', ['F2'], (h) => h.act('bookmark-next', 1));
def('cm_marker_prev', '上一个书签', ['S+F2'], (h) => h.act('bookmark-next', -1));

// ---------- 视图 ----------

def('cm_view_zoominfont', '放大字号', ['CS+-', 'C+='], (h) => h.act('zoom-in'));
def('cm_view_zoomoutfont', '缩小字号', ['C+-'], (h) => h.act('zoom-out'));
def('cm_view_defaultfont', '默认字号', ['C+0'], (h) => h.act('zoom-reset'));
def('cm_view_fullscreen', '全屏', ['F11'], (h) => h.act('fullscreen'));
def('cm_view_wrap', '自动换行', [], (h) => h.act('toggle-wrap'));
def('cm_view_gutter', '显示行号', [], (h) => h.act('toggle-gutter'));
def('cm_view_indent', '显示缩进线', [], (h) => h.act('toggle-indent'));

// ---------- 窗口 ----------

def('cm_window_next', '下一个标签', ['C+Tab'], (h) => h.act('tab-next', 1));
def('cm_window_prev', '上一个标签', ['CS+Tab'], (h) => h.act('tab-next', -1));
def('cm_window_last', '切到上一个标签', ['F12'], (h) => h.act('tab-last'));

// ---------- 工具 ----------

def('cm_goto_anything', '命令面板...', ['C+P'], (h) => h.act('palette'));
def('cm_misc_apphelp', '帮助', ['F1'], (h) => h.act('about'));

// ---------- 汇总 ----------

export const COMMAND_LIST = [...COMMANDS.values()];

// 快捷键 → 命令。同一组合被两条命令占用时按注册先后取第一条
export function buildKeyMap() {
  const map = new Map();
  for (const c of COMMAND_LIST) {
    if (c.noBind) continue;
    for (const k of c.keys) {
      if (!map.has(k)) map.set(k, c.id);
    }
  }
  return map;
}
