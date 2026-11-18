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
    Write-Host "API: http://localhost:$ApiPort"
    if ($ApiHost -eq "0.0.0.0") {
        $lanIp = (Get-NetIPConfiguration |
            Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address.IPAddress -notlike "127.*" } |
            Select-Object -First 1).IPv4Address.IPAddress
        if ($lanIp) {
            Write-Host "Rede local: http://${lanIp}:$ApiPort"
        }
        Write-Host "Libere a porta TCP $ApiPort no firewall do Windows para acesso de outras máquinas."
    }
    uv run uvicorn app.main:app --reload --host $ApiHost --port $ApiPort
}
finally {
    Pop-Location
}
