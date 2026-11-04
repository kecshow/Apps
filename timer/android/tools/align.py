"""Minimal zipalign: rewrites an APK so every uncompressed entry's data starts on a 4-byte boundary."""
import sys, zipfile

def check(path):
    with zipfile.ZipFile(path) as z, open(path, 'rb') as f:
        for i in z.infolist():
            if i.compress_type == zipfile.ZIP_STORED:
                f.seek(i.header_offset + 26)
                n, m = int.from_bytes(f.read(2), 'little'), int.from_bytes(f.read(2), 'little')
                assert (i.header_offset + 30 + n + m) % 4 == 0, 'not aligned: ' + i.filename

if sys.argv[1] == '--check':
    check(sys.argv[2]); print('alignment ok'); sys.exit(0)

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, open(dst, 'wb') as raw:
    zout = zipfile.ZipFile(raw, 'w')
    for info in zin.infolist():
        data = zin.read(info.filename)
        ni = zipfile.ZipInfo(info.filename, date_time=(2008, 1, 1, 0, 0, 0))
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        ni.extra = b''
        if ni.compress_type == zipfile.ZIP_STORED:
            hdr_end = raw.tell() + 30 + len(ni.filename.encode('utf-8'))
            pad = (-hdr_end) % 4
            ni.extra = b'\x00' * pad
        zout.writestr(ni, data)
    zout.close()

check(dst)
print('aligned', dst)
