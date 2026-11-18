// 只读参考数据：原版的 syntax/*.mac 与 theme/*.ini 直接当配置读。
// 打包后这些文件在 asar 里，fs 仍可读。
const fs = require('node:fs');
const path = require('node:path');

function createReference(refDir) {
  let cache = null;

  function decode(buf) {
    if (buf.length > 1 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
    if (buf.length > 1 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        return new TextDecoder('gbk').decode(buf);
      } catch {
        return buf.toString('utf8');
      }
    }
  }

  const readText = (p) => decode(fs.readFileSync(p));

  function bundle() {
    if (cache) return cache;
    const synDir = path.join(refDir, 'syntax');
    const themeDir = path.join(refDir, 'theme');
    const syntaxes = fs.readdirSync(synDir).filter((f) => f.toLowerCase().endsWith('.mac')).sort();
    const themes = fs.readdirSync(themeDir).filter((f) => f.toLowerCase().endsWith('.ini')).sort();
    const files = {};
    for (const f of syntaxes) files[f] = readText(path.join(synDir, f));
    // .kwd 是外挂关键字表，php.mac 用 AddWordFromFile 按文件名取
    for (const f of fs.readdirSync(synDir).filter((x) => x.toLowerCase().endsWith('.kwd'))) {
      files[f] = readText(path.join(synDir, f));
    }
    const themeFiles = {};
    for (const f of themes) themeFiles[f] = readText(path.join(themeDir, f));
    let settings = '';
    try {
      settings = readText(path.join(refDir, 'setting.ini'));
    } catch {
      settings = '';
    }
    cache = { syntaxes, themes, files, themeFiles, settings, root: refDir, count: syntaxes.length + themes.length };
    return cache;
  }

  return { bundle, refDir, readText };
}


module.exports = { createReference };
