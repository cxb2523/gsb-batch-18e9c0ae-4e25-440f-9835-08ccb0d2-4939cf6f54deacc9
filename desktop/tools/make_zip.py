"""Zips the packaged Windows app the way the updater and Setup expect it: every file under a top folder named TTAnywhere/.

    python tools/make_zip.py out/TTAnywhere-win32-x64 dist/TTAnywhere-<version>-windows.zip
"""
import os
import sys
import zipfile

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
if os.path.exists(dst):
    os.remove(dst)
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _dirs, files in os.walk(src):
        for fn in files:
            full = os.path.join(root, fn)
            z.write(full, "TTAnywhere/" + os.path.relpath(full, src).replace(os.sep, "/"))
print("wrote", dst, "%.0f MB" % (os.path.getsize(dst) / 1048576))
