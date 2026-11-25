"""Replace files inside the browser game's glue archives (game_ot.tar.gz and game_ot.apk), with backups.

    python3 swap_glue.py <_play folder> <tag> webui.py=/path/to/webui.py [more ...]

The live page loads a versioned copy (game_ot-<number>.tar.gz, named in index.html): after patching, copy game_ot.tar.gz to a new number and
point index.html at it so browsers fetch it again.
"""
import sys, io, tarfile, zipfile, shutil, os
d, tag = sys.argv[1], sys.argv[2]
rep = {}
for a in sys.argv[3:]:
    k, v = a.split('=', 1); rep['assets/' + k] = open(v, 'rb').read()
for name in ('game_ot.tar.gz', 'game_ot.apk'):
    p = os.path.join(d, name)
    shutil.copy2(p, p + '.before-' + tag)
    seen = set()
    if name.endswith('.gz'):
        src = tarfile.open(p + '.before-' + tag, 'r:gz'); out = tarfile.open(p + '.new', 'w:gz')
        for m in src.getmembers():
            f = src.extractfile(m)
            if m.name in rep:
                m.size = len(rep[m.name]); out.addfile(m, io.BytesIO(rep[m.name])); seen.add(m.name)
            else:
                out.addfile(m, f)
        out.close()
    else:
        src = zipfile.ZipFile(p + '.before-' + tag); out = zipfile.ZipFile(p + '.new', 'w', zipfile.ZIP_DEFLATED)
        for i in src.infolist():
            if i.filename in rep: out.writestr(i, rep[i.filename]); seen.add(i.filename)
            else: out.writestr(i, src.read(i))
        out.close()
    assert seen == set(rep), set(rep) - seen
    os.replace(p + '.new', p)
    print(name, os.path.getsize(p))
