# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Ledger Lever Windows bundle."""

import os
from PyInstaller.utils.hooks import collect_all, collect_data_files

block_cipher = None

# Collect hidden imports and data for packages that use dynamic loading
datas = []
hiddenimports = []

for pkg in ["yfinance", "apscheduler", "pandas", "sqlalchemy", "fastapi", "uvicorn", "pydantic"]:
    d, b, h = collect_all(pkg)
    datas += d
    hiddenimports += h

# Bundle the pre-built React frontend (built by CI before PyInstaller runs)
datas += [("frontend/dist", "frontend_dist")]

a = Analysis(
    ["launcher.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports + [
        "backend.app.main",
        "backend.app.crud",
        "backend.app.models",
        "backend.app.schemas",
        "backend.app.database",
        "backend.app.scheduler",
        "backend.app.yfinance_service",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "sqlalchemy.dialects.sqlite",
        "aiofiles",
        "python_multipart",
        "multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
    name="LedgerLever",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # no console window
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="LedgerLever",
)
