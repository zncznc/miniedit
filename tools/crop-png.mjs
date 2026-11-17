// 裁剪 + 放大 PNG（用于放大检查界面细节；只依赖 zlib）
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodePng } from './sample-png.mjs';

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

export function cropScale(img, { x, y, w, h, scale = 2 }) {
  const outW = w * scale;
  const outH = h * scale;
  const out = Buffer.alloc(outW * outH * 3);
  for (let oy = 0; oy < outH; oy++) {
    const sy = y + Math.floor(oy / scale);
    for (let ox = 0; ox < outW; ox++) {
      const sx = x + Math.floor(ox / scale);
      const si = sy * img.width * img.channels + sx * img.channels;
      const di = (oy * outW + ox) * 3;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
    }
  }
  return encodePng(outW, outH, out);
}

// 用法：node tools/crop-png.mjs in.png x y w h scale out.png
if (process.argv[1] && process.argv[1].endsWith('crop-png.mjs')) {
  const [, , src, x, y, w, h, scale, dest] = process.argv;
  const img = decodePng(fs.readFileSync(src));
  fs.writeFileSync(dest, cropScale(img, { x: +x, y: +y, w: +w, h: +h, scale: +(scale || 2) }));
  console.log(`crop ${w}x${h} @${x},${y} ×${scale} -> ${dest}`);
}
