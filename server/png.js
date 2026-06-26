// Minimal PNG decoder for the PS server (Node built-in `zlib` only, no deps).
// Handles 8-bit grayscale / RGB / grayscale+alpha / RGBA, non-interlaced — and
// returns a grayscale Float64Array (gray = (R+G+B)/3, matching the rest of the
// pipeline). Palette (color type 3) and interlaced PNGs are not supported.
'use strict';
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len; // skip CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNGs supported (got ' + bitDepth + ')');
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported PNG color type ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let rec;
      if (ft === 0) rec = v;
      else if (ft === 1) rec = v + a;
      else if (ft === 2) rec = v + b;
      else if (ft === 3) rec = v + ((a + b) >> 1);
      else if (ft === 4) rec = v + paeth(a, b, c);
      else throw new Error('bad PNG filter ' + ft);
      out[y * stride + x] = rec & 0xff;
    }
  }
  const N = width * height, gray = new Float64Array(N);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const base = (j * width + i) * channels;
    gray[i + j * width] = channels >= 3 ? (out[base] + out[base + 1] + out[base + 2]) / 3 : out[base];
  }
  return { nx: width, ny: height, gray };
}

module.exports = { decodePNG };
