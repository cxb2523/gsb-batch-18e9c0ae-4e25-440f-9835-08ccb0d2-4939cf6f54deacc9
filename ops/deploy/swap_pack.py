"""Replace files inside the browser game's code pack (_code.zip) and update its size in packs.json, with backups.

    python3 swap_pack.py <web folder> <tag> _code/toontown/x/Y.py=/path/to/Y.py [more ...]

<web folder> is /DATA/AppData/ot-live/web for the live site or /DATA/AppData/ot-test/web for the test copy. Players fetch the pack again
because its size (part of the cache key) changed. Only files that are already in the pack can be replaced. The old pack and packs.json are
kept as _code.zip.before-<tag> and packs.json.before-<tag>.
"""
import json
import os
import shutil
import sys
import zipfile

web, tag = sys.argv[1], sys.argv[2]
rep = dict(a.split('=', 1) for a in sys.argv[3:])
P = os.path.join(web, 'root/_packs/_code.zip')
J = os.path.join(web, 'root/packs.json')
shutil.copy2(P, P + '.before-' + tag)
shutil.copy2(J, J + '.before-' + tag)
src = zipfile.ZipFile(P + '.before-' + tag)
tmp = P + '.new'
done = set()
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_STORED) as out:
    for i in src.infolist():
        if i.filename in rep:
            data = open(rep[i.filename], 'rb').read()
            done.add(i.filename)
        else:
            data = src.read(i)
        out.writestr(i, data, compress_type=zipfile.ZIP_STORED)
if done != set(rep):
    os.remove(tmp)
    sys.exit('not in the pack: %s' % sorted(set(rep) - done))
os.replace(tmp, P)
packs = json.load(open(J))
assert packs[0][0] == '_code'
packs[0][1] = os.path.getsize(P)
open(J, 'w').write(json.dumps(packs))
print('code pack', packs[0][1])
