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
    if (parenBalanced(buf)) { out.push({ text: stripTrailingComment(buf).trim(), line: startLine }); buf = ''; }
  }
  if (buf.trim()) out.push({ text: stripTrailingComment(buf).trim(), line: startLine });
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

  evalExpr(raw, stmt) {
    let s = String(raw).trim();
    if (!s) return null;
    // 去掉多余的一层括号：AddRegion((CreateRegion(...)))
    while (s.startsWith('(') && s.endsWith(')') && parenBalanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return { t: 'str', v: unquote(s) };
    if (/^(true|false)$/i.test(s)) return { t: 'bool', v: /^true$/i.test(s) };
    if (/^-?\d+$/.test(s)) return { t: 'num', v: Number(s) };

    let m = s.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/s);
    if (m) return this.call(null, m[1], m[2], stmt);

    m = s.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\((.*)\)$/s);
    if (m) {
      const obj = this.env[m[1]];
      if (!obj && !/^createparser$/i.test(m[2])) return this.fail(stmt, `未知对象 ${m[1]}`);
      return this.call(obj || null, m[2], m[3], stmt);
    }

    m = s.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
    if (m) {
      const obj = this.env[m[1]];
      if (!obj) return this.fail(stmt, `未知对象 ${m[1]}`);
      return this.getProp(obj, m[2], stmt);
    }

    if (/^[A-Za-z_]\w*$/.test(s)) {
      const v = this.env[s];
      if (v === undefined) return this.fail(stmt, `未定义标识符 ${s}`);
      if (typeof v === 'number') return { t: 'num', v };
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
        const pattern = toRegExpSource(str(1));
        if (!safeRegExp(pattern)) return this.fail(stmt, `无效正则：${pattern.slice(0, 80)}`);
        return { t: 'node', v: makeItem(num(0, 0), pattern) };
      }
      case 'createword':
        return { t: 'node', v: makeWord(num(0, 0), str(1)) };
      case 'createregion': {
        const start = toRegExpSource(str(1));
        const end = toRegExpSource(str(2));
        if (!safeRegExp(start)) return this.fail(stmt, `无效起始正则：${start.slice(0, 80)}`);
        // 原版第 4 个参数并不是“是否跨行”：块注释也写成 False。
        // 真正的判据是结束符——以 $ 结尾的只在本行收口，其余可以跨行。
        const multiLine = end.trim() !== '$';
        return { t: 'node', v: makeRegion({ color: num(0, 0), start, end, multiLine }) };
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
        if (obj.kind === TYPE.PARSER || obj.kind === TYPE.REGION) obj.regions.push(n);
        return { t: 'none' };
      }
      case 'additem': {
        const n = node(0);
        if (!n || n.kind !== TYPE.ITEM) return { t: 'none' };
        if (obj.kind === TYPE.PARSER || obj.kind === TYPE.REGION) obj.items.push(n);
        return { t: 'none' };
      }
      case 'addword': {
        const n = node(0);
        if (!n || n.kind !== TYPE.WORD) return { t: 'none' };
        if (obj.kind === TYPE.PARSER || obj.kind === TYPE.REGION) obj.words.push(n);
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
  const env = Object.create(null);
  const colorTable = Object.create(null); // 索引 -> 常量名
  let root = null;
  let regionCount = 0;
  let itemCount = 0;
  let wordCount = 0;
  const seen = new Set();

  function run(src, fileName, depth = 0) {
    if (depth > 8) return;
    if (seen.has(fileName)) return;
    seen.add(fileName);

    const statements = splitStatements(src);
    const ev = new Evaluator(env, { errors });

    for (const stmt of statements) {
      const text = stmt.text.replace(/^Call\s+(?=[A-Za-z_])/i, '');

      let m = text.match(/^(?:[A-Za-z_]\w*\.)?Include\s*\(\s*"([^"]*)"\s*\)$/i);
      if (m) {
        const target = m[1].replace(/^\.?[\\/]/, '');
        const next = files[target] ?? files[target.toLowerCase()];
        if (next === undefined) errors.push({ line: stmt.line, text, reason: `Include 找不到 ${target}` });
        else run(next, target, depth + 1);
        continue;
      }

      m = text.match(/^Const\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/i);
      if (m) {
        const val = ev.evalExpr(stripTrailingComment(m[2]), stmt);
        if (val && val.t === 'num') {
          env[m[1]] = val.v;
          if (/^COLOR_/i.test(m[1])) colorTable[val.v] = m[1].replace(/^COLOR_/i, '');
        } else if (val && val.t === 'str') {
          env[m[1]] = val.v;
        }
        continue;
      }

      m = text.match(/^Set\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/i);
      if (m) {
        const val = ev.evalExpr(m[2], stmt);
        if (val && val.t === 'node') {
          env[m[1]] = val.v;
          if (val.v.kind === TYPE.PARSER && !root) root = val.v;
        } else if (val && val.t === 'num') {
          env[m[1]] = val.v;
        } else if (val && val.t === 'str') {
          env[m[1]] = val.v;
        }
        continue;
      }

      m = text.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
      if (m) {
        const val = ev.evalExpr(m[2], stmt);
        if (val && (val.t === 'node' || val.t === 'num' || val.t === 'str')) env[m[1]] = val.v;
        continue;
      }

      // 属性赋值形态：yml.FoldingMethod="indent"
      m = text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);      if (m) {
        const obj = env[m[1]];
        if (!obj || typeof obj !== 'object') { errors.push({ line: stmt.line, text, reason: `对象 ${m[1]} 不是解析器实例` }); continue; }
        obj.meta = obj.meta || Object.create(null);
        const val = ev.evalExpr(m[3], stmt);
        if (val) obj.meta[m[2].toLowerCase()] = val.v;
        continue;
      }

      m = text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\)|\s+([\s\S]+))?$/);
      if (m) {
        const obj = env[m[1]];
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
    colorTable,
    stats: { ...stats, regionCount, itemCount, wordCount },
  };
}

// 把颜色索引换算成主题里的键名，例如 1 -> Comment1
export function colorKey(colorTable, index) {
  return colorTable[index] || 'Default';
}
