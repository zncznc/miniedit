import struct, zlib, sys

def read_png(path):
    return open(path, 'rb').read()

sizes = [16, 24, 32, 48, 64, 128, 256]
files = {s: f"build/icon-{s}.png" for s in sizes}
images = []
for s in sizes:
    data = read_png(files[s])
    assert data[:8] == b'\x89PNG\r\n\x1a\n', files[s]
    images.append((s, data))

count = len(images)
header = struct.pack('<HHH', 0, 1, count)
offset = 6 + 16 * count
entries = b''
blob = b''
for s, data in images:
    w = 0 if s >= 256 else s
    h = 0 if s >= 256 else s
    entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
    blob += data

out = header + entries + blob
open('build/icon.ico', 'wb').write(out)
print('wrote build/icon.ico', len(out), 'bytes,', count, 'sizes')
