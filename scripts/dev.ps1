[CmdletBinding()]
param(
    [int]$ApiPort = 8000,
    [switch]$SkipDb
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"

if (-not $SkipDb) {
    docker compose -f (Join-Path $server "docker-compose.yml") up -d

    $status = ""
    for ($i = 0; $i -lt 40; $i++) {
        $status = docker inspect --format "{{.State.Health.Status}}" microzup-db 2>$null
        if ($status -eq "healthy") { break }
        Start-Sleep -Seconds 2
    }
    if ($status -ne "healthy") {
        throw "O Postgres não ficou saudável a tempo. Veja: docker logs microzup-db"
    }
}

Push-Location $server
try {
    uv sync
    uv run alembic upgrade head
    uv run uvicorn app.main:app --reload --port $ApiPort
}
finally {
    Pop-Location
}
