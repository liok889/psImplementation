#!/usr/bin/env python3
"""Decode a PNG (8-bit truecolor / grayscale, non-interlaced) using only the
Python standard library and emit a numeric fixture consumed by BOTH the C++
reference harness and the JavaScript implementation.

This guarantees that both implementations analyze byte-for-byte identical pixel
values, so any statistic mismatch is a genuine algorithmic difference rather
than an image-decoding discrepancy.

Outputs (in test/):
  - fixture_gray.txt : whitespace-separated header + grayscale pixels for C++
                       harness:  nx ny nz   then nx*ny floats (row-major,
                       index = i + j*nx), grayscale = (R+G+B)/3.
  - fixture.json     : {nx, ny, nz, gray:[...], rgb:[r-plane, g-plane, b-plane]}
                       for the JS test runner / browser.

The grayscale conversion matches the C++ reference grayscale() helper exactly:
gray = (R + G + B) / 3 (channels averaged), and iio reads 8-bit PNGs as floats
in [0, 255].
"""
import sys, os, zlib, struct, json

def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', "not a PNG"
    pos = 8
    width = height = bitdepth = colortype = interlace = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos+4])[0]
        ctype = data[pos+4:pos+8]
        cdata = data[pos+8:pos+8+length]
        pos += 12 + length  # skip CRC
        if ctype == b'IHDR':
            width, height, bitdepth, colortype, _comp, _filt, interlace = \
                struct.unpack('>IIBBBBB', cdata)
        elif ctype == b'IDAT':
            idat += cdata
        elif ctype == b'IEND':
            break
    assert bitdepth == 8, "only 8-bit supported (got %r)" % bitdepth
    assert interlace == 0, "interlaced PNG not supported"
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    raw = zlib.decompress(bytes(idat))
    bpp = channels  # bytes per pixel (8-bit)
    stride = width * bpp
    out = bytearray(height * stride)

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        if pa <= pb and pa <= pc: return a
        if pb <= pc: return b
        return c

    rp = 0
    for y in range(height):
        ftype = raw[rp]; rp += 1
        for x in range(stride):
            v = raw[rp]; rp += 1
            a = out[y*stride + x - bpp] if x >= bpp else 0
            b = out[(y-1)*stride + x] if y > 0 else 0
            c = out[(y-1)*stride + x - bpp] if (x >= bpp and y > 0) else 0
            if ftype == 0:   rec = v
            elif ftype == 1: rec = v + a
            elif ftype == 2: rec = v + b
            elif ftype == 3: rec = v + ((a + b) >> 1)
            elif ftype == 4: rec = v + paeth(a, b, c)
            else: raise ValueError("bad filter %d" % ftype)
            out[y*stride + x] = rec & 0xff
    return width, height, channels, out

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else \
        os.path.join(os.path.dirname(__file__), '..', 'reference', 'data', 'sample.png')
    outdir = sys.argv[2] if len(sys.argv) > 2 else \
        os.path.join(os.path.dirname(__file__), '..', 'test')
    w, h, ch, buf = read_png(src)
    N = w * h
    # planar float planes, index = i + j*w  (matches C++ i + j*nx convention)
    planes = [[0.0] * N for _ in range(ch)]
    for j in range(h):
        for i in range(w):
            base = (j * w + i) * ch
            for c in range(ch):
                planes[c][i + j*w] = float(buf[base + c])
    if ch >= 3:
        gray = [(planes[0][p] + planes[1][p] + planes[2][p]) / 3.0 for p in range(N)]
        rgb = planes[:3]
    else:
        gray = list(planes[0])
        rgb = [planes[0], planes[0], planes[0]]

    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, 'fixture_gray.txt'), 'w') as f:
        f.write("%d %d %d\n" % (w, h, 1))
        f.write(' '.join('%.9g' % v for v in gray))
        f.write('\n')
    with open(os.path.join(outdir, 'fixture.json'), 'w') as f:
        json.dump({'nx': w, 'ny': h, 'nz': 1, 'gray': gray,
                   'rgb': rgb}, f)
    print("decoded %dx%d ch=%d -> %s" % (w, h, ch, outdir))
    print("gray[0..4] =", gray[:5])
    print("gray mean  =", sum(gray)/N)

if __name__ == '__main__':
    main()
