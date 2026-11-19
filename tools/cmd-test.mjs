// 命令层单元测试：不起浏览器，用一个假的 host 在纯文本上跑命令，逐条断言结果。
//
// 为什么值得写：命令是纯函数（text + 选区 → 新 text + 新选区），最容易出的是
// 边界（行首/行尾/空选区/末行没换行）。这些用肉眼点菜单很难覆盖全。
//
// 用法：node tools/cmd-test.mjs

import { COMMANDS } from '../js/commands.mjs';

let pass = 0;
const fails = [];

function makeHost(text, sel, syntax = 'python.mac') {
  const st = { text, start: sel[0], end: sel[1], acts: [], toasts: [] };
  const host = {
    doc: () => ({ text: st.text, start: st.start, end: st.end }),
    apply(fn) {
      const d = host.doc();
      const r = fn(d);
      if (!r) return;
      st.text = r.text;
      st.start = r.start;
      st.end = r.end ?? r.start;
    },
    act: (name, arg) => st.acts.push([name, arg]),
    tab: () => ({ syntax }),
    tabSize: () => 4,
    setSel: (a, b) => { st.start = a; st.end = b ?? a; },
    toast: (m) => st.toasts.push(m),
  };
  return { host, st };
}

function t(name, cmdId, text, sel, expect) {
  const cmd = COMMANDS.get(cmdId);
  if (!cmd) {
    fails.push(`${name}：命令 ${cmdId} 没注册`);
    return;
  }
  const { host, st } = makeHost(text, sel);
  try {
    cmd.run(host);
  } catch (e) {
    fails.push(`${name}：抛异常 ${e.message}`);
    return;
  }
  const got = expect.text !== undefined ? st.text : null;
  const okText = expect.text === undefined || got === expect.text;
  const okSel = expect.sel === undefined || (st.start === expect.sel[0] && st.end === expect.sel[1]);
  if (okText && okSel) {
    pass++;
    return;
  }
  fails.push(
    `${name}\n    期望 text=${JSON.stringify(expect.text)} sel=${JSON.stringify(expect.sel)}` +
    `\n    实得 text=${JSON.stringify(st.text)} sel=${JSON.stringify([st.start, st.end])}`
  );
}

// ---- 大小写与对调 ----
t('转大写（选区）', 'cm_edit_toupper', 'hello world', [0, 5], { text: 'HELLO world', sel: [0, 5] });
t('转小写（选区）', 'cm_edit_tolower', 'HELLO world', [0, 5], { text: 'hello world', sel: [0, 5] });
t('转大写（无选区取单词）', 'cm_edit_toupper', 'foo bar', [5, 5], { text: 'foo BAR', sel: [4, 7] });
t('对调字符', 'cm_edit_transpose', 'abc', [1, 1], { text: 'bac', sel: [2, 2] });

// ---- 行操作 ----
t('复制当前行', 'cm_edit_duplicateline', 'a\nb\nc', [2, 2], { text: 'a\nb\nb\nc', sel: [4, 4] });
t('删除整行（中间）', 'cm_delete_line', 'a\nb\nc', [2, 2], { text: 'a\nc', sel: [2, 2] });
t('删除整行（末行无换行）', 'cm_delete_line', 'a\nb', [2, 2], { text: 'a', sel: [1, 1] });
t('合并行', 'cm_edit_joinlines', 'a\n  b\nc', [0, 5], { text: 'a b\nc' });
t('增加缩进', 'cm_edit_increaseindent', 'a\nb', [0, 3], { text: '    a\n    b' });
t('减少缩进', 'cm_edit_decreaseindent', '    a\n  b', [0, 11], { text: 'a\nb' });
t('行注释', 'cm_edit_linecomment', 'x = 1', [0, 0], { text: '# x = 1' });
t('行注释再执行一次是取消', 'cm_edit_linecomment', '# x = 1', [0, 0], { text: 'x = 1' });

// ---- 删除单词 ----
t('向左删单词', 'cm_delete_prevword', 'foo bar', [7, 7], { text: 'foo ', sel: [4, 4] });
t('向右删单词', 'cm_delete_nextword', 'foo bar', [0, 0], { text: ' bar', sel: [0, 0] });

// ---- 插入 ----
t('下方插入空行带缩进', 'cm_insert_newlineafter', '  a\nb', [3, 3], { text: '  a\n  \nb', sel: [6, 6] });
t('上方插入空行', 'cm_insert_newlinebefore', '  a', [3, 3], { text: '  \n  a', sel: [3, 3] });

// ---- 排序与清理 ----
t('升序', 'cm_tool_sortasc', 'b\na\nc', [0, 5], { text: 'a\nb\nc' });
t('降序', 'cm_tool_sortdec', 'b\na\nc', [0, 5], { text: 'c\nb\na' });
t('删除空白行', 'mx_delete_blanklines', 'a\n\nb\n  \nc', [0, 10], { text: 'a\nb\nc' });
t('删除重复行', 'mx_delete_duplicatelines', 'a\nb\na\nc', [0, 7], { text: 'a\nb\nc' });
t('删除行尾空白', 'mx_trim_trailing', 'a  \nb\t\nc', [0, 9], { text: 'a\nb\nc' });
t('按等号对齐', 'mx_align_equals', 'a = 1\nlong = 2', [0, 15], { text: 'a    = 1\nlong = 2' });

// ---- 移动行 ----
// 移动后选区跟着走，覆盖被移动的行
t('下移当前行', 'cm_move_linedown', 'a\nb\nc', [0, 0], { text: 'b\na\nc', sel: [2, 3] });
t('上移当前行', 'cm_move_lineup', 'a\nb\nc', [2, 2], { text: 'b\na\nc', sel: [0, 1] });

// ---- 选择 ----
t('选择单词', 'cm_select_word', 'foo bar', [5, 5], { sel: [4, 7] });
t('选择到匹配括号内容', 'cm_select_topair', 'f(a+b)', [1, 1], { sel: [2, 5] });

// ---- Base64 往返 ----
{
  const { host, st } = makeHost('hello 世界', [0, 8]);
  COMMANDS.get('mx_base64_encode').run(host);
  const enc = st.text;
  const h2 = makeHost(enc, [0, enc.length]);
  COMMANDS.get('mx_base64_decode').run(h2.host);
  if (h2.st.text === 'hello 世界') pass++;
  else fails.push(`Base64 往返\n    期望 "hello 世界"\n    实得 ${JSON.stringify(h2.st.text)}`);
}

// ---- 日期 ----
{
  const { host, st } = makeHost('', [0, 0]);
  COMMANDS.get('cm_insert_date').run(host);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(st.text)) pass++;
  else fails.push(`插入日期格式：实得 ${JSON.stringify(st.text)}`);
}

// ---- 委托类命令必须把动作转给 app ----
for (const [id, act] of [
  ['cm_file_save', 'save'],
  ['cm_find', 'find'],
  ['cm_folding_foldall', 'fold-all'],
  ['cm_goto_anything', 'palette'],
]) {
  const { host, st } = makeHost('x', [0, 0]);
  COMMANDS.get(id).run(host);
  if (st.acts.length && st.acts[0][0] === act) pass++;
  else fails.push(`${id} 应转给 act('${act}')，实得 ${JSON.stringify(st.acts)}`);
}

// ---- 快捷键不能重复 ----
{
  const seen = new Map();
  for (const c of COMMANDS.values()) {
    if (c.noBind) continue;
    for (const k of c.keys) {
      if (seen.has(k)) fails.push(`快捷键冲突 ${k}：${seen.get(k)} 与 ${c.id}`);
      else seen.set(k, c.id);
    }
  }
  pass++;
}

console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.log(`失败 ${fails.length} 项：`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('命令层测试全部通过');
