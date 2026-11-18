# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ["app/run.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=[
        "sqlalchemy.dialects.postgresql.psycopg",
        "psycopg",
        "psycopg_pool",
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="microzup-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
