// EverEdit 主题（theme/*.ini）解析与应用
// 主题格式： [Theme] Key=#BG,#FG  |  [Style] Key=位掩码

export function parseIni(text) {
  const out = Object.create(null);
  let section = 'default';
  out[section] = Object.create(null);
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1].trim();
      out[section] = out[section] || Object.create(null);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    out[section][k] = v;
  }
  return out;
}

function normColor(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

// 一个主题值可能是 "#BG,#FG"，也可能只有一个颜色
export function splitColor(value) {
  if (!value) return { bg: null, fg: null };
  const parts = String(value).split(',').map((x) => normColor(x));
  if (parts.length >= 2) return { bg: parts[0], fg: parts[1] };
  return { bg: parts[0], fg: parts[0] };
}

function luminance(hex) {
  if (!hex) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function styleBits(bits) {
  const n = Number(bits) || 0;
  const decl = [];
  if (n & 1) decl.push('font-weight:600');
  if (n & 2) decl.push('font-style:italic');
  if (n & 4) decl.push('text-decoration:underline');
  // 第 8 位在 EverEdit 里的语义未能确认，宁可不生效也不猜
  return decl.join(';');
}

// 生成 token 类样式表；colorTable: 索引 -> 常量名（来自 const.mac）
// 主题里的键大小写与常量名不一致（DEFAULT vs Default），所以按小写匹配
export function buildTokenCss(ini, colorTable) {
  const theme = ini.Theme || {};
  const styles = ini.Style || {};
  const themeByLower = new Map();
  for (const [k, v] of Object.entries(theme)) themeByLower.set(k.toLowerCase(), v);
  const styleByLower = new Map();
  for (const [k, v] of Object.entries(styles)) styleByLower.set(k.toLowerCase(), v);

  const rules = [];
  let maxIdx = 0;
  for (const k of Object.keys(colorTable)) maxIdx = Math.max(maxIdx, Number(k));

  for (let i = 0; i <= Math.max(maxIdx, 31); i++) {
    const name = colorTable[i];
    if (!name) continue;
    const entry = themeByLower.get(String(name).toLowerCase());
    if (!entry) continue;
    const { fg } = splitColor(entry);
    const decl = [];
    if (fg) decl.push(`color:${fg}`);
    const st = styleBits(styleByLower.get(String(name).toLowerCase()));
    if (st) decl.push(st);
    if (!decl.length) continue;
    rules.push(`.t${i}{${decl.join(';')}}`);
  }
  return rules.join('\n');
}

export function themeVars(ini) {
  const theme = ini.Theme || {};
  const d = splitColor(theme.Default);
  const bg = d.bg || '#1e1e1e';
  const fg = d.fg || '#d4d4d4';
  const dark = luminance(bg) < 0.5;
  const pick = (key, which, fallback) => {
    const c = splitColor(theme[key]);
    const v = which === 'bg' ? c.bg : c.fg;
    return v || fallback;
  };
  const caretRaw = pick('Caret', 'fg', fg);
  // 深色主题里 Caret 常被写成纯黑，直接用会看不见
  const caret = caretRaw && Math.abs(luminance(caretRaw) - luminance(bg)) > 0.25 ? caretRaw : fg;
  return {
    dark,
    bg,
    fg,
    gutterBg: pick('LineNumber', 'bg', bg),
    gutterFg: pick('LineNumber', 'fg', dark ? '#858585' : '#999999'),
    activeLine: pick('ActiveLine', 'bg', dark ? '#2a2a2a' : '#f2f2f2'),
    caret,
    selBg: pick('Selection', 'bg', dark ? '#264f78' : '#cfe3ff'),
    selFg: pick('Selection', 'fg', fg),
    found: pick('Found', 'bg', '#cd853f'),
    chard: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    chardStrong: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
  };
}
