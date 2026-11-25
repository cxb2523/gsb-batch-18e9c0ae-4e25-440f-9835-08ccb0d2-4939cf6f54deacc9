"""Builds the Windows setup program: dist/TTAnywhere-Setup-<version>.exe, one file that installs the app zip for the current user (installer.py).

    python tools/build_installer.py dist/TTAnywhere-<version>-windows.zip      (needs: pip install pyinstaller)
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DESK = os.path.dirname(HERE)
version = open(os.path.join(DESK, "..", "VERSION")).read().strip()
zpath = os.path.abspath(sys.argv[1])
import PyInstaller.__main__ as pi

stage = os.path.join(DESK, "build", "installer-data")
os.makedirs(stage, exist_ok=True)
shutil.copyfile(zpath, os.path.join(stage, "app.zip"))
args = [os.path.join(DESK, "installer.py"), "--name", "TTAnywhere-Setup-%s" % version, "--noconfirm", "--onefile", "--noconsole",
        "--add-data", os.path.join(stage, "app.zip") + os.pathsep + ".", "--distpath", os.path.join(DESK, "dist"),
        "--workpath", os.path.join(DESK, "build", "installer"), "--specpath", os.path.join(DESK, "build"),
        "--icon", os.path.join(DESK, "assets", "tta.ico")]
pi.run(args)
print("built", os.path.join(DESK, "dist", "TTAnywhere-Setup-%s.exe" % version))
