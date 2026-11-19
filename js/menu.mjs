// 菜单栏：结构按 EverEdit 的主菜单分组，条目只放已经实现（或明确可用）的命令。
// 标签与快捷键都从命令注册表取，不另抄一份，避免两处不一致。

import { command } from './commands.mjs';
import { prettyCombo } from './keys.mjs';

export function menuSpec(ctx) {
  const syntaxItems = ctx.syntaxes.map((n) => ({
    label: n.replace(/\.mac$/, ''),
    checked: n === ctx.syntax,
    onSelect: () => ctx.onSyntax(n),
  }));
  const themeItems = ctx.themes.map((n) => ({
    label: n.replace(/\.ini$/, ''),
    checked: n === ctx.theme,
    onSelect: () => ctx.onTheme(n),
  }));

  return [
    {
      label: '文件(&F)',
      items: [
        'cm_file_new',
        'cm_file_open',
        '-',
        'cm_file_save',
        'cm_file_saveas',
        'cm_file_reload',
        '-',
        'cm_file_close',
        'cm_file_closeothers',
        '-',
        'cm_file_exit',
      ],
    },
    {
      label: '编辑(&E)',
      items: [
        'cm_edit_undo',
        'cm_edit_redo',
        '-',
        'cm_edit_cut',
        'cm_edit_copy',
        'cm_edit_paste',
        'cm_edit_copyappend',
        '-',
        'cm_delete_line',
        'cm_delete_prevword',
        'cm_delete_nextword',
        'mx_delete_blanklines',
        'mx_delete_duplicatelines',
        'mx_trim_trailing',
        '-',
        'cm_edit_toupper',
        'cm_edit_tolower',
        'cm_edit_transpose',
        '-',
        'cm_edit_duplicateline',
        'cm_edit_joinlines',
        'cm_edit_increaseindent',
        'cm_edit_decreaseindent',
        '-',
        'cm_edit_linecomment',
        'cm_edit_blockcomment',
        '-',
        'cm_insert_date',
        'cm_insert_newlineafter',
        'cm_insert_newlinebefore',
      ],
    },
    {
      label: '选择(&S)',
      items: [
        'cm_select_all',
        'cm_select_word',
        'cm_select_quick',
        '-',
        'cm_move_brace',
        'cm_select_topair',
        'cm_select_topair2',
      ],
    },
    {
      label: '查看(&V)',
      items: [
        'cm_view_wrap',
        'cm_view_gutter',
        'cm_view_indent',
        '-',
        'cm_view_zoominfont',
        'cm_view_zoomoutfont',
        'cm_view_defaultfont',
        '-',
        { label: '语法', items: syntaxItems },
        { label: '配色', items: themeItems },
        '-',
        'cm_view_fullscreen',
      ],
    },
    {
      label: '查找(&S)',
      items: ['cm_find', 'cm_replace', '-', 'cm_find_next', 'cm_find_prev', 'cm_find_nextword', 'cm_find_prevword'],
    },
    {
      label: '工具(&T)',
      items: [
        'cm_tool_sortasc',
        'cm_tool_sortdec',
        'mx_align_equals',
        '-',
        'mx_base64_encode',
        'mx_base64_decode',
        '-',
        'cm_folding_foldall',
        'cm_folding_expandall',
        'cm_folding_foldcurlevel',
        'cm_folding_expandcurlevel',
        { label: '折叠到第 N 层', items: [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `cm_folding_level${n}`) },
      ],
    },
    {
      label: '窗口(&I)',
      items: ['cm_window_next', 'cm_window_prev', 'cm_window_last', '-', 'cm_marker_toggle', 'cm_marker_next', 'cm_marker_prev'],
    },
    {
      label: '帮助(&H)',
      items: ['cm_goto_anything', '-', 'cm_misc_apphelp'],
    },
  ];
}

// 把 spec 渲染成 DOM；run(cmdId) 由 app.js 提供
export function buildMenuBar(root, spec, run) {
  root.innerHTML = '';
  let openPopup = null;
  let openIndex = -1;

  const closeAll = () => {
    if (openPopup) openPopup.remove();
    openPopup = null;
    openIndex = -1;
    [...root.children].forEach((c) => c.classList.remove('open'));
  };

  const makeList = (items, nested) => {
    const box = document.createElement('div');
    box.className = nested ? 'menu-sub' : 'menu-popup';
    for (const it of items) {
      if (it === '-') {
        const sep = document.createElement('div');
        sep.className = 'm-sep';
        box.appendChild(sep);
        continue;
      }
      const entry = typeof it === 'string' ? command(it) : it;
      if (!entry) continue;

      const row = document.createElement('div');
      row.className = 'm-row';

      if (entry.items) {
        row.classList.add('has-sub');
        // 留出和普通条目一样的勾选列，否则子菜单项会比别的行更靠左、贴着边框
        row.innerHTML = `<span class="m-check"></span><span class="m-label">${entry.label}</span><span class="m-arrow">›</span>`;
        const sub = makeList(entry.items, true);
        row.appendChild(sub);
        // 子菜单默认往右弹；右边放不下就翻到左边，不能让它飘出窗口
        row.addEventListener('mouseenter', () => {
          sub.style.left = '';
          sub.style.right = '';
          const prev = sub.style.display;
          sub.style.display = 'block';
          const r = sub.getBoundingClientRect();
          if (r.right > window.innerWidth - 6) {
            sub.style.left = 'auto';
            sub.style.right = '100%';
          }
          sub.style.display = prev;
        });
        box.appendChild(row);
        continue;
      }

      if (entry.onSelect) {
        row.innerHTML = `<span class="m-check">${entry.checked ? '✓' : ''}</span><span class="m-label">${entry.label}</span>`;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAll();
          entry.onSelect();
        });
        box.appendChild(row);
        continue;
      }

      const key = entry.keys && entry.keys.length ? prettyCombo(entry.keys[0]) : '';
      row.innerHTML = `<span class="m-check"></span><span class="m-label">${entry.menu || entry.id}</span><span class="m-key">${key}</span>`;
      row.dataset.cmd = entry.id;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAll();
        run(entry.id);
      });
      box.appendChild(row);
    }
    return box;
  };

  spec.forEach((menu, i) => {
    const item = document.createElement('div');
    item.className = 'm-item';
    item.innerHTML = menu.label;
    root.appendChild(item);

    const open = () => {
      closeAll();
      openIndex = i;
      item.classList.add('open');
      const popup = makeList(menu.items, false);
      document.body.appendChild(popup);
      const r = item.getBoundingClientRect();
      popup.style.left = `${Math.round(r.left)}px`;
      popup.style.top = `${Math.round(r.bottom)}px`;
      // 右侧越界就往左挪
      requestAnimationFrame(() => {
        const pr = popup.getBoundingClientRect();
        if (pr.right > window.innerWidth - 4) {
          popup.style.left = `${Math.max(4, window.innerWidth - pr.width - 4)}px`;
        }
      });
      openPopup = popup;
    };

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openIndex === i) closeAll();
      else open();
    });
    item.addEventListener('mouseenter', () => {
      if (openIndex >= 0 && openIndex !== i) open();
    });
  });

  document.addEventListener('click', closeAll);
  window.addEventListener('blur', closeAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });

  return { closeAll };
}
