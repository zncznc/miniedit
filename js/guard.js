// 启动守卫：模块加载失败时页面会白屏，什么提示都没有。
// 这里把第一个错误写进标题和页面，至少能看见是哪个文件哪一行。

(function () {
  var shown = false;
  function show(msg, where) {
    if (shown) return;
    shown = true;
    document.title = 'ERR ' + msg;
    var box = document.createElement('pre');
    box.style.cssText = 'margin:0;padding:16px;font:13px Consolas,monospace;color:#b00;white-space:pre-wrap';
    box.textContent = 'MiniEdit 启动失败\n\n' + msg + (where ? '\n' + where : '');
    document.body.appendChild(box);
  }

  window.addEventListener('error', function (e) {
    if (e && e.target && e.target.tagName === 'SCRIPT') {
      show('脚本加载失败：' + (e.target.src || ''), '');
      return;
    }
    show((e && e.message) || '未知错误', e && e.filename ? e.filename + ':' + e.lineno : '');
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    show(String((r && (r.stack || r.message)) || r), '');
  });
})();
