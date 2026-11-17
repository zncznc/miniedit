const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { createReference } = require('./reference.cjs');
const { detect, encode, decodeAs, detectEol, normalizeEol, ENCODING_LABEL } = require('./encoding.cjs');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const REF_DIR = path.join(ROOT, 'assets', 'reference');
const reference = createReference(REF_DIR);

// 自检时可以指向一个干净的配置目录，模拟“刚装好第一次启动”
if (process.env.MINIEDIT_USERDATA) {
  app.setPath('userData', process.env.MINIEDIT_USERDATA);
}

const MAX_SIZE = 32 * 1024 * 1024; // 超过 32MB 不开，避免把窗口拖死

let win = null;
let forceClose = false;
let rendererDirty = false;
let pendingPaths = [];

// ---------- 状态 ----------

const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');
const defaultState = () => ({ theme: '', window: null, recent: [], lastDir: '', zoom: 0 });

let state = defaultState();

function loadState() {
  try {
    state = { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) };
  } catch {
    state = defaultState();
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
      fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), 'utf8');
    } catch {
      /* 状态存不下来不影响使用 */
    }
  }, 300);
}

function addRecent(p) {
  state.recent = [p, ...state.recent.filter((x) => x !== p)].slice(0, 12);
  state.lastDir = path.dirname(p);
  saveState();
  buildMenu();
}

// ---------- 读写 ----------

function readItem(p) {
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('不是文件');
  if (st.size > MAX_SIZE) throw new Error(`文件 ${Math.round(st.size / 1048576)}MB，超过预览上限 32MB`);
  const buf = fs.readFileSync(p);
  const d = detect(buf);
  return {
    path: p,
    name: path.basename(p),
    text: d.text,
    encoding: d.encoding,
    encodingLabel: ENCODING_LABEL[d.encoding] || d.encoding,
    binary: d.binary,
    eol: detectEol(d.text),
    size: st.size,
    mtimeMs: st.mtimeMs,
  };
}

function writeItem({ filePath, text, encoding, eol }) {
  const eolText = eol ? normalizeEol(text, eol) : text;
  const payload = encode(eolText, encoding || 'utf-8');
  // GBK 装不下的字符会被写成 '?'，这种情况必须让用户知道，而不是悄悄丢字
  const lossy = decodeAs(payload, encoding || 'utf-8') !== eolText;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload);
  const st = fs.statSync(filePath);
  state.lastDir = path.dirname(filePath);
  saveState();
  addRecent(filePath);
  return { path: filePath, size: st.size, mtimeMs: st.mtimeMs, encoding, lossy };
}

// ---------- 菜单 ----------

function send(action, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('menu', action, arg);
}

function buildMenu() {
  const recent = state.recent.filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  const recentItems =
    recent.length === 0
      ? [{ label: '（暂无）', enabled: false }]
      : [
          ...recent.map((p, i) => ({
            label: `${i + 1}  ${path.basename(p)}`,
            sublabel: path.dirname(p),
            click: () => send('open-path', p),
          })),
          { type: 'separator' },
          {
            label: '清除列表',
            click: () => {
              state.recent = [];
              saveState();
              buildMenu();
            },
          },
        ];

  const template = [
    {
      label: '文件(&F)',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: '最近打开', submenu: recentItems },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { label: '全部保存', accelerator: 'CmdOrCtrl+Alt+S', click: () => send('save-all') },
        { type: 'separator' },
        { label: '关闭标签', accelerator: 'CmdOrCtrl+W', click: () => send('close') },
        { label: '关闭全部', accelerator: 'CmdOrCtrl+Shift+W', click: () => send('close-all') },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: '编辑(&E)',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: '替换', accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
        { label: '转到行…', accelerator: 'CmdOrCtrl+G', click: () => send('goto') },
      ],
    },
    {
      label: '查看(&V)',
      submenu: [
        { label: '放大字号', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: '缩小字号', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: '重置字号', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: '自动换行', accelerator: 'Alt+Z', click: () => send('toggle-wrap') },
        { label: '行号', click: () => send('toggle-gutter') },
        { label: '缩进线', click: () => send('toggle-indent') },
        { type: 'separator' },
        { label: '折叠全部', accelerator: 'CmdOrCtrl+Shift+[', click: () => send('fold-all') },
        { label: '展开全部', accelerator: 'CmdOrCtrl+Shift+]', click: () => send('unfold-all') },
        { type: 'separator' },
        { label: '转到语法选择', accelerator: 'CmdOrCtrl+L', click: () => send('focus-syntax') },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', click: () => send('toggle-fullscreen') },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
    {
      label: '帮助(&H)',
      submenu: [
        { label: '与原版的对照', click: () => send('compare') },
        { label: '打开参考数据目录', click: () => shell.openPath(REF_DIR) },
        { type: 'separator' },
        { label: `关于 MiniEdit ${app.getVersion()}`, click: () => send('about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 窗口 ----------

function createWindow() {
  const bounds = state.window || {};
  win = new BrowserWindow({
    width: bounds.width || 1180,
    height: bounds.height || 760,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 460,
    show: false,
    backgroundColor: '#f3f3f3',
    title: 'MiniEdit',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (bounds.maximized) win.maximize();

  win.loadFile(path.join(ROOT, 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    // 双击关联文件 / 命令行带路径启动
    if (pendingPaths.length) {
      win.webContents.send('open-files', pendingPaths);
      pendingPaths = [];
    }
  });

  // 渲染进程的报错要能在终端看见，不然出问题只能靠猜
  win.webContents.on('console-message', (...args) => {
    const ev = args[0];
    if (ev && typeof ev === 'object' && 'message' in ev) {
      if (ev.level === 'error' || ev.level === 'warning') console.log(`[renderer:${ev.level}]`, ev.message);
      return;
    }
    const [, level, message] = args;
    if (level >= 2) console.log('[renderer]', message);
  });

  win.webContents.on('render-process-gone', (_e, details) => console.log('[crash]', JSON.stringify(details)));

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    state.window = win.isMaximized() ? { ...state.window, maximized: true } : { ...win.getBounds(), maximized: false };
    saveState();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);

  win.on('close', (e) => {
    if (forceClose || !rendererDirty) return;
    e.preventDefault();
    send('check-close');
  });

  win.on('closed', () => {
    win = null;
  });

  // 外链交给系统浏览器，不在编辑器里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- 启动 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const files = argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a));
    if (files.length) win.webContents.send('open-files', files);
  });

  app.whenReady().then(() => {
    loadState();
    pendingPaths = process.argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile());
    buildMenu();
    createWindow();
    if (process.env.MINIEDIT_SMOKE) runSmoke();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// ---------- 自检：无头模式下截一张图就退出，用来验证装完能不能真的起来 ----------

function runSmoke() {
  if (!win) return;
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        // 走完整条 IPC 链路做一次真实读写：GBK 中文 + CRLF
        const roundTrip = await win.webContents.executeJavaScript(`(async () => {
          const tmp = ${JSON.stringify(path.join(app.getPath('temp'), 'miniedit-selftest.txt'))};
          const sample = '第一行：中文测试\\r\\nsecond line\\r\\n';
          const w = await window.miniedit.writeFile({ filePath: tmp, text: sample, encoding: 'gbk', eol: 'CRLF' });
          if (!w.ok) return { ok: false, stage: 'write', error: w.error };
          const r = await window.miniedit.readFile(tmp);
          if (!r.ok) return { ok: false, stage: 'read', error: r.error };
          return {
            ok: r.item.text === sample && r.item.encoding === 'gbk' && r.item.eol === 'CRLF',
            got: { encoding: r.item.encoding, eol: r.item.eol, same: r.item.text === sample, bytes: r.item.size },
            tmp,
          };
        })()`);
        console.log('SMOKE_IO ' + JSON.stringify(roundTrip));

        // 折叠：点第一个三角 → 可见行变少；再触发一次编辑意图 → 自动展开且正文复原
        const fold = await win.webContents.executeJavaScript(`(() => {
         try {
          const ta = document.getElementById('ta');
          const full = ta.value;
          const fullLines = full.split(String.fromCharCode(10)).length;
          const tris = [...document.querySelectorAll('#gutterInner [data-fold]')];
          const guides = document.querySelectorAll('#hlInner .ig').length;
          const grad = guides ? getComputedStyle(document.querySelector('#hlInner .ig')).backgroundImage.slice(0, 46) : '';
          if (!tris.length) return { ok: false, reason: '没有可折叠标记', guides };
          const idx = Number(tris[0].dataset.fold);
          tris[0].click();
          const afterLines = ta.value.split(String.fromCharCode(10)).length;
          const tri = document.querySelector('#gutterInner [data-fold="' + idx + '"]');
          const status = document.getElementById('stStats').textContent;
          ta.focus();
          ta.setSelectionRange(120, 120);
          ta.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', bubbles: true, cancelable: true }));
          return {
            ok: true,
            guides,
            grad,
            foldLine: idx + 1,
            removed: fullLines - afterLines,
            shrunk: ta.value.length < full.length || afterLines < fullLines,
            arrow: tri ? tri.textContent : '',
            status,
            restored: ta.value === full,
            caret: ta.selectionStart,
          };
         } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
        })()`);
        console.log('SMOKE_FOLD ' + JSON.stringify(fold));

        const info = await win.webContents.executeJavaScript(`(() => {
          const tabs = [...document.querySelectorAll('.tab .name')].map(n => n.textContent);
          const hint = document.getElementById('parseHint')?.textContent || '';
          const cs = getComputedStyle(document.documentElement);
          return {
            tabs, hint,
            bg: cs.getPropertyValue('--bg').trim(),
            fg: cs.getPropertyValue('--fg').trim(),
            themes: document.getElementById('theme').options.length,
            syntaxes: document.getElementById('syntax').options.length,
            title: document.title,
            ready: !!document.querySelector('#hlInner div'),
            spans: [...(document.querySelector('#hlInner > div:nth-child(2)')?.querySelectorAll('span') || [])]
              .slice(0, 3)
              .map((s) => [s.textContent.slice(0, 14), s.className, getComputedStyle(s).color]),
          };
        })()`);
        console.log('SMOKE_STATE ' + JSON.stringify(info));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.MINIEDIT_SMOKE, img.toPNG());
        console.log('SMOKE_OK');
      } catch (err) {
        console.log('SMOKE_FAIL', err.message);
      }
      forceClose = true;
      app.quit();
    }, 2500);
  });
}

// ---------- IPC ----------

ipcMain.handle('app:boot', () => {
  const b = reference.bundle();
  return {
    version: app.getVersion(),
    platform: process.platform,
    bundle: b,
    recent: state.recent.slice(),
    zoom: state.zoom || 0,
    theme: state.theme || '',
    userData: app.getPath('userData'),
  };
});

ipcMain.handle('app:close', () => {
  forceClose = true;
  if (win) win.close();
});

ipcMain.handle('app:set-dirty', (_e, dirty) => {
  rendererDirty = !!dirty;
});

ipcMain.handle('app:set-title', (_e, payload) => {
  if (!win) return;
  rendererDirty = !!payload.dirty;
  const mark = payload.dirty ? '● ' : '';
  win.setTitle(payload.name ? `${mark}${payload.name} — MiniEdit` : 'MiniEdit');
});

ipcMain.handle('app:set-theme', (_e, name) => {
  state.theme = name || '';
  saveState();
});

ipcMain.handle('app:set-zoom', (_e, zoom) => {
  state.zoom = Number(zoom) || 0;
  saveState();
});

ipcMain.handle('file:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '打开文件',
    defaultPath: state.lastDir || app.getPath('documents'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '所有文件', extensions: ['*'] },
      { name: '文本', extensions: ['txt', 'log', 'md', 'ini', 'conf', 'cfg', 'json'] },
      { name: '代码', extensions: ['c', 'h', 'cpp', 'js', 'ts', 'py', 'html', 'css', 'xml', 'sql', 'go', 'java', 'cs', 'php', 'rb', 'lua', 'sh', 'bat', 'ps1'] },
    ],
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) {
    try {
      out.push(readItem(p));
      addRecent(p);
    } catch (err) {
      await dialog.showMessageBox(win, { type: 'error', message: '打开失败', detail: `${path.basename(p)}\n${err.message}` });
    }
  }
  return out;
});

ipcMain.handle('file:read', async (_e, p) => {
  try {
    const item = readItem(p);
    addRecent(p);
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: err.message, path: p };
  }
});

ipcMain.handle('file:write', (_e, payload) => {
  try {
    return { ok: true, item: writeItem(payload) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:save-dialog', async (_e, { defaultName, text, encoding, eol }) => {
  const r = await dialog.showSaveDialog(win, {
    title: '另存为',
    defaultPath: path.join(state.lastDir || app.getPath('documents'), defaultName || '未命名.txt'),
    filters: [{ name: '所有文件', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    return { ok: true, item: writeItem({ filePath: r.filePath, text, encoding, eol }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:confirm-close', async (_e, name) => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: '未保存的更改',
    message: `“${name}” 有未保存的更改。`,
    detail: '要先保存吗？',
  });
  return ['save', 'discard', 'cancel'][r.response];
});

ipcMain.handle('dialog:error', async (_e, { message, detail }) => {
  await dialog.showMessageBox(win, { type: 'error', message, detail });
});

ipcMain.handle('recent:list', () => state.recent.slice());

ipcMain.handle('shell:reveal', (_e, p) => {
  if (p) shell.showItemInFolder(p);
});

ipcMain.handle('sample:read', (_e, name) => {
  try {
    return { ok: true, item: readItem(path.join(ROOT, 'assets', 'samples', name)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
