// 注入到页面里的桥：接口与 desktop/preload.cjs 一一对应，
// 前端 js/app.js 一行不用改就能跑在 WebView2 里。

pub const INIT_JS: &str = r#"
(() => {
  const pending = new Map();
  let seq = 1;

  // 页面里的报错要能看见，不然出问题只能靠猜
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) =>
    window.__errors.push('unhandled: ' + String((e.reason && e.reason.message) || e.reason))
  );

  window.__miniReply = (id, value) => {
    const resolve = pending.get(id);
    if (resolve) { pending.delete(id); resolve(value); }
  };

  const call = (method, args) => new Promise((resolve) => {
    const id = seq++;
    pending.set(id, resolve);
    window.ipc.postMessage(JSON.stringify({ id, method, args: args === undefined ? null : args }));
  });

  window.miniedit = {
    isDesktop: true,
    platform: 'win32',
    // 没有原生菜单栏（wl 外壳用系统菜单要写 Win32 API），快捷键改由前端自己绑
    hasMenu: false,

    // WebView2 拿不到 File 的真实路径，拖放走原生 drag-drop 回调
    getPathForFile: () => null,

    boot: async () => {
      const meta = await call('boot-meta');
      const bundle = await (await fetch('/api/bundle')).json();
      return Object.assign({}, meta, { bundle });
    },

    close: () => call('close'),
    setDirty: (dirty) => call('set-dirty', { dirty: !!dirty }),
    setTitle: (name, dirty) => call('set-title', { name: name || '', dirty: !!dirty }),
    setTheme: (name) => call('set-theme', { name: name || '' }),
    setZoom: (zoom) => call('set-zoom', { zoom: Number(zoom) || 0 }),

    openDialog: async () => {
      const r = await call('open-dialog');
      if (r && r.errors && r.errors.length) {
        window.miniedit.showError('打开失败', r.errors.map((e) => `${e.path}\n${e.error}`).join('\n\n'));
      }
      return (r && r.items) || [];
    },

    readFile: (path) => call('read', { path }),
    stat: (path) => call('stat', { path }),
    writeFile: (payload) => call('write', payload || {}),
    saveDialog: (payload) => call('save-dialog', payload || {}),
    confirmClose: (name) => call('confirm-close', { name: name || '' }),
    showError: (message, detail) => call('error-dialog', { message: message || '', detail: detail || '' }),
    recent: () => call('recent'),
    reveal: (path) => call('reveal', { path: path || '' }),
    sample: (name) => call('sample', { name: name || '' }),
    // 自检用：拿一个临时文件路径，JS 里没法直接知道 %TEMP%
    tempPath: () => call('temp-path'),
    saveRecovery: (tabs) => call('save-recovery', { tabs: tabs || [] }),

    onMenu: (cb) => { window.__menuCb = cb; },    onOpenFiles: (cb) => {
      window.__openFilesCb = cb;
      // 命令行/双击带进来的文件在页面加载前就送到了，这里补发一次
      if (window.__pendingFiles && window.__pendingFiles.length) {
        const paths = window.__pendingFiles;
        window.__pendingFiles = null;
        setTimeout(() => cb(paths), 0);
      }
    },
  };
})();
"#;

/// 无头自检：跑完界面检查后把结果发回 Rust，由主循环打印并退出。
/// 对应 Electron 版的 SMOKE_IO / SMOKE_FOLD / SMOKE_STATE / SMOKE_LAYOUT。

/// 无头自检：逐步收集，任何一步失败都记下来而不是整个探针崩掉。
pub const SMOKE_JS: &str = r#"
(async () => {
  const out = { steps: [] };
  const step = async (name, fn) => {
    try { out[name] = await fn(); out.steps.push(name + ':ok'); }
    catch (e) { out[name] = { error: String((e && e.message) || e) }; out.steps.push(name + ':fail'); }
  };

  // 全新 WebView2 profile 的首次渲染可能超过固定等待时间，先等启动真的完成再探
  const waitFor = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (fn()) return true; } catch {}
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };
  out.ready = await waitFor(() => window.__mini && document.querySelectorAll('.tab').length > 0, 15000);

  await step('dom', () => ({
    href: location.href,
    title: document.title,
    hasTa: !!document.getElementById('ta'),
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    head: document.body ? document.body.textContent.trim().slice(0, 60) : '',
  }));

  await step('state', () => ({
    tabs: [...document.querySelectorAll('.tab .name')].map((n) => n.textContent),
    syntaxes: (document.getElementById('syntax') || { options: [] }).options.length,
    themes: (document.getElementById('theme') || { options: [] }).options.length,
    hint: (document.getElementById('parseHint') || {}).textContent || '',
    rows: document.querySelectorAll('#hlInner > div').length,
    icons: document.querySelectorAll('.toolbar button .ico').length,
    errors: (window.__errors || []).slice(0, 3),
  }));

  // 恢复快照要先跟磁盘对账：预置一份"比磁盘短"的 recovery.json，
  // 正确行为是打开磁盘上的完整内容（tabs=1、dirty=0、len 等于磁盘长度）
  await step('recover', () => {
    const ta = document.getElementById('ta');
    return {
      tabs: document.querySelectorAll('#tabs .tab').length,
      dirty: document.querySelectorAll('#tabs .dirty').length,
      names: [...document.querySelectorAll('.tab .name')].map((n) => n.textContent),
      len: ta ? ta.value.length : -1,
      head: ta ? ta.value.slice(0, 24) : '',
    };
  });

  // 菜单要能打开，且「有子菜单的行」与普通行的文字左边界必须对齐
  await step('menu', () => {
    const items = [...document.querySelectorAll('#menubar .m-item')];
    const view = items.find((x) => x.textContent.indexOf('查看') === 0);
    if (!view) return { opened: false };
    view.click();
    const popup = document.querySelector('.menu-popup');
    if (!popup) return { opened: false };
    const rows = [...popup.querySelectorAll('.m-row')];
    const plain = rows.find((r) => !r.classList.contains('has-sub'));
    const sub = rows.find((r) => r.classList.contains('has-sub'));
    const leftOf = (r) => Math.round(r.querySelector('.m-label').getBoundingClientRect().left);
    const out = {
      opened: true,
      rows: rows.length,
      plainLeft: plain ? leftOf(plain) : null,
      subLeft: sub ? leftOf(sub) : null,
    };
    out.aligned = out.plainLeft !== null && out.subLeft !== null && Math.abs(out.plainLeft - out.subLeft) <= 1;
    document.body.click();
    return out;
  });

  await step('cmd', () => {
    const ta = document.getElementById('ta');
    const bar = document.querySelectorAll('#menubar .m-item').length;
    const m = window.__mini;
    if (!ta || !m) return { bar, ok: false, why: '没有命令层' };
    const before = ta.value;
    ta.focus();
    ta.setSelectionRange(0, 0);
    m.run('cm_edit_duplicateline');
    const grew = ta.value.length > before.length;
    m.run('cm_edit_undo');
    return { bar, grew, undone: ta.value === before };
  });

  await step('io', async () => {
    const tmp = await window.miniedit.tempPath();
    const sample = '第一行：中文测试\r\nsecond line\r\n';
    const w = await window.miniedit.writeFile({ filePath: tmp, text: sample, encoding: 'gbk', eol: 'CRLF' });
    const r = await window.miniedit.readFile(tmp);
    return {
      writeOk: !!(w && w.ok),
      readOk: !!(r && r.ok),
      encoding: r && r.item ? r.item.encoding : null,
      eol: r && r.item ? r.item.eol : null,
      same: !!(r && r.item && r.item.text === sample),
    };
  });

  await step('fold', () => {
    const ta = document.getElementById('ta');
    if (!ta) return { skipped: '没有编辑器' };
    const full = ta.value;
    const tris = [...document.querySelectorAll('#gutterInner [data-fold]')];
    if (!tris.length) return { foldable: 0 };
    const idx = tris[0].dataset.fold;
    tris[0].click();
    const tri = document.querySelector('#gutterInner [data-fold="' + idx + '"]');
    const shot = { foldable: tris.length, arrow: tri ? tri.textContent : '', fewer: ta.value.length < full.length };
    ta.focus();
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', bubbles: true, cancelable: true }));
    shot.restored = ta.value === full;
    return shot;
  });

  await step('layout', () => ({
    wrapped: [...document.querySelectorAll('.toolbar button')]
      .filter((b) => b.scrollHeight > b.clientHeight + 1)
      .map((b) => b.textContent.trim()),
    guides: document.querySelectorAll('#hlInner .ig').length,
  }));

  await step('boot', async () => {
    const b = await window.miniedit.boot();
    return { syntaxes: ((b.bundle && b.bundle.syntaxes) || []).length, recovery: (b.recovery || []).length };
  });

  window.ipc.postMessage(JSON.stringify({ id: 0, method: '__smoke', args: out }));
})();
"#;
