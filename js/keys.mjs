// 快捷键分发：把 key.ini 里的写法（CS+U、C+K,C+1、A+F4）解析成可匹配的形式。
//
// 组合串的规则（与原版一致）：
//   修饰键 C=Ctrl S=Shift A=Alt，连写在 '+' 前；逗号分隔表示前后两段按键（和弦）。

const MOD_ORDER = ['C', 'S', 'A'];

const KEY_ALIAS = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Delete: 'Del',
  Insert: 'Ins',
  ' ': 'Space',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

// Shift 会改字符：Shift+'=' 报 '＋'。反推回去，两种写法都能匹配
const SHIFTED = {
  _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
  '<': ',', '>': '.', '?': '/', '~': '`', '!': '1', '@': '2', '#': '3',
  $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
};

function normKey(raw) {
  if (KEY_ALIAS[raw]) return KEY_ALIAS[raw];
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
}

// 'C+K,C+1' → [{mods:'CK', key:'K'}, ...]
export function parseCombo(combo) {
  return combo.split(',').map((part) => {
    const bits = part.split('+');
    const key = bits.pop();
    let mods = '';
    for (const b of bits) {
      for (const ch of b.toUpperCase()) if (MOD_ORDER.includes(ch) && !mods.includes(ch)) mods += ch;
    }
    return { mods: MOD_ORDER.filter((m) => mods.includes(m)).join(''), key: normKey(key) };
  });
}

function eventChords(e) {
  const mods = MOD_ORDER.filter((m) => (m === 'C' ? e.ctrlKey || e.metaKey : m === 'S' ? e.shiftKey : e.altKey)).join('');
  const base = normKey(e.key);
  const keys = new Set([base]);
  if (e.shiftKey && base.length === 1 && SHIFTED[base]) keys.add(SHIFTED[base]);
  return [...keys].map((k) => ({ mods, key: k }));
}

const sep = (a) => MOD_ORDER.filter((m) => a.includes(m)).join('');

// 建索引：完整和弦表 + 前缀表
export function buildKeyIndex(keyMap) {
  const exact = new Map();
  const prefix = new Set();
  for (const [combo, id] of keyMap) {
    const chords = parseCombo(combo);
    if (chords.length === 1) {
      exact.set(`${chords[0].mods}+${chords[0].key}`, id);
    } else if (chords.length === 2) {
      const head = `${chords[0].mods}+${chords[0].key}`;
      prefix.add(head);
      exact.set(`${head}>${chords[1].mods}+${chords[1].key}`, id);
    }
  }
  return { exact, prefix };
}

// 返回一个 keydown 处理器。命中命令返回 true，并已经 preventDefault
export function createDispatcher(index, runCommand, opts = {}) {
  let pending = '';
  let timer = 0;
  const timeout = opts.timeout || 1500;

  return function onKeyDown(e) {
    if (e.repeat) return false;
    const chords = eventChords(e);
    for (const ch of chords) {
      const head = `${ch.mods}+${ch.key}`;
      if (pending) {
        const id = index.exact.get(`${pending}>${head}`);
        if (id) {
          clearTimeout(timer);
          pending = '';
          e.preventDefault();
          runCommand(id);
          return true;
        }
        continue;
      }
      if (index.prefix.has(head)) {
        pending = head;
        clearTimeout(timer);
        timer = setTimeout(() => { pending = ''; }, timeout);
        e.preventDefault();
        return true;
      }
      const id = index.exact.get(head);
      if (id) {
        e.preventDefault();
        runCommand(id);
        return true;
      }
    }
    if (pending && e.key === 'Escape') pending = '';
    return false;
  };
}

// 把组合串变成菜单右栏显示的写法：C+S+U → Ctrl+Shift+U
export function prettyCombo(combo) {
  return combo
    .split(',')
    .map((part) =>
      part
        .split('+')
        .map((p) => {
          if (p === 'C') return 'Ctrl';
          if (p === 'S') return 'Shift';
          if (p === 'A') return 'Alt';
          if (p === 'Up') return '↑';
          if (p === 'Down') return '↓';
          if (p === 'Left') return '←';
          if (p === 'Right') return '→';
          if (p === 'Del') return 'Del';
          if (p === 'Ins') return 'Ins';
          return p;
        })
        .join('+')
    )
    .join(' ');
}

export { sep };
