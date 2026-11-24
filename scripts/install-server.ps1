# Empacota o servidor com PyInstaller (server/microzup.spec -> dist/microzup-server.exe)
# e o instala como servico do Windows via NSSM. O banco precisa estar no ar
# (o passo "alembic upgrade head" conecta como microzup_owner).
#
# Strings sem acentuacao de proposito: o arquivo e UTF-8 sem BOM e o Windows
# PowerShell 5.1 le arquivos sem BOM como ANSI (acentos virariam mojibake).
[CmdletBinding()]
param(
    [string]$ServiceName = "Microzup",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$server = Join-Path (Split-Path -Parent $PSScriptRoot) "server"

Push-Location $server
try {
    uv sync
    if ($LASTEXITCODE -ne 0) { throw "uv sync falhou (codigo $LASTEXITCODE)." }
    uv run alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "alembic upgrade head falhou (codigo $LASTEXITCODE). O Postgres esta no ar e saudavel? (scripts/dev.ps1)"
    }

    if (-not $SkipBuild) {
        # O SPA e servido pelo backend: sem web\dist o exe sobe e "/" da 404.
        $web = Join-Path (Split-Path -Parent $PSScriptRoot) "web"
        Push-Location $web
        try {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci falhou (codigo $LASTEXITCODE)." }
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build falhou (codigo $LASTEXITCODE)." }
        }
        finally {
            Pop-Location
        }

        uv run pyinstaller --noconfirm --clean microzup.spec
        if ($LASTEXITCODE -ne 0) { throw "pyinstaller falhou (codigo $LASTEXITCODE)." }
    }

    $exe = Join-Path $server "dist\microzup-server.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "Binario nao encontrado em $exe. Rode sem -SkipBuild."
    }

    # Servico Windows via NSSM, se disponivel.
    if (Get-Command nssm -ErrorAction SilentlyContinue) {
        $logs = Join-Path $server "data\logs"
        New-Item -ItemType Directory -Force -Path $logs | Out-Null

        nssm install $ServiceName $exe
        if ($LASTEXITCODE -ne 0) { throw "nssm install falhou (codigo $LASTEXITCODE)." }
        # AppDirectory = pasta do .env e do data\ (STORAGE_DIR relativo).
        nssm set $ServiceName AppDirectory $server
        if ($LASTEXITCODE -ne 0) { throw "nssm set AppDirectory falhou." }
        # Logs do servico com rotacao por tamanho (o server.log da aplicacao
        # ja tem rotacao diaria propria; ver docs/operacao.md secao 5).
        nssm set $ServiceName AppStdout (Join-Path $logs "service-out.log") | Out-Null
        nssm set $ServiceName AppStderr (Join-Path $logs "service-err.log") | Out-Null
        nssm set $ServiceName AppRotateFiles 1 | Out-Null
        nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
        nssm start $ServiceName
        if ($LASTEXITCODE -ne 0) { throw "nssm start falhou (codigo $LASTEXITCODE)." }
        Write-Host "Servico $ServiceName instalado e iniciado."
        Write-Host "Verifique: nssm status $ServiceName  e  http://localhost:8666/health"
    }
    else {
        Write-Host "NSSM nao encontrado. Instale (choco install nssm ou nssm.cc) e rode:"
        Write-Host "  nssm install $ServiceName $exe"
    }
}
finally {
    Pop-Location
}
