// EverEdit .mac 语法定义的子集解释器
// 目标：把原版 syntax/*.mac 里声明的规则解析成可执行的规则树，
// 而不是为每门语言手写高亮。无法识别的语句一律记进 errors，由调用方上报为 Unknown。

const TYPE = { PARSER: 'parser', REGION: 'region', ITEM: 'item', WORD: 'word' };

export function makeParser() {
  return {
    kind: TYPE.PARSER,
    color: -1,
    regions: [],
    items: [],
    words: [],
    meta: {},
  };
}

export function makeRegion({ color, start, end, multiLine }) {
  return {
    kind: TYPE.REGION,
    color,
    start,
    end,
    multiline: !!multiLine,
    regions: [],
    items: [],
    words: [],
    meta: {},
  };
}

function makeItem(color, pattern) {
  return { kind: TYPE.ITEM, color, pattern };
}

function makeWord(color, list) {
  const words = new Set();
  for (const w of list.split(/\s+/)) if (w) words.add(w.toLowerCase());
  return { kind: TYPE.WORD, color, words };
}

// .kwd 关键字文件：`;key words` 注释 + 若干段，每段以 `#<颜色>,..` 开头，段内一行一个词。
// php.kwd 就有四段（关键字 / 内置函数 / 再一段关键字 / 魔术常量），颜色各不相同。
function parseKwd(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('#')) {
      const n = Number(line.slice(1).split(',')[0]);
      cur = { color: Number.isFinite(n) ? n : -1, words: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      cur = { color: -1, words: [] };
      sections.push(cur);
    }
    cur.words.push(line);
  }
  return sections;
}

function cloneNode(n) {
  if (n.kind === TYPE.WORD) return { ...n, words: new Set(n.words) };
  if (n.kind === TYPE.ITEM) return { ...n, captures: n.captures ? n.captures.map((c) => ({ ...c })) : undefined };
  if (n.kind === TYPE.REGION) {
    return {
      ...n,
      meta: { ...n.meta },
      regions: n.regions.map(cloneNode),
      items: n.items.map(cloneNode),
      words: n.words.map(cloneNode),
    };
  }
  return { ...n };
}

// ---------- 词法：拆语句 ----------

function parenBalanced(s) {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inStr && s[i + 1] === '"') { i++; continue; } // VBScript 的 "" 转义
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '(') depth++;
    else if (c === ')') depth--;
  }
  return depth <= 0 && !inStr;
}

function splitStatements(src) {
  const lines = String(src).replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let buf = '';
  let startLine = 0;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("'")) continue;
    if (!buf) startLine = n + 1;
    buf = buf ? `${buf} ${line}` : line;
    if (parenBalanced(buf)) { out.push({ text: trimStatementParens(stripTrailingComment(buf)).trim(), line: startLine }); buf = ''; }
  }
  if (buf.trim()) out.push({ text: trimStatementParens(stripTrailingComment(buf)).trim(), line: startLine });
  return out.filter((s) => s.text);
}

function splitArgs(s) {
  const args = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inStr && s[i + 1] === '"') { cur += '""'; i++; continue; }
      inStr = !inStr;
      cur += c;
      continue;
    }
    if (!inStr) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function unquote(lit) {
  const inner = lit.slice(1, -1);
  return inner.replace(/""/g, '"');
}

// 表达式层的 & 拼接（字符串加法），引号内与括号内的不算
function splitTopLevelConcat(s) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inStr && s[i + 1] === '"') { cur += '""'; i++; continue; }
      inStr = !inStr;
      cur += c;
      continue;
    }
    if (!inStr) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === '&' && depth === 0) { parts.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

// 多写一个右括号的语句（ahk_l 里有一处）：去掉不配对的右括号，别让整条作废
function trimStatementParens(s) {
  let depth = 0;
  let inStr = false;
  const extra = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inStr && s[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) extra.push(i); else depth--; }
  }
  if (!extra.length) return s;
  const drop = new Set(extra);
  let out = '';
  for (let i = 0; i < s.length; i++) if (!drop.has(i)) out += s[i];
  return out;
}

// VBScript 的行尾注释：引号外的第一个 ' 之后全是注释
function stripTrailingComment(s) {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inStr && s[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
      continue;
    }
    if (!inStr && c === "'") return s.slice(0, i);
  }
  return s;
}

// `+...+` 在原版里表示“这一串是字面量，不当正则解释”
function toRegExpSource(value) {
  const s = String(value);
  if (s.length > 2 && s.startsWith('+') && s.endsWith('+')) {
    return s.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  // EverEdit 容忍量词里的空格（\w{1, 40}），JS 会当成字面量，这里抹平
  return s.replace(/\{\s*(\d+)\s*,\s*(\d+)\s*\}/g, '{$1,$2}').replace(/\{\s*(\d+)\s*\}/g, '{$1}');
}

function safeRegExp(source, extraFlags = '') {
  try {
    return new RegExp(source, extraFlags);
  } catch {
    return null;
  }
}

// ---------- 正则降级链 ----------
// 原版引擎比 JS 的 RegExp 宽松（还带 PCRE 的递归、条件组），源码里有一批
// JS 直接判为非法的写法。逐级降级把能救的救回来；救不回来的用「永不匹配」
// 占位，让规则树结构完整，避免一处失败连带十几条语句全崩。

function skipClass(src, i) {
  // i 指向 '['
  let j = i + 1;
  if (src[j] === '^') j++;
  if (src[j] === ']') j++;
  for (; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === ']') return j;
  }
  return src.length - 1;
}

function matchParen(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') { j = skipClass(src, j); continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function splitTopLevelAlt(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '[') { const j = skipClass(s, i); cur += s.slice(i, j + 1); i = j; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function groupCount(src) {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { i = skipClass(src, i); continue; }
    if (c !== '(') continue;
    if (src[i + 1] !== '?') { n++; continue; }
    const c2 = src[i + 2];
    if (c2 === '<') {
      if (src[i + 3] === '=' || src[i + 3] === '!') continue; // lookbehind
      n++;
      continue;
    }
    if (c2 === "'" || c2 === 'P') n++;
  }
  return n;
}

// `|?`、`|*`、`|+` —— 定界符后面跟量词，PCRE 报错，原版引擎当字面量。
// 对着色上下文来说「当字面量」也是对的（那里要的就是 ? + * 这几个符号本身）。
function escapeBareQuantifiers(src) {
  let out = '';
  let prev = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] ?? ''); prev = 'x'; i++; continue; }
    if (c === '[') { const j = skipClass(src, i); out += src.slice(i, j + 1); prev = 'x'; i = j; continue; }
    if ((c === '+' || c === '*' || c === '?') && prev === '|') { out += '\\' + c; prev = 'x'; continue; }
    if ((c === '+' || c === '*') && prev === '(') { out += '\\' + c; prev = 'x'; continue; }
    out += c;
    prev = c;
  }
  return out;
}

function dropExtraClosers(src) {
  let depth = 0;
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
    if (c === '[') { const j = skipClass(src, i); out += src.slice(i, j + 1); i = j; continue; }
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) continue; depth--; }
    out += c;
  }
  return out;
}

// (?R) / (?R5) / (?1)：PCRE 的递归调用。降级成「一层不含括号的内容」，
// 单层嵌套（makefile 的 $(...)）完全够用，两层以上会少匹配一点。
function expandRecursion(src) {
  return src.replace(/\(\?R\d*\)/g, '[^()]*').replace(/\(\?\d+\)/g, '[^()]*');
}

// (?(?=X)A|B)：条件组。降级成 (?:A|B)，并把两条分支的捕获组数量补齐，
// 保证后面 Capture n 的组号不错位。
function convertConditionals(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
    if (c === '[') { const j = skipClass(src, i); out += src.slice(i, j + 1); i = j; continue; }
    if (c === '(' && src.startsWith('(?(', i)) {
      const end = matchParen(src, i);
      if (end > 0) {
        const inner = src.slice(i + 2, end); // 跳过 "(?" 之后是断言组 "(?=…)"
        const aEnd = inner.startsWith('(?') ? matchParen(inner, 0) : -1;
        if (aEnd > 0) {
          const parts = splitTopLevelAlt(inner.slice(aEnd + 1));
          const a = parts[0] ?? '';
          const b = parts.slice(1).join('|');
          const ga = groupCount(a);
          const gb = groupCount(b);
          const pa = ga < gb ? a + '()?'.repeat(gb - ga) : a;
          const pb = gb < ga ? b + '()?'.repeat(ga - gb) : b;
          out += `(?:${pa}|${pb})`;
          i = end;
          continue;
        }
      }
    }
    out += c;
  }
  return out;
}

const DEGRADE_STEPS = [
  [escapeBareQuantifiers, '量词跟在定界符后按字面量处理'],
  [dropExtraClosers, '去掉多余的右括号'],
  [expandRecursion, '递归 (?R) 降为一层嵌套'],
  [convertConditionals, '条件组 (?(?=…)) 降为普通分组'],
];

// 返回 { re, source, notes }；re 为 null 表示救不回来
function compilePattern(raw) {
  const base = toRegExpSource(raw);
  const direct = safeRegExp(base);
  if (direct) return { re: direct, source: base, notes: [] };

  let cur = base;
  const notes = [];
  for (const [fn, label] of DEGRADE_STEPS) {
    const next = fn(cur);
    if (next === cur) continue;
    cur = next;
    notes.push(label);
    const re = safeRegExp(cur);
    if (re) return { re, source: cur, notes };
  }
  return { re: null, source: base, notes: [] };
}

const DEAD_PATTERN = '(?!)'; // 永不匹配，用来占位

function deadItem(color) {
  return { kind: TYPE.ITEM, color, pattern: DEAD_PATTERN, dead: true };
}

function deadRegion(color) {
  return { kind: TYPE.REGION, color, start: DEAD_PATTERN, end: '$', multiline: false, regions: [], items: [], words: [], meta: {}, dead: true };
}

// ---------- 表达式求值 ----------

class Evaluator {
  constructor(env, ctx) {
    this.env = env;
    this.ctx = ctx; // { errors }
  }

  fail(stmt, reason) {
    this.ctx.errors.push({ line: stmt.line, text: stmt.text, reason });
    return null;
  }

  // 降级成功：不算错误，但要留下记录，报告里区分「原样理解」和「近似理解」
  note(res, stmt) {
    if (!res.notes.length) return;
    this.ctx.notes.push({ line: stmt.line, text: String(stmt.text).slice(0, 90), reason: res.notes.join('；') });
  }

  // VBScript 的标识符不区分大小写：autolisp 里声明的是 rLine20，用的是 rline20
  get(name) {
    return this.env[String(name).toLowerCase()];
  }

  evalExpr(raw, stmt) {
    let s = String(raw).trim();
    if (!s) return null;
    // 去掉多余的一层括号：AddRegion((CreateRegion(...)))
    while (s.startsWith('(') && s.endsWith(')') && parenBalanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return { t: 'str', v: unquote(s) };
    if (/^(true|false)$/i.test(s)) return { t: 'bool', v: /^true$/i.test(s) };
    if (/^-?\d+$/.test(s)) return { t: 'num', v: Number(s) };

    // & 拼接：SCRIPT_PATH & "\php.kwd"
    const concat = splitTopLevelConcat(s);
    if (concat.length > 1) {
      const vals = concat.map((part) => this.evalExpr(part, stmt));
      if (vals.some((v) => !v)) return null;
      return { t: 'str', v: vals.map((v) => (v.t === 'str' ? v.v : String(v.v))).join('') };
    }

    let m = s.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/s);
    if (m) return this.call(null, m[1], m[2], stmt);

    m = s.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\((.*)\)$/s);
    if (m) {
      const obj = this.get(m[1]);
      if (!obj && !/^createparser$/i.test(m[2])) return this.fail(stmt, `未知对象 ${m[1]}`);
      return this.call(obj || null, m[2], m[3], stmt);
    }

    m = s.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
    if (m) {
      const obj = this.get(m[1]);
      if (!obj) return this.fail(stmt, `未知对象 ${m[1]}`);
      return this.getProp(obj, m[2], stmt);
    }

    if (/^[A-Za-z_]\w*$/.test(s)) {
      const v = this.get(s);
      if (v === undefined) return this.fail(stmt, `未定义标识符 ${s}`);
      if (typeof v === 'number') return { t: 'num', v };
      if (typeof v === 'string') return { t: 'str', v };
      return { t: 'node', v };
    }

    return this.fail(stmt, `无法求值的表达式：${s.slice(0, 60)}`);
  }

  getProp(obj, name, stmt) {
    if (/^defaultregion$/i.test(name) && obj.kind === TYPE.PARSER) return { t: 'node', v: obj };
    return this.fail(stmt, `未支持的属性 ${name}`);
  }

  call(obj, method, argText, stmt) {
    const args = splitArgs(argText || '').map((a) => this.evalExpr(a, stmt));
    const name = method.toLowerCase();
    const num = (i, d = 0) => (args[i] && args[i].t === 'num' ? args[i].v : d);
    const str = (i, d = '') => (args[i] && args[i].t === 'str' ? args[i].v : d);
    const bool = (i, d = false) => (args[i] && args[i].t === 'bool' ? args[i].v : d);
    const node = (i) => (args[i] && args[i].t === 'node' ? args[i].v : null);

    if (!obj) {
      if (name === 'createparser') return { t: 'node', v: makeParser() };
      return this.fail(stmt, `未支持的全局函数 ${method}`);
    }
    if (typeof obj !== 'object') return this.fail(stmt, `对象不是解析器实例，无法调用 ${method}`);

    switch (name) {
      case 'createitem': {
        const res = compilePattern(str(1));
        if (!res.re) {
          this.fail(stmt, `无效正则：${res.source.slice(0, 80)}`);
          return { t: 'node', v: deadItem(num(0, 0)) };
        }
        this.note(res, stmt);
        return { t: 'node', v: makeItem(num(0, 0), res.source) };
      }
      case 'createword':
        return { t: 'node', v: makeWord(num(0, 0), str(1)) };
      case 'createregion': {
        const res = compilePattern(str(1));
        const end = toRegExpSource(str(2));
        if (!res.re) {
          this.fail(stmt, `无效起始正则：${res.source.slice(0, 80)}`);
          return { t: 'node', v: deadRegion(num(0, 0)) };
        }
        this.note(res, stmt);
        // 原版第 4 个参数并不是“是否跨行”：块注释也写成 False。
        // 真正的判据是结束符——以 $ 结尾的只在本行收口，其余可以跨行。
        const multiLine = end.trim() !== '$';
        return { t: 'node', v: makeRegion({ color: num(0, 0), start: res.source, end, multiLine }) };
      }
      case 'createstringregion': {
        const quote = str(1, '"');
        const esc = str(2, '\\');
        const multi = bool(3, false);
        const startRe = (esc ? `(?:${esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?` : '') + quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const endRe = `(?<!\\\\)${quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
        if (!safeRegExp(startRe) || !safeRegExp(endRe)) return this.fail(stmt, '无效字符串区域');
        return { t: 'node', v: makeRegion({ color: num(0, 0), start: startRe, end: endRe, multiLine: multi }) };
      }
      case 'addregion': {
        const n = node(0);
        if (!n || n.kind !== TYPE.REGION) return { t: 'none' };
        if ((obj.kind === TYPE.PARSER || obj.kind === TYPE.REGION) && !obj.regions.includes(n)) obj.regions.push(n);
        return { t: 'none' };
      }
      case 'additem': {
        const n = node(0);
        if (!n || n.kind !== TYPE.ITEM) return { t: 'none' };
        if ((obj.kind === TYPE.PARSER || obj.kind === TYPE.REGION) && !obj.items.includes(n)) obj.items.push(n);
        return { t: 'none' };
      }
      case 'addword': {
        const n = node(0);
        if (!n || n.kind !== TYPE.WORD) return { t: 'none' };
        if ((obj.kind === TYPE.PARSER || obj.kind === TYPE.REGION) && !obj.words.includes(n)) obj.words.push(n);
        return { t: 'none' };
      }
      // AddWordFromFile 区域, "路径.kwd"：关键字表不在 .mac 里，另存一份文本。
      // 文件按 `#<颜色>,..` 分段，每段一个颜色（16 = COLOR_WORD1，12 = COLOR_FUNCTION）。
      case 'addwordfromfile': {
        const target = node(0);
        const file = str(1, '');
        const base = String(file).split(/[\\/]/).pop().toLowerCase();
        const text = this.ctx.fileText(base);
        if (text === undefined) return this.fail(stmt, `AddWordFromFile 找不到 ${base}`);
        const host = target || obj;
        if (!host || (host.kind !== TYPE.REGION && host.kind !== TYPE.PARSER)) return { t: 'none' };
        for (const sec of parseKwd(text)) {
          if (!sec.words.length) continue;
          const w = makeWord(sec.color >= 0 ? sec.color : (host.color ?? 0), sec.words.join(' '));
          host.words.push(w);
        }
        return { t: 'none' };
      }
      // 条目内的捕获组单独着色：x.Capture 1, COLOR_STRING2
      case 'capture': {
        if (obj.kind !== TYPE.ITEM) return this.fail(stmt, 'Capture 只能用在条目上');
        obj.captures = obj.captures || [];
        obj.captures.push({ group: num(0, 1), color: num(1, 0) });
        return { t: 'none' };
      }
      case 'setpairs':
        obj.meta.pairs = str(0, '');
        return { t: 'none' };
      case 'commentline':
        obj.meta.commentLine = str(0, '');
        return { t: 'none' };
      case 'commentblock':
        obj.meta.commentBlock = [str(0, ''), str(1, '')];
        return { t: 'none' };
      case 'foldtext':
        obj.meta.fold = [str(0, ''), str(2, '')];
        return { t: 'none' };
      case 'unfoldtext':
        obj.meta.unfold = [str(0, ''), str(2, '')];
        return { t: 'none' };
      case 'indenttext':
        obj.meta.indent = [str(0, ''), str(2, '')];
        return { t: 'none' };
      case 'unindenttext':
        obj.meta.unindent = [str(0, ''), str(2, '')];
        return { t: 'none' };
      // 复制一个已有区域（用于在别的区域里复用同一段规则）
      case 'copyregion': {
        const n = node(0);
        if (!n || n.kind !== TYPE.REGION) return this.fail(stmt, 'CopyRegion 需要一个区域参数');
        return { t: 'node', v: cloneNode(n) };
      }
      // 与高亮无关（补全/片段/提示），接受但忽略
      case 'addsnippet':
      case 'addcalltip':
      case 'setwordchars':
      case 'setcase':
      case 'foldanytext':
      case 'addautocaseword':
        return { t: 'none' };
      default:
        return this.fail(stmt, `未支持的方法 ${method}`);
    }
  }
}

// ---------- 语句执行 ----------

export function interpret(source, options = {}) {
  const files = options.files || {};
  const errors = [];
  const notes = []; // 降级成功但不影响判定的记录（近似实现）
  const env = Object.create(null);
  const colorTable = Object.create(null); // 索引 -> 常量名
  const procs = new Map(); // 小写的脚本过程名 -> 语句数组（nsis 里的 Sub AddAutoCaseWord）
  let root = null;
  let regionCount = 0;
  let itemCount = 0;
  let wordCount = 0;
  const seen = new Set();

  // VBScript 的标识符不区分大小写，环境变量统一按小写存
  const envGet = (n) => env[String(n).toLowerCase()];
  const envSet = (n, v) => { env[String(n).toLowerCase()] = v; };

  const lowerFiles = Object.create(null);
  for (const k of Object.keys(files)) lowerFiles[k.toLowerCase()] = files[k];
  const fileText = (name) => lowerFiles[String(name).toLowerCase()];

  // 原版内置常量：SCRIPT_PATH 指向语法目录，用来拼 php.kwd 这类外挂词表
  envSet('SCRIPT_PATH', options.scriptPath || 'C:\\Program Files\\EverEdit\\syntax');
  envSet('SCRIPT_NAME', options.file || 'root.mac');

  const ctx = { errors, notes, fileText };

  function run(src, fileName, depth = 0) {
    if (depth > 8) return;
    if (seen.has(fileName)) return;
    seen.add(fileName);

    const statements = splitStatements(src);
    const ev = new Evaluator(env, ctx);

    // 先登记本文件里的 Sub/Function：nsis 的过程定义写在调用之后
    for (let n = 0; n < statements.length; n++) {
      const head = statements[n].text.match(/^(?:Sub|Function)\s+([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/i);
      if (!head) continue;
      const body = [];
      let k = n + 1;
      for (; k < statements.length; k++) {
        if (/^(?:End\s+)?(?:Sub|Function)$/i.test(statements[k].text)) break;
        body.push(statements[k]);
      }
      procs.set(head[1].toLowerCase(), body);
      n = k;
    }

    for (let n = 0; n < statements.length; n++) {
      const stmt = statements[n];
      const text = stmt.text.replace(/^Call\s+(?=[A-Za-z_])/i, '');

      // Sub / Function 块本身不是语法规则，登记过就跳过
      let m = text.match(/^(?:Sub|Function)\s+([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/i);
      if (m) {
        let k = n + 1;
        for (; k < statements.length; k++) {
          if (/^(?:End\s+)?(?:Sub|Function)$/i.test(statements[k].text)) break;
        }
        n = k;
        continue;
      }
      if (/^End\s+(?:Sub|Function)$/i.test(text)) continue; // 落单的结束标记

      m = text.match(/^(?:[A-Za-z_]\w*\.)?Include\s*\(\s*"([^"]*)"\s*\)$/i);
      if (m) {
        const target = m[1].replace(/^\.?[\\/]/, '');
        const next = files[target] ?? fileText(target);
        if (next === undefined) errors.push({ line: stmt.line, text, reason: `Include 找不到 ${target}` });
        else run(next, target, depth + 1);
        continue;
      }

      m = text.match(/^Const\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/i);
      if (m) {
        const val = ev.evalExpr(stripTrailingComment(m[2]), stmt);
        if (val && val.t === 'num') {
          envSet(m[1], val.v);
          if (/^COLOR_/i.test(m[1])) colorTable[val.v] = m[1].replace(/^COLOR_/i, '');
        } else if (val && val.t === 'str') {
          envSet(m[1], val.v);
        }
        continue;
      }

      m = text.match(/^Set\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/i);
      if (m) {
        const val = ev.evalExpr(m[2], stmt);
        if (val && val.t === 'node') {
          envSet(m[1], val.v);
          if (val.v.kind === TYPE.PARSER && !root) root = val.v;
        } else if (val && (val.t === 'num' || val.t === 'str')) {
          envSet(m[1], val.v);
        } else {
          // 求值失败的变量给个死占位：后面 obj.AddItem(它) 不会连带报错
          envSet(m[1], deadItem(0));
        }
        continue;
      }

      m = text.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
      if (m) {
        const val = ev.evalExpr(m[2], stmt);
        if (val && (val.t === 'node' || val.t === 'num' || val.t === 'str')) envSet(m[1], val.v);
        else envSet(m[1], deadItem(0));
        continue;
      }

      // 属性赋值形态：yml.FoldingMethod="indent"
      m = text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
      if (m) {
        const obj = envGet(m[1]);
        if (!obj || typeof obj !== 'object') { errors.push({ line: stmt.line, text, reason: `对象 ${m[1]} 不是解析器实例` }); continue; }
        obj.meta = obj.meta || Object.create(null);
        const val = ev.evalExpr(m[3], stmt);
        if (val) obj.meta[m[2].toLowerCase()] = val.v;
        continue;
      }

      // 无参过程调用：AddAutoCaseWord
      if (/^[A-Za-z_]\w*$/.test(text) && procs.has(text.toLowerCase())) {
        const body = procs.get(text.toLowerCase());
        if (depth < 8) {
          const sub = splitStatements(body.map((b) => b.text).join('\n'));
          for (const s2 of sub) {
            const s2text = s2.text.replace(/^Call\s+(?=[A-Za-z_])/i, '');
            const m2 = s2text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
            if (m2) {
              const obj = envGet(m2[1]);
              if (obj && typeof obj === 'object') {
                const val = ev.evalExpr(m2[3], s2);
                if (val) { obj.meta = obj.meta || Object.create(null); obj.meta[m2[2].toLowerCase()] = val.v; }
              }
              continue;
            }
            const m3 = s2text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\)|\s+([\s\S]+))?$/);
            if (m3) {
              const obj = envGet(m3[1]);
              if (obj) ev.call(obj, m3[2], m3[3] ?? m3[4] ?? '', s2);
              continue;
            }
            errors.push({ line: s2.line, text: s2text.slice(0, 90), reason: '过程体里有未识别的语句' });
          }
        }
        continue;
      }

      m = text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\)|\s+([\s\S]+))?$/);
      if (m) {
        const obj = envGet(m[1]);
        if (!obj) { errors.push({ line: stmt.line, text, reason: `未知对象 ${m[1]}` }); continue; }
        const before = countRules(obj);
        ev.call(obj, m[2], m[3] ?? m[4] ?? '', stmt);
        const after = countRules(obj);
        if (after.regions > before.regions) regionCount++;
        if (after.items > before.items) itemCount++;
        if (after.words > before.words) wordCount++;
        continue;
      }

      errors.push({ line: stmt.line, text: text.slice(0, 90), reason: '未识别的语句形态' });
    }
  }

  function countRules(node) {
    let regions = 0;
    let items = 0;
    let words = 0;
    const walk = (n) => {
      for (const r of n.regions || []) { regions++; walk(r); }
      items += (n.items || []).length;
      words += (n.words || []).length;
    };
    walk(node);
    return { regions, items, words };
  }

  run(String(source), options.file || 'root.mac');

  if (!root) root = makeParser();
  // 有些定义直接把规则挂在 parser 上（没有 DefaultRegion 中转）
  const stats = countRules(root);

  return {
    root,
    errors,
    notes,
    colorTable,
    stats: { ...stats, regionCount, itemCount, wordCount },
  };
}

// 把颜色索引换算成主题里的键名，例如 1 -> Comment1
export function colorKey(colorTable, index) {
  return colorTable[index] || 'Default';
}
