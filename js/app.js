import { interpret } from './core/mac.mjs';
import { parseIni, buildTokenCss, themeVars } from './core/theme.mjs';
import { compile, highlightLines, spansToHtml, escapeHtml } from './core/highlight.mjs';
import { foldRegions, foldMetas, visibleRows } from './core/fold.mjs';

const $ = (id) => document.getElementById(id);
const bridge = window.miniedit || null;

const el = {
  tabs: $('tabs'),
  syntax: $('syntax'),
  theme: $('theme'),
  parseHint: $('parseHint'),
  gutter: $('gutter'),
  gutterInner: $('gutterInner'),
  hl: $('hl'),
  hlInner: $('hlInner'),
  ta: $('ta'),
  actline: $('actline'),
  findbar: $('findbar'),
  findInput: $('findInput'),
  findCount: $('findCount'),
  stPos: $('stPos'),
  stSel: $('stSel'),
  stStats: $('stStats'),
  stEnc: $('stEnc'),
  stEol: $('stEol'),
  stLang: $('stLang'),
};

const state = {
  bundle: null,
  colorTable: {},
  cache: new Map(),
  tabs: [],
  active: -1,
  settings: {},
  themeName: '',
  lastRenderMs: 0,
  gutterSig: '',
  lineHeight: 20,
  padY: 8,
  padX: 14,
  tabSize: 4,
  fontSize: 13,
  zoom: 0,
  wrap: false,
  showGutter: true,
  indentGuides: true,
  // 折叠视图：viewRows 为可见行的真实下标，null 表示未折叠
  viewRows: null,
  viewLineStarts: null,
  realLineStarts: null,
  realToView: null,
  foldActive: false,
};

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);

const ENC_LABEL = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  gbk: 'GBK',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  binary: 'BINARY',
};

const EXT_TO_SYNTAX = {
  c: 'c99.mac', h: 'c99.mac', cpp: 'cpp.mac', cc: 'cpp.mac', hpp: 'cpp.mac',
  js: 'js.mac', mjs: 'js.mac', cjs: 'js.mac', ts: 'js.mac', json: 'js.mac', jsx: 'js.mac',
  py: 'python.mac', pyw: 'python.mac', md: 'markdown.mac', markdown: 'markdown.mac',
  html: 'html.mac', htm: 'html.mac', css: 'css.mac', scss: 'scss.mac', less: 'css_less.mac',
  xml: 'xml.mac', ini: 'ini.mac', cfg: 'ini.mac', yaml: 'yaml.mac', yml: 'yaml.mac',
  sh: 'bash.mac', bash: 'bash.mac', bat: 'bat.mac', cmd: 'bat.mac', ps1: 'powershell.mac',
  sql: 'sql.mac', go: 'go.mac', java: 'java.mac', cs: 'csharp.mac', php: 'php.mac',
  rb: 'ruby.mac', lua: 'lua.mac', tex: 'tex.mac', vim: 'vim.mac', mac: 'mac.mac',
  txt: 'text.mac', log: 'text.mac', conf: 'conf.mac', vbs: 'vbs.mac', ahk: 'ahk.mac',
  asm: 'asm.mac', pas: 'pascal.mac', pl: 'perl.mac', toml: 'ini.mac', gitignore: 'text.mac',
};

function guessSyntax(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_TO_SYNTAX[ext] || 'text.mac';
}

// ---------- 启动 ----------

async function boot() {
  if (bridge) {
    const info = await bridge.boot();
    state.bundle = info.bundle;
    state.zoom = info.zoom || 0;
    state.savedTheme = info.theme || '';
    state.recent = info.recent || [];
    state.version = info.version;
  } else {
    state.bundle = await (await fetch('/api/bundle')).json();
  }

  const constSrc = state.bundle.files['const.mac'] || '';
  state.colorTable = interpret(constSrc, { files: state.bundle.files, file: 'const.mac' }).colorTable;

  parseSettings();
  applySettings();
  fillSyntaxOptions();
  fillThemeOptions();

  const fromSetting = state.settings.EditTheme ? `${state.settings.EditTheme}.ini` : '';
  const preferred = [state.savedTheme, fromSetting, 'EverEdit.ini'].find((n) => n && state.bundle.themes.includes(n));
  await applyTheme(preferred || state.bundle.themes[0]);

  applyZoom();
  bindUi();

  if (bridge) {
    bridge.onMenu(handleMenu);
    bridge.onOpenFiles((paths) => openPaths(paths));
    if (state.recent.length) await openPaths([state.recent[0]]);
    else {
      await openSample('demo.py');
      await openSample('hello.c');
    }
    updateTitle();
  } else {
    // 浏览器模式：留着原来的调试入口
    const params = new URLSearchParams(location.search);
    if (params.has('theme')) await applyTheme(params.get('theme'));
    await openUrl('samples/demo.py', 'demo.py', 'python.mac');
    await openUrl('samples/hello.c', 'hello.c', 'c99.mac');
    if (params.has('ref')) {
      await openRef(params.get('ref'));
      if (params.has('syntax')) setTabSyntax(params.get('syntax'));
    }
    if (params.has('fold')) foldAll();
    if (params.has('about')) showAbout();
  }
}

function parseSettings() {
  const ini = parseIni(state.bundle.settings || '');
  state.settings = { ...(ini.Edit || {}), ...(ini.Setting || {}) };
  const t = Number(state.settings.TabStyle);
  state.tabSize = t > 0 && t < 9 ? t : 4;
}

function applySettings() {
  state.wrap = state.settings.WrapMode === '0';
  state.showGutter = state.settings.LineNumber !== 'N';
  el.gutter.style.display = state.showGutter ? '' : 'none';
  el.actline.classList.toggle('on', state.settings.ActiveLine !== 'N');
  el.hlInner.style.tabSize = String(state.tabSize);
  el.ta.style.tabSize = String(state.tabSize);
  // 缩进线的一格宽度跟着 Tab 宽度走
  el.hlInner.style.setProperty('--step', `${state.tabSize}ch`);
  el.ta.classList.toggle('wrap', state.wrap);
  document.body.classList.toggle('wrap', state.wrap);
}

function fillSyntaxOptions() {
  const frags = fragmentSet();
  const names = state.bundle.syntaxes.filter((n) => !frags.has(n));
  el.syntax.innerHTML = names.map((n) => `<option value="${n}">${n.replace(/\.mac$/, '')}</option>`).join('');
}

function fillThemeOptions() {
  el.theme.innerHTML = state.bundle.themes.map((n) => `<option value="${n}">${n.replace(/\.ini$/, '')}</option>`).join('');
}

// ---------- 主题 ----------

function hexToRgba(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

async function applyTheme(name) {
  const text = state.bundle.themeFiles[name];
  if (!text) return;
  const ini = parseIni(text);
  const v = themeVars(ini);
  document.body.classList.toggle('dark', v.dark);
  const s = document.documentElement.style;
  s.setProperty('--bg', v.bg);
  s.setProperty('--fg', v.fg);
  s.setProperty('--gutter-bg', v.gutterBg);
  s.setProperty('--gutter-fg', v.gutterFg);
  s.setProperty('--active-line', v.activeLine);
  s.setProperty('--caret', v.caret);
  s.setProperty('--sel-bg', hexToRgba(v.selBg, 0.38));

  let style = document.getElementById('tokencss');
  if (!style) {
    style = document.createElement('style');
    style.id = 'tokencss';
    document.head.appendChild(style);
  }
  style.textContent = buildTokenCss(ini, state.colorTable);

  state.themeName = name;
  el.theme.value = name;
  if (bridge) bridge.setTheme(name);
  if (state.active >= 0) render();
}

// ---------- 语法 ----------

function getSyntax(name) {
  if (state.cache.has(name)) return state.cache.get(name);
  const src = state.bundle.files[name];
  if (src === undefined) return null;
  const result = interpret(src, { files: state.bundle.files, file: name });
  const entry = { ...result, compiled: compile(result.root) };
  state.cache.set(name, entry);
  return entry;
}

// ---------- 标签 ----------

function activeTab() {
  return state.tabs[state.active] || null;
}

function makeTab({ name, text, syntax, path, encoding, eol, sample }) {
  return {
    name,
    text,
    syntax: syntax || guessSyntax(name),
    path: path || null,
    encoding: encoding || 'utf-8',
    eol: eol || (/\r\n/.test(text) ? 'CRLF' : 'LF'),
    dirty: false,
    sample: !!sample,
    scrollTop: 0,
    folds: new Set(),
    foldCache: null,
  };
}

function addTab(init) {
  const tab = makeTab(init);
  state.tabs.push(tab);
  state.active = state.tabs.length - 1;
  renderTabs();
  loadActive();
  updateTitle();
  return tab;
}

function renderTabs() {
  el.tabs.innerHTML = state.tabs
    .map((t, i) => `<div class="tab${i === state.active ? ' active' : ''}" data-i="${i}" title="${escapeHtml(t.path || (t.sample ? '示例文件' : '未命名'))}">
      <span class="name">${escapeHtml(t.name)}</span>${t.dirty ? '<span class="dirty">●</span>' : ''}
      <button class="close" title="关闭" data-close="${i}">✕</button>
    </div>`)
    .join('');
}

function loadActive() {
  const tab = activeTab();
  if (!tab) {
    el.ta.value = '';
    el.syntax.value = 'text.mac';
    el.stLang.textContent = '—';
    el.stEnc.value = 'utf-8';
    el.stEol.textContent = '—';
    state.gutterSig = '';
    render();
    updateStatus();
    return;
  }
  el.ta.value = tab.text;
  el.ta.scrollTop = tab.scrollTop || 0;
  el.syntax.value = tab.syntax;
  el.stLang.textContent = tab.syntax.replace(/\.mac$/, '');
  el.stEnc.value = tab.encoding;
  el.stEol.textContent = tab.eol;
  state.gutterSig = '';
  render();
}

function setTabSyntax(name) {
  const tab = activeTab();
  if (!tab) return;
  tab.syntax = name;
  tab.foldCache = null;
  tab.folds.clear();
  el.syntax.value = name;
  el.stLang.textContent = name.replace(/\.mac$/, '');
  state.gutterSig = '';
  render();
}

function activate(i) {
  if (i === state.active) return;
  const prev = activeTab();
  if (prev) prev.scrollTop = el.ta.scrollTop;
  state.active = i;
  renderTabs();
  loadActive();
  updateTitle();
}

async function closeTab(i) {
  const tab = state.tabs[i];
  if (!tab) return true;
  if (tab.dirty && !(await confirmDiscard(tab))) return false;
  state.tabs.splice(i, 1);
  if (state.tabs.length === 0) {
    state.active = -1;
    el.ta.value = '';
    renderTabs();
    loadActive();
    updateTitle();
    return true;
  }
  state.active = Math.min(state.active, state.tabs.length - 1);
  renderTabs();
  loadActive();
  updateTitle();
  return true;
}

async function confirmDiscard(tab) {
  if (bridge) {
    const answer = await bridge.confirmClose(tab.name);
    if (answer === 'save') return await saveActive(false);
    return answer === 'discard';
  }
  return window.confirm(`“${tab.name}” 有未保存的更改，确定放弃吗？`);
}

// ---------- 渲染 ----------

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    render();
  });
}

function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOfOffset(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// 当前语法下的可折叠块；文本或语法一改就重算（tab.text 没变时是同一引用，比对很便宜）
function foldsOf(tab, lines, entry) {
  const cache = tab.foldCache;
  if (cache && cache.text === tab.text && cache.syntax === tab.syntax) return cache;
  const meta = entry && entry.root ? foldMetas(entry.root) : [];
  const regions = foldRegions(lines, meta, state.tabSize);
  const byStart = new Map();
  for (const r of regions) if (!byStart.has(r.start)) byStart.set(r.start, r);
  tab.foldCache = { text: tab.text, syntax: tab.syntax, regions, byStart };
  return tab.foldCache;
}

// 视图偏移 → 真实偏移（未折叠时两者相同）
function realOffsetOfView(viewOffset) {
  if (!state.viewRows) return viewOffset;
  const v = lineOfOffset(state.viewLineStarts, viewOffset);
  const row = state.viewRows[Math.min(v, state.viewRows.length - 1)];
  return state.realLineStarts[row] + (viewOffset - state.viewLineStarts[v]);
}

// 真实偏移 → 视图偏移；落在被折叠行里时退回块首行末
function viewOffsetOfReal(realOffset) {
  if (!state.viewRows) return realOffset;
  const r = lineOfOffset(state.realLineStarts, realOffset);
  const v = state.realToView.get(r);
  if (v === undefined) {
    // 找最近的可见行（往前）
    let lo = 0;
    let hi = state.viewRows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (state.viewRows[mid] <= r) lo = mid;
      else hi = mid - 1;
    }
    // 停在这一可见行的末尾（下一行起点减去换行符）
    const nextStart = lo + 1 < state.viewLineStarts.length ? state.viewLineStarts[lo + 1] - 1 : Infinity;
    return nextStart === Infinity ? el.ta.value.length : nextStart;
  }
  return state.viewLineStarts[v] + (realOffset - state.realLineStarts[r]);
}

function indentGuideHtml(line) {
  if (!state.indentGuides) return '';
  let cols = 0;
  for (const ch of line) {
    if (ch === ' ') cols++;
    else if (ch === '\t') cols += state.tabSize - (cols % state.tabSize);
    else break;
  }
  const levels = Math.floor(cols / state.tabSize);
  if (levels < 1) return '';
  return `<span class="ig" style="width:calc(${levels} * var(--step))"></span>`;
}

function render() {
  const tab = activeTab();
  const lines = tab ? splitLines(tab.text) : [''];
  const entry = tab ? getSyntax(tab.syntax) : null;
  const cap = Math.min(Number(state.settings.ParseMax) || 4000, 4000);

  const t0 = performance.now();
  const spans = entry ? highlightLines(lines, entry.compiled, cap) : null;

  // 折叠：先清掉失效的块，再把折叠块从可见行里去掉
  let rows = null;
  let foldInfo = null;
  if (tab) {
    foldInfo = foldsOf(tab, lines, entry);
    for (const s of [...tab.folds]) if (!foldInfo.byStart.has(s)) tab.folds.delete(s);
    if (tab.folds.size) {
      const vis = visibleRows(lines.length, foldInfo.regions, tab.folds);
      if (vis.rows.length < lines.length) rows = vis.rows;
    }
  }

  state.viewRows = rows;
  state.realLineStarts = lineStarts(tab ? tab.text : '');
  if (rows) {
    const starts = new Array(rows.length);
    const back = new Map();
    let off = 0;
    for (let v = 0; v < rows.length; v++) {
      starts[v] = off;
      back.set(rows[v], v);
      off += lines[rows[v]].length + 1;
    }
    state.viewLineStarts = starts;
    state.realToView = back;
  } else {
    state.viewLineStarts = null;
    state.realToView = null;
  }

  const count = rows ? rows.length : lines.length;
  const parts = new Array(count);
  for (let v = 0; v < count; v++) {
    const r = rows ? rows[v] : v;
    parts[v] = `<div data-real="${r}">${indentGuideHtml(lines[r])}${
      spans ? spansToHtml(lines[r], spans[r]) : escapeHtml(lines[r]) || '&nbsp;'
    }</div>`;
  }
  el.hlInner.innerHTML = parts.join('');

  const foldedSig = tab ? [...tab.folds].join(',') : '';
  const sig = `${count}|${foldedSig}|${foldInfo ? foldInfo.regions.length : 0}`;
  if (state.gutterSig !== sig) {
    const nums = new Array(count);
    for (let v = 0; v < count; v++) {
      const r = rows ? rows[v] : v;
      const region = foldInfo && foldInfo.byStart.get(r);
      const closed = !!region && tab.folds.has(r);
      const tri = region
        ? `<b class="tri" data-fold="${r}" title="${closed ? '展开' : '折叠'} ${region.end - r} 行">${closed ? '▸' : '▾'}</b>`
        : '<b class="tri"></b>';
      nums[v] = `<div${region ? ' class="foldrow"' : ''}>${tri}<span class="ln">${r + 1}</span></div>`;
    }
    el.gutterInner.innerHTML = nums.join('');
    state.gutterSig = sig;
  }

  // 折叠时文本框只装可见行；一改文本就靠 unfoldAll 先还原，绝不会从折叠视图里取正文
  if (rows) {
    const viewText = rows.map((r) => lines[r]).join('\n');
    if (el.ta.value !== viewText) {
      const top = el.ta.scrollTop;
      const anchor = state.foldActive ? realOffsetOfView(el.ta.selectionStart) : 0;
      el.ta.value = viewText;
      el.ta.scrollTop = top;
      const off = state.foldActive ? viewOffsetOfReal(anchor) : 0;
      el.ta.setSelectionRange(off, off);
    }
    state.foldActive = true;
  } else if (state.foldActive) {
    el.ta.value = tab ? tab.text : '';
    state.foldActive = false;
    const pos = Math.min(el.ta.value.length, el.ta.selectionStart);
    el.ta.setSelectionRange(pos, pos);
  }
  state.lastRenderMs = performance.now() - t0;

  syncScroll();
  updateStatus();
  updateParseHint(entry, lines.length, cap);
}

function updateParseHint(entry, lineCount, cap) {
  if (!entry) {
    el.parseHint.innerHTML = '无语法定义 · 纯文本';
    return;
  }
  const s = entry.stats;
  const errs = entry.errors.length;
  const notes = (entry.notes || []).length;
  el.parseHint.innerHTML =
    `规则 <b>${s.regions}</b> 区 / <b>${s.items}</b> 条 → 高亮 <b>${Math.min(lineCount, cap)}</b> 行 · ` +
    (errs ? `<b style="color:#c0392b;cursor:pointer">${errs} 处未支持</b>` : '全部语句已解释') +
    (notes ? ` · <b style="color:#b8860b;cursor:pointer">${notes} 处近似</b>` : '') +
    ` · ${state.lastRenderMs.toFixed(0)} ms`;
  el.parseHint.dataset.errors = String(errs);
  el.parseHint.dataset.notes = String(notes);
}

function syncScroll() {
  const top = el.ta.scrollTop;
  const left = el.ta.scrollLeft;
  el.hlInner.style.transform = `translate(${-left}px, ${-top}px)`;
  el.gutterInner.style.transform = `translateY(${-top}px)`;
  const info = caretInfo();
  const y = state.padY + (info.viewLine - 1) * state.lineHeight - top;
  el.actline.style.transform = `translateY(${y}px)`;
  const current = el.gutterInner.children[info.viewLine - 1];
  if (current) {
    for (const c of el.gutterInner.querySelectorAll('.current')) c.classList.remove('current');
    current.classList.add('current');
  }
}

function caretInfo() {
  const pos = el.ta.selectionStart;
  const before = el.ta.value.slice(0, pos);
  const nl = before.lastIndexOf('\n');
  const viewLine = before.split('\n').length;
  let line = viewLine;
  if (state.viewRows) {
    const r = state.viewRows[Math.min(viewLine - 1, state.viewRows.length - 1)];
    if (r !== undefined) line = r + 1;
  }
  return { pos, viewLine, line, col: pos - nl, selLen: el.ta.selectionEnd - el.ta.selectionStart };
}

function updateStatus() {
  const info = caretInfo();
  const tab = activeTab();
  if (!tab) {
    el.stPos.textContent = '—';
    el.stSel.textContent = '';
    el.stStats.textContent = '';
    el.stEol.textContent = '—';
    el.stEnc.value = 'utf-8';
    return;
  }
  el.stPos.textContent = `行 ${info.line}, 列 ${info.col}`;
  el.stSel.textContent = info.selLen ? `选中 ${info.selLen}` : '';
  const lines = splitLines(tab.text).length;
  const fold = tab.folds && tab.folds.size ? ` · 折叠 ${tab.folds.size} 处` : '';
  el.stStats.textContent = `${lines} 行 · ${tab.text.length} 字符${fold}${tab.sample ? ' · 示例' : ''}`;
  el.stEnc.value = tab.encoding;
  el.stEnc.title = `编码：${ENC_LABEL[tab.encoding] || tab.encoding}（保存时按此写回）`;
  el.stEol.textContent = tab.eol;
}

// ---------- 折叠 ----------

function toggleFold(realLine) {
  const tab = activeTab();
  if (!tab) return;
  if (tab.folds.has(realLine)) tab.folds.delete(realLine);
  else tab.folds.add(realLine);
  render();
  // 光标放到块首行末，便于立刻继续操作
  const v = state.realToView && state.realToView.has(realLine) ? state.realToView.get(realLine) : realLine;
  const starts = state.viewLineStarts || state.realLineStarts;
  const lineText = splitLines(tab.text)[realLine] || '';
  const off = (starts[v] || 0) + lineText.length;
  el.ta.setSelectionRange(off, off);
  syncScroll();
}

function unfoldAll() {
  const tab = activeTab();
  if (!tab || !tab.folds || !tab.folds.size) return;
  const anchor = realOffsetOfView(el.ta.selectionStart);
  tab.folds.clear();
  render();
  const off = viewOffsetOfReal(anchor);
  el.ta.setSelectionRange(off, off);
  syncScroll();
}

function foldAll() {
  const tab = activeTab();
  if (!tab) return;
  const lines = splitLines(tab.text);
  const info = foldsOf(tab, lines, getSyntax(tab.syntax));
  if (!info.regions.length) return;
  // 只折最外层：被别的块包住的直接跳过
  const starts = [];
  let guard = -1;
  for (const r of info.regions) {
    if (r.start <= guard) continue;
    starts.push(r.start);
    guard = r.end;
  }
  tab.folds.clear();
  for (const s of starts) tab.folds.add(s);
  render();
  syncScroll();
}

function updateTitle() {
  if (!bridge) return;
  const tab = activeTab();
  bridge.setTitle(tab ? tab.name : '', state.tabs.some((t) => t.dirty));
}

function touchDirty(flag = true) {
  const tab = activeTab();
  if (!tab) return;
  tab.dirty = flag;
  renderTabs();
  updateTitle();
}

// ---------- 编辑 ----------

function setText(value, selStart, selEnd) {
  const tab = activeTab();
  if (!tab) return;
  tab.text = value;
  tab.foldCache = null;
  el.ta.value = value;
  el.ta.setSelectionRange(selStart, selEnd ?? selStart);
  touchDirty();
  scheduleRender();
}

el.ta.addEventListener('input', () => {
  const tab = activeTab();
  if (!tab) return;
  tab.text = el.ta.value;
  tab.foldCache = null;
  touchDirty();
  scheduleRender();
});

// 折叠视图只是显示层：任何会改文本的动作先把折叠展开，正文永远取自真实文本
el.ta.addEventListener('beforeinput', (e) => {
  if (!state.foldActive) return;
  if (/^(insert|delete)/.test(e.inputType || '')) unfoldAll();
});

el.ta.addEventListener('scroll', syncScroll, { passive: true });
el.ta.addEventListener('keyup', syncScroll);
el.ta.addEventListener('click', syncScroll);

el.ta.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(false); return; }
  if (mod && e.key.toLowerCase() === 'h') { e.preventDefault(); openFind(true); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); e.shiftKey ? saveActive(true) : saveActive(false); return; }
  if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); openGoto(); return; }
  if (mod && e.shiftKey && (e.key === '[' || e.key === '{')) { e.preventDefault(); foldAll(); return; }
  if (mod && e.shiftKey && (e.key === ']' || e.key === '}')) { e.preventDefault(); unfoldAll(); return; }
  if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); addTab({ name: '未命名', text: '', syntax: 'text.mac' }); return; }
  if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(state.active); return; }
  if (e.key === 'Escape' && !el.findbar.hidden) { e.preventDefault(); closeFind(); return; }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }

  // 折叠状态下敲字/回车/删除：先展开（光标位置会映射回真实偏移），再交给浏览器插入
  if (state.foldActive && !mod && !e.altKey) {
    if (e.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(e.key)) unfoldAll();
  }

  const start = el.ta.selectionStart;
  const end = el.ta.selectionEnd;
  const value = el.ta.value;

  if (e.key === 'Tab' && mod) {
    e.preventDefault();
    if (state.tabs.length > 1) {
      const dir = e.shiftKey ? -1 : 1;
      activate((state.active + dir + state.tabs.length) % state.tabs.length);
    }
    return;
  }

  if (e.key === 'Tab' && !mod) {
    e.preventDefault();
    const col = start - value.lastIndexOf('\n', start - 1) - 1;
    const need = state.tabSize - (col % state.tabSize);
    setText(value.slice(0, start) + ' '.repeat(need) + value.slice(end), start + need);
    return;
  }

  if (e.key === 'Enter' && !mod && state.settings.AutoIndent !== 'N') {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineText = value.slice(lineStart, start);
    const indent = (lineText.match(/^[ \t]*/) || [''])[0];
    const opens = /[{\[(]\s*$/.test(lineText);
    const extra = opens ? ' '.repeat(state.tabSize) : '';
    e.preventDefault();
    const insert = `\n${indent}${extra}`;
    setText(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    return;
  }

  if (state.settings.AutoPair !== 'N' && !mod && !e.altKey) {
    if (PAIRS[e.key]) {
      e.preventDefault();
      if (start !== end) {
        const sel = value.slice(start, end);
        const insert = e.key + sel + PAIRS[e.key];
        setText(value.slice(0, start) + insert + value.slice(end), start + 1, start + 1 + sel.length);
      } else {
        const insert = e.key + PAIRS[e.key];
        setText(value.slice(0, start) + insert + value.slice(end), start + 1);
      }
      return;
    }
    if (CLOSERS.has(e.key) && value[start] === e.key && start === end) {
      e.preventDefault();
      el.ta.setSelectionRange(start + 1, start + 1);
      syncScroll();
      return;
    }
  }
});

// ---------- 文件 ----------

function addItem(item, sample = false) {
  const existing = state.tabs.findIndex((t) => t.path && t.path === item.path);
  if (existing >= 0) {
    activate(existing);
    return state.tabs[existing];
  }
  return addTab({
    name: item.name,
    text: item.text,
    syntax: guessSyntax(item.name),
    path: item.path,
    encoding: item.encoding,
    eol: item.eol,
    sample,
  });
}

async function openPaths(paths) {
  if (!bridge) return;
  for (const p of paths) {
    const r = await bridge.readFile(p);
    if (!r.ok) {
      await bridge.showError('打开失败', `${p}\n${r.error}`);
      continue;
    }
    addItem(r.item);
  }
}

async function openSample(name) {
  if (!bridge) return;
  const r = await bridge.sample(name);
  if (!r.ok) return;
  addItem(r.item, true);
}

async function openDialog() {
  if (bridge) {
    const items = await bridge.openDialog();
    for (const item of items) addItem(item);
    return;
  }
  $('fileInput').click();
}

async function saveActive(saveAs) {
  const tab = activeTab();
  if (!tab) return true;

  if (!bridge) {
    const blob = new Blob([tab.text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tab.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    tab.dirty = false;
    renderTabs();
    return true;
  }

  let target = tab.path;
  let saved = null;
  if (!target || saveAs || tab.sample) {
    const r = await bridge.saveDialog({ defaultName: tab.name, text: tab.text, encoding: tab.encoding, eol: tab.eol });
    if (!r.ok) return false;
    saved = r.item;
    target = r.item.path;
    tab.path = target;
    tab.name = target.split(/[\\/]/).pop();
    tab.sample = false;
  } else {
    const r = await bridge.writeFile({ filePath: target, text: tab.text, encoding: tab.encoding, eol: tab.eol });
    if (!r.ok) {
      await bridge.showError('保存失败', r.error);
      return false;
    }
    saved = r.item;
  }

  if (saved && saved.lossy) {
    await bridge.showError(
      '编码装不下部分字符',
      `文件已写入，但 ${ENC_LABEL[tab.encoding] || tab.encoding} 无法表示其中一些字符，它们被写成了 ?。\n\n若要保留原字符，请在状态栏把编码改为 UTF-8 后重新保存。`
    );
  }

  tab.dirty = false;
  renderTabs();
  updateTitle();
  updateStatus();
  return true;
}

async function saveAll() {
  let ok = true;
  for (const tab of state.tabs) {
    if (!tab.dirty) continue;
    const prev = state.active;
    state.active = state.tabs.indexOf(tab);
    renderTabs();
    ok = (await saveActive(false)) && ok;
    state.active = prev;
  }
  renderTabs();
  loadActive();
  updateTitle();
  return ok;
}

function newFile() {
  addTab({ name: '未命名', text: '', syntax: 'text.mac' });
  el.ta.focus();
}

async function openUrl(url, name, syntax) {
  const res = await fetch(url);
  if (!res.ok) return;
  const text = await res.text();
  addTab({ name, text, syntax, path: url });
}

async function openRef(rel) {
  const name = rel.split('/').pop();
  return openUrl('/api/ref?path=' + encodeURIComponent(rel), name, syntaxForRef(rel, name));
}

function syntaxForRef(rel, name) {
  if (rel.startsWith('syntax/') && name.endsWith('.mac')) {
    const base = name.replace(/\.mac$/, '').replace(/_base$/, '');
    if (state.bundle.files[`${base}.mac`]) return `${base}.mac`;
  }
  return guessSyntax(name);
}

function openLocalFiles(fileList) {
  for (const file of fileList) {
    if (bridge && bridge.getPathForFile) {
      const p = bridge.getPathForFile(file);
      if (p) { openPaths([p]); continue; }
    }
    const reader = new FileReader();
    reader.onload = () => addTab({ name: file.name, text: String(reader.result) });
    reader.readAsText(file, 'UTF-8');
  }
}

// ---------- 查找替换 ----------

let findMatches = [];
let findIndex = -1;

function openFind(withReplace) {
  // 查找/替换跑在真实文本上，折叠时先展开
  unfoldAll();
  el.findbar.hidden = false;
  const sel = el.ta.value.slice(el.ta.selectionStart, el.ta.selectionEnd);
  if (sel && !sel.includes('\n')) el.findInput.value = sel;
  el.findInput.focus();
  el.findInput.select();
  if (withReplace) $('replaceInput').focus();
  runFind();
}

function closeFind() {
  el.findbar.hidden = true;
  el.ta.focus();
}

function buildRegex(query) {
  if (!query) return null;
  const flags = 'g' + ($('findCase').checked ? '' : 'i');
  try {
    return $('findRegex').checked ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    return null;
  }
}

function runFind() {
  const query = el.findInput.value;
  findMatches = [];
  findIndex = -1;
  const re = buildRegex(query);
  if (re) {
    const text = el.ta.value;
    let m;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 20000) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      findMatches.push([m.index, m.index + m[0].length]);
    }
  }
  el.findCount.textContent = query ? `${findMatches.length} 个匹配` : '';
}

function jumpTo(dir) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  const [s, e] = findMatches[findIndex];
  el.ta.focus();
  el.ta.setSelectionRange(s, e);
  const before = el.ta.value.slice(0, s);
  const line = before.split('\n').length - 1;
  el.ta.scrollTop = Math.max(0, line * state.lineHeight - el.ta.clientHeight / 2);
  syncScroll();
}

el.findInput.addEventListener('input', runFind);
$('findCase').addEventListener('change', runFind);
$('findRegex').addEventListener('change', runFind);
$('findNext').addEventListener('click', () => jumpTo(1));
$('findPrev').addEventListener('click', () => jumpTo(-1));
$('findClose').addEventListener('click', closeFind);
el.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (!findMatches.length) runFind(); jumpTo(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});

$('replaceOne').addEventListener('click', () => {
  if (!findMatches.length) return;
  const [s, e] = findMatches[Math.max(findIndex, 0)];
  const replacement = $('replaceInput').value;
  const value = el.ta.value;
  setText(value.slice(0, s) + replacement + value.slice(e), s + replacement.length);
  runFind();
});

$('replaceAll').addEventListener('click', () => {
  const query = el.findInput.value;
  const re = buildRegex(query);
  if (!re) return;
  const replacement = $('replaceInput').value;
  const value = el.ta.value;
  let count = 0;
  const next = value.replace(re, () => { count++; return replacement; });
  if (count) setText(next, el.ta.selectionStart);
  runFind();
  el.findCount.textContent = `已替换 ${count} 处`;
});

// ---------- 转到行 ----------

function openGoto() {
  const tab = activeTab();
  if (!tab) return;
  unfoldAll();
  const total = splitLines(tab.text).length;
  $('gotoRange').textContent = `共 ${total} 行`;
  const input = $('gotoInput');
  input.max = String(total);
  input.value = String(caretInfo().line);
  $('gotoDlg').showModal();
  input.focus();
  input.select();
}

function doGoto() {
  const tab = activeTab();
  if (!tab) return;
  const total = splitLines(tab.text).length;
  const line = Math.max(1, Math.min(total, Number($('gotoInput').value) || 1));
  const lines = splitLines(tab.text);
  let pos = 0;
  for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
  el.ta.focus();
  el.ta.setSelectionRange(pos, pos);
  el.ta.scrollTop = Math.max(0, (line - 1) * state.lineHeight - el.ta.clientHeight / 2);
  syncScroll();
  $('gotoDlg').close();
}

// ---------- 视图 ----------

function applyZoom() {
  state.fontSize = Math.max(9, Math.min(30, 13 + state.zoom));
  state.lineHeight = Math.round(state.fontSize * 1.545);
  document.documentElement.style.setProperty('--font-size', `${state.fontSize}px`);
  document.documentElement.style.setProperty('--line-height', `${state.lineHeight}px`);
  if (bridge) bridge.setZoom(state.zoom);
  if (state.active >= 0) render();
}

function toggleFullscreen() {
  document.body.classList.toggle('fullscreen');
  if (!bridge && document.fullscreenElement) document.exitFullscreen();
  else if (!bridge && document.body.classList.contains('fullscreen')) document.documentElement.requestFullscreen?.();
}

// ---------- 对照说明 ----------

const ABOUT_ROWS = [
  ['标签页 / 多文档', '已实现', '新建、打开、保存、另存为、最近打开'],
  ['行号、当前行、括号配对', '已实现', '开关读自 setting.ini 的 LineNumber / ActiveLine / AutoPair'],
  ['语法定义', '数据驱动', '直接解释原版 syntax/*.mac，不重写规则'],
  ['配色方案', '数据驱动', '直接读原版 theme/*.ini，选择会被记住'],
  ['编码', '已实现', '打开时识别 UTF-8 / BOM / UTF-16 / GBK，保存按状态栏所选写回'],
  ['行尾', '已实现', '识别 LF / CRLF / CR，点状态栏可转换'],
  ['查找替换（含正则）', '已实现', 'Ctrl+F / Ctrl+H'],
  ['自动缩进 / 自动配对', '已实现', 'AutoIndent、AutoPair 取自 setting.ini'],
  ['十六进制视图', '未实现', '原版由 hexedit.dll 提供'],
  ['文件树 / 侧栏', '未实现', '原版由 shelltree.dll 提供'],
  ['代码折叠', '已实现', 'FoldText / IndentText / FoldingMethod 优先，缺声明按缩进兜底'],
  ['缩进线', '已实现', '按 Tab 宽度在每级缩进处画线，可在查看菜单开关'],
  ['宏 / 脚本扩展', '未实现', '原版用 .esm 模式与 JS 宏'],
];

function showAbout() {
  const frags = fragmentSet();
  const topLevel = state.bundle.syntaxes.filter((n) => !frags.has(n));
  let ok = 0;
  let errs = 0;
  for (const name of topLevel) {
    const e = getSyntax(name);
    if (e && e.errors.length === 0) ok++;
    errs += e ? e.errors.length : 0;
  }
  const rows = ABOUT_ROWS.map(([k, s, n]) => `<tr><td>${k}</td><td>${s}</td><td>${n}</td></tr>`).join('');
  $('aboutBody').innerHTML = `
    <p>这一版不重写高亮规则：它把原版的分发文件当成自己的配置来读，因此“像不像”可以直接量。</p>
    <ul>
      <li>语法定义：${topLevel.length} 个独立语法（另有 ${frags.size} 个片段文件被 Include 复用），其中 <b>${ok}</b> 个可被解释器完整加载，累计 <b>${errs}</b> 条语句未支持。</li>
      <li>配色：<b>${state.bundle.themes.length}</b> 套 .ini 全部可用，当前 <b>${state.themeName}</b>。</li>
      <li>设置：已读取 setting.ini 的 ${Object.keys(state.settings).length} 个键。</li>
      ${bridge ? `<li>版本：MiniEdit ${state.version}（桌面版）</li>` : ''}
    </ul>
    <table><thead><tr><th>能力</th><th>状态</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  $('aboutDlg').showModal();
}

let fragmentCache = null;
function fragmentSet() {
  if (fragmentCache) return fragmentCache;
  const frags = new Set(['const.mac']);
  for (const src of Object.values(state.bundle.files)) {
    const re = /Include\s*\(\s*"\.?\\([^"]+)"\s*\)/gi;
    let m;
    while ((m = re.exec(src))) frags.add(m[1].split(/[\\/]/).pop());
  }
  fragmentCache = frags;
  return frags;
}

// ---------- 菜单动作 ----------

async function handleMenu(action, arg) {
  switch (action) {
    case 'new': newFile(); break;
    case 'open': await openDialog(); break;
    case 'open-path': await openPaths([arg]); break;
    case 'save': await saveActive(false); break;
    case 'save-as': await saveActive(true); break;
    case 'save-all': await saveAll(); break;
    case 'close': await closeTab(state.active); break;
    case 'close-all': {
      while (state.tabs.length) {
        if (!(await closeTab(0))) break;
      }
      break;
    }
    case 'check-close': {
      for (let i = 0; i < state.tabs.length; i++) {
        const tab = state.tabs[i];
        if (!tab.dirty) continue;
        state.active = i;
        renderTabs();
        loadActive();
        if (!(await confirmDiscard(tab))) return;
      }
      await bridge.close();
      break;
    }
    case 'find': openFind(false); break;
    case 'replace': openFind(true); break;
    case 'goto': openGoto(); break;
    case 'fold-all': foldAll(); break;
    case 'unfold-all': unfoldAll(); break;
    case 'toggle-indent':
      state.indentGuides = !state.indentGuides;
      if (bridge && bridge.setIndentGuides) bridge.setIndentGuides(state.indentGuides);
      render();
      break;
    case 'zoom-in': state.zoom = Math.min(17, state.zoom + 1); applyZoom(); break;
    case 'zoom-out': state.zoom = Math.max(-4, state.zoom - 1); applyZoom(); break;
    case 'zoom-reset': state.zoom = 0; applyZoom(); break;
    case 'toggle-wrap':
      state.wrap = !state.wrap;
      el.ta.classList.toggle('wrap', state.wrap);
      document.body.classList.toggle('wrap', state.wrap);
      if (state.wrap) el.ta.setAttribute('wrap', 'soft'); else el.ta.setAttribute('wrap', 'off');
      render();
      break;
    case 'toggle-gutter':
      state.showGutter = !state.showGutter;
      el.gutter.style.display = state.showGutter ? '' : 'none';
      break;
    case 'focus-syntax': el.syntax.focus(); break;
    case 'toggle-fullscreen': toggleFullscreen(); break;
    case 'compare': showAbout(); break;
    case 'about': showAbout(); break;
    default: break;
  }
}

// ---------- 事件绑定 ----------

function bindUi() {
  el.tabs.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { closeTab(Number(closeBtn.dataset.close)); return; }
    const tabEl = e.target.closest('.tab');
    if (tabEl) activate(Number(tabEl.dataset.i));
  });

  // 中键关闭
  el.tabs.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tabEl = e.target.closest('.tab');
    if (tabEl) closeTab(Number(tabEl.dataset.i));
  });

  el.syntax.addEventListener('change', () => setTabSyntax(el.syntax.value));
  el.theme.addEventListener('change', () => applyTheme(el.theme.value));

  $('btnNew').addEventListener('click', newFile);
  $('btnOpen').addEventListener('click', openDialog);
  $('btnSave').addEventListener('click', () => saveActive(false));
  $('btnSaveAs').addEventListener('click', () => saveActive(true));
  $('fileInput').addEventListener('change', (e) => { openLocalFiles(e.target.files); e.target.value = ''; });
  $('btnFind').addEventListener('click', () => openFind(false));
  $('btnFold').addEventListener('click', () => foldAll());
  $('btnUnfold').addEventListener('click', () => unfoldAll());

  // 行号栏上的三角：切换该块折叠
  el.gutter.addEventListener('click', (e) => {
    const tri = e.target.closest('[data-fold]');
    if (tri) toggleFold(Number(tri.dataset.fold));
  });

  el.stEnc.addEventListener('change', () => {
    const tab = activeTab();
    if (!tab) return;
    tab.encoding = el.stEnc.value;
    touchDirty();
    updateStatus();
  });

  el.stEol.addEventListener('click', () => {
    const tab = activeTab();
    if (!tab) return;
    tab.eol = tab.eol === 'CRLF' ? 'LF' : 'CRLF';
    el.stEol.textContent = tab.eol;
    touchDirty();
    updateStatus();
  });

  el.parseHint.addEventListener('click', () => {
    const tab = activeTab();
    const entry = tab && getSyntax(tab.syntax);
    if (!entry) return;
    if (!entry.errors.length) {
      const notes = entry.notes || [];
      $('errTitle').textContent = notes.length ? `全部语句已解释（${notes.length} 处近似）` : '全部语句已解释';
      const head = `<p>${tab.syntax} 里没有未支持的语句。规则数：${entry.stats.regions} 个区域、${entry.stats.items} 个条目、${entry.stats.words} 组关键字。</p>`;
      const body = notes.length
        ? '<p>下面这些语句原版引擎能直接吃，JS 的正则要吃就得降一级——按「近似实现」记，不算 Unknown：</p><ul>' +
          notes.map((n) => `<li>第 ${n.line} 行 · ${escapeHtml(n.reason)}<br><code>${escapeHtml(n.text)}</code></li>`).join('') + '</ul>'
        : '';
      $('errBody').innerHTML = head + body;
    } else {
      $('errTitle').textContent = `${tab.syntax}：${entry.errors.length} 处未支持`;
      $('errBody').innerHTML = '<p>这些语句被跳过，对应规则不会生效——按证据纪律，它们属于 Unknown，而不是“不存在”：</p><ul>' +
        entry.errors.slice(0, 200).map((e) => `<li>第 ${e.line} 行 · ${escapeHtml(e.reason)}<br><code>${escapeHtml(e.text)}</code></li>`).join('') + '</ul>';
    }
    $('errDlg').showModal();
  });

  $('btnAbout').addEventListener('click', showAbout);
  $('aboutClose').addEventListener('click', () => $('aboutDlg').close());
  $('aboutOk').addEventListener('click', () => $('aboutDlg').close());
  $('errClose').addEventListener('click', () => $('errDlg').close());
  $('errOk').addEventListener('click', () => $('errDlg').close());

  $('gotoOk').addEventListener('click', doGoto);
  $('gotoCancel').addEventListener('click', () => $('gotoDlg').close());
  $('gotoClose').addEventListener('click', () => $('gotoDlg').close());
  $('gotoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doGoto(); }
  });

  window.addEventListener('resize', syncScroll);
  document.addEventListener('dragstart', (e) => e.preventDefault());
}

document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) openLocalFiles(e.dataTransfer.files);
});

boot().catch((err) => {
  document.body.innerHTML = `<pre style="padding:24px;font:13px Consolas,monospace;color:#b00">启动失败：${escapeHtml(String((err && err.stack) || err))}</pre>`;
});
