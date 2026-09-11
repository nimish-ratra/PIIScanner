# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Specification for PII Sentinel
Bundles Python runtime, PySide6, Microsoft Presidio, spaCy models, and Apache Tika wrapper.
"""

import sys
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

project_root = os.path.abspath(".")

# Collect data files
datas = []
datas += collect_data_files("presidio_analyzer")
datas += collect_data_files("en_core_web_sm")
datas.append((os.path.join(project_root, "packaging", "assets"), os.path.join("packaging", "assets")))
try:
    datas += collect_data_files("docx")
except Exception:
    pass
try:
    datas += collect_data_files("pptx")
except Exception:
    pass
try:
    datas += collect_data_files("reportlab")
except Exception:
    pass

# Collect hidden imports
hiddenimports = [
    "spacy",
    "spacy.lang.en",
    "en_core_web_sm",
    "presidio_analyzer",
    "presidio_analyzer.nlp_engine",
    "presidio_analyzer.predefined_recognizers",
    "tika",
    "pyzipper",
    "sqlite3",
    "csv",
    "json",
    "PIL",
    "backend.classifier",
    "docx",
    "openpyxl",
    "pptx",
    "pypdf",
    "reportlab",
    "psutil",
    "win32file",
    "win32api",
    "win32con",
    "win32com",
    "win32com.propsys",
]
hiddenimports += collect_submodules("presidio_analyzer")
hiddenimports += collect_submodules("spacy")
hiddenimports += collect_submodules("thinc")
hiddenimports += collect_submodules("blis")
hiddenimports += collect_submodules("en_core_web_sm")
hiddenimports += collect_submodules("docx")
hiddenimports += collect_submodules("openpyxl")
hiddenimports += collect_submodules("pptx")
hiddenimports += collect_submodules("pypdf")
hiddenimports += collect_submodules("reportlab")
hiddenimports += collect_submodules("psutil")

icon_file = os.path.join(project_root, "packaging", "assets", "app_icon.ico")

a = Analysis(
    [os.path.join(project_root, "main.py")],
    pathex=[project_root],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "notebook", "pytest"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PIISentinel",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # Windowed desktop application
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_file if os.path.exists(icon_file) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="PIISentinel",
)
