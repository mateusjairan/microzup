[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$server = Join-Path (Split-Path -Parent $PSScriptRoot) "server"

Push-Location $server
try {
    uv sync
    uv run alembic upgrade head

    if (-not $SkipBuild) {
        uv run pyinstaller --noconfirm --clean microzup.spec
    }

    $exe = Join-Path $server "dist\microzup-server.exe"
    if (-not (Test-Path $exe)) {
        throw "Binário não encontrado em $exe. Rode sem -SkipBuild."
    }

    # Serviço Windows via NSSM, se disponível.
    if (Get-Command nssm -ErrorAction SilentlyContinue) {
        nssm install Microzup $exe
        nssm set Microzup AppDirectory $server
        nssm start Microzup
        Write-Host "Serviço Microzup instalado e iniciado."
    }
    else {
        Write-Host "NSSM não encontrado. Instale e rode: nssm install Microzup $exe"
    }
}
finally {
    Pop-Location
}
