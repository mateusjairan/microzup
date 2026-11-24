# -*- mode: python ; coding: utf-8 -*-
# Build: uv run pyinstaller microzup.spec --noconfirm
#
# Nota: o exe lê a configuração de variáveis de ambiente e do `.env` no
# diretório onde é EXECUTADO (não de onde está gravado) — em produção, o
# instalador coloca um .env ao lado do serviço (scripts/install-server.ps1).

from PyInstaller.utils.hooks import collect_all

# python-magic-bin (win32) empacota a DLL de libmagic e a base magic.mgc
# DENTRO do pacote `magic` (magic/libmagic/). Sem isto o exe falha em runtime
# com "failed to find libmagic" no primeiro upload.
magic_datas, magic_binaries, magic_hiddenimports = collect_all("magic")

# O SPA é parte do artefato: `web/dist` entra no bundle e é servido em `/`.
# Build: `npm run build` em web/ antes de rodar o PyInstaller.
import os

_web_dist = os.path.join(os.getcwd(), "..", "web", "dist")
web_datas = [(_web_dist, os.path.join("web", "dist"))] if os.path.isdir(_web_dist) else []

a = Analysis(
    ["app/run.py"],
    pathex=["."],
    binaries=magic_binaries,
    datas=[*magic_datas, *web_datas],
    hiddenimports=[
        "sqlalchemy.dialects.postgresql.psycopg",
        "psycopg",
        "psycopg_pool",
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        *magic_hiddenimports,
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
