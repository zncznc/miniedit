// 编码与行尾：检测 + 写回。GBK 用 iconv-lite，UTF-16 手工拼。
const iconv = require('iconv-lite');

const BOM = {
  'utf-8-bom': Buffer.from([0xef, 0xbb, 0xbf]),
  'utf-16le': Buffer.from([0xff, 0xfe]),
  'utf-16be': Buffer.from([0xfe, 0xff]),
};

const ENCODINGS = ['utf-8', 'utf-8-bom', 'gbk', 'utf-16le', 'utf-16be'];

const ENCODING_LABEL = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  gbk: 'GBK',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
};

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  let nul = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) nul++;
  return n > 0 && nul / n > 0.02;
}

function detect(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf-8-bom', text: buf.subarray(3).toString('utf8'), binary: false };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: 'utf-16le', text: new TextDecoder('utf-16le').decode(buf.subarray(2)), binary: false };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: 'utf-16be', text: new TextDecoder('utf-16be').decode(buf.subarray(2)), binary: false };
  }
  if (looksBinary(buf)) {
    // 不是文本：按 latin1 展示字节，避免整片乱码，同时标记出来
    return { encoding: 'binary', text: buf.toString('latin1'), binary: true };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { encoding: 'utf-8', text, binary: false };
  } catch {
    return { encoding: 'gbk', text: iconv.decode(buf, 'gbk'), binary: false };
  }
}

function encode(text, encoding) {
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([BOM['utf-8-bom'], Buffer.from(text, 'utf8')]);
    case 'utf-16le':
      return Buffer.concat([BOM['utf-16le'], Buffer.from(text, 'utf16le')]);
    case 'utf-16be': {
      const le = Buffer.from(text, 'utf16le');
      const be = Buffer.alloc(le.length);
      for (let i = 0; i + 1 < le.length; i += 2) {
        be[i] = le[i + 1];
        be[i + 1] = le[i];
      }
      return Buffer.concat([BOM['utf-16be'], be]);
    }
    case 'gbk':
      return iconv.encode(text, 'gbk');
    case 'binary':
      return Buffer.from(text, 'latin1');
    default:
      return Buffer.from(text, 'utf8');
  }
}

function decodeAs(buf, encoding) {
  if (encoding === 'utf-8-bom') return buf.subarray(3).toString('utf8');
  if (encoding === 'utf-16le') return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (encoding === 'utf-16be') return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (encoding === 'gbk') return iconv.decode(buf, 'gbk');
  if (encoding === 'binary') return buf.toString('latin1');
  return buf.toString('utf8');
}

function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const cr = (text.match(/\r(?!\n)/g) || []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return 'CRLF';
  if (cr > lf && cr > 0) return 'CR';
  return 'LF';
}

function normalizeEol(text, eol) {
  const unified = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (eol === 'CRLF') return unified.replace(/\n/g, '\r\n');
  if (eol === 'CR') return unified.replace(/\n/g, '\r');
  return unified;
}


module.exports = { detect, encode, decodeAs, detectEol, normalizeEol, ENCODINGS, ENCODING_LABEL };
