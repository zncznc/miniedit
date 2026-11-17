// 读 PNG 采样某几行的主要颜色，用来核对“这段文字到底渲染成什么颜色”
import fs from 'node:fs';
import zlib from 'node:zlib';

export function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8bit');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('不支持的 colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[x] = (line[x] + a) & 0xff; break;
        case 2: line[x] = (line[x] + b) & 0xff; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error('filter ' + filter);
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { width, height, channels, data: out };
}

// 找一行里最亮的像素颜色（文字笔画），用来判断可读性
export function brightestInRow(img, y, x0, x1) {
  let best = null;
  let bestLum = -1;
  for (let x = x0; x < x1; x++) {
    const i = y * img.width * img.channels + x * img.channels;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > bestLum) { bestLum = lum; best = [r, g, b]; }
  }
  return { rgb: best, lum: Math.round(bestLum) };
}

if (process.argv[1] && process.argv[1].endsWith('sample-png.mjs')) {
  const img = decodePng(fs.readFileSync(process.argv[2]));
  console.log('size', img.width, 'x', img.height, 'channels', img.channels);
  for (const y of process.argv.slice(3).map(Number)) {
    console.log('row', y, JSON.stringify(brightestInRow(img, y, 0, img.width)));
  }
}
