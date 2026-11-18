# Sobe o Postgres (docker compose), espera o healthcheck, aplica migrations e
# inicia a API em --reload. Use -SkipDb quando o banco ja esta no ar.
#
# Strings sem acentuacao de proposito: o arquivo e UTF-8 sem BOM e o Windows
# PowerShell 5.1 le arquivos sem BOM como ANSI (acentos virariam mojibake).
[CmdletBinding()]
param(
    [int]$ApiPort = 8666,
    [string]$ApiHost = "0.0.0.0",
    [switch]$SkipDb
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"

if (-not $SkipDb) {
    docker compose -f (Join-Path $server "docker-compose.yml") up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose falhou (codigo $LASTEXITCODE)." }

    # Espera o healthcheck do Postgres antes do alembic (AGENTS.md 13):
    # sem isso, "alembic upgrade" pode rodar contra um banco que ainda nao aceita conexoes.
    # Nota: sem redirecionar o stderr do docker inspect - no PowerShell 5.1,
    # stderr redirecionado de comando nativo vira erro terminante com EAP=Stop.
    $status = ""
    for ($i = 0; $i -lt 40; $i++) {
        $status = docker inspect --format "{{.State.Health.Status}}" microzup-db
        if ($LASTEXITCODE -eq 0 -and $status -eq "healthy") { break }
        $status = ""
        Start-Sleep -Seconds 2
    }
    if ($status -ne "healthy") {
        throw "O Postgres nao ficou saudavel a tempo. Veja: docker logs microzup-db"
    }
}

Push-Location $server
try {
    uv sync
    if ($LASTEXITCODE -ne 0) { throw "uv sync falhou (codigo $LASTEXITCODE)." }
    uv run alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "alembic upgrade head falhou (codigo $LASTEXITCODE)." }
    Write-Host "API: http://localhost:$ApiPort"
    if ($ApiHost -eq "0.0.0.0") {
        $lanIp = (Get-NetIPConfiguration |
            Where-Object { $null -ne $_.IPv4DefaultGateway -and $_.IPv4Address.IPAddress -notlike "127.*" } |
            Select-Object -First 1).IPv4Address.IPAddress
        if ($lanIp) {
            Write-Host "Rede local: http://${lanIp}:$ApiPort"
        }
        Write-Host "Libere a porta TCP $ApiPort no firewall do Windows para acesso de outras maquinas."
    }
    uv run uvicorn app.main:app --reload --host $ApiHost --port $ApiPort
}
finally {
    Pop-Location
}
