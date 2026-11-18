# Backup do Microzup: dump logico do Postgres (pg_dump -Fc) + copia dos arquivos de data/.
#
# Dois modos, escolhidos automaticamente:
#   1. Local  - pg_dump no PATH do host + variavel BACKUP_DSN com a DSN completa.
#               Ex.: $env:BACKUP_DSN = "postgresql://microzup_owner:senha@localhost:55432/microzup"
#   2. Docker - quando o host nao tem as ferramentas do Postgres: usa o pg_dump do
#               container (docker exec) e traz o dump com docker cp.
#
# Strings sem acentuacao de proposito: arquivo e UTF-8 sem BOM e o Windows
# PowerShell 5.1 le arquivos sem BOM como ANSI (acentos virariam mojibake).
[CmdletBinding()]
param(
    [string]$BackupDir = "C:\backups\microzup",
    [string]$DbName = "microzup",
    [string]$DbUser = "microzup_owner",
    [string]$ContainerName = "microzup-db"
)

$ErrorActionPreference = "Stop"

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Path -LiteralPath $BackupDir)) {
    throw "Diretorio de backup inexistente: $BackupDir (crie-o antes ou passe -BackupDir)."
}

$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $BackupDir $stamp
$dumpPath = Join-Path $out "microzup.dump"
New-Item -ItemType Directory -Force -Path $out | Out-Null

# --- 1) dump logico do banco -------------------------------------------
if ((Test-CommandExists pg_dump) -and $env:BACKUP_DSN) {
    pg_dump -Fc -d $env:BACKUP_DSN -f $dumpPath
    if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (codigo $LASTEXITCODE)." }
}
elseif (Test-CommandExists docker) {
    $running = @(docker ps --filter "name=$ContainerName" --format "{{.Names}}")
    if ($LASTEXITCODE -ne 0) { throw "Docker respondeu com erro. O daemon esta em execucao?" }
    if ($running -notcontains $ContainerName) {
        throw "Container '$ContainerName' nao esta em execucao. Suba o Postgres ou instale o pg_dump no host (veja docs/operacao.md)."
    }
    docker exec $ContainerName pg_dump -U $DbUser -d $DbName -Fc -f /tmp/microzup.dump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump (docker) falhou (codigo $LASTEXITCODE)." }
    docker cp "${ContainerName}:/tmp/microzup.dump" $dumpPath
    if ($LASTEXITCODE -ne 0) { throw "docker cp do dump falhou (codigo $LASTEXITCODE)." }
    docker exec $ContainerName rm -f /tmp/microzup.dump
    if ($LASTEXITCODE -ne 0) { throw "limpeza do temporario no container falhou." }
}
else {
    throw "Sem pg_dump no PATH (com BACKUP_DSN definida) e sem Docker disponivel. Veja docs/operacao.md, secao Backup."
}

if (-not (Test-Path -LiteralPath $dumpPath)) {
    throw "Dump nao foi criado em $dumpPath."
}

# --- 2) arquivos de data/ (robocopy incremental) ------------------------
$data = Join-Path $server "data"
if (Test-Path -LiteralPath $data) {
    robocopy $data (Join-Path $out "files") /E /NFL /NDL /NJH /NJS | Out-Null
    # robocopy: codigo 0-7 e sucesso; 8+ e falha.
    if ($LASTEXITCODE -ge 8) { throw "robocopy falhou (codigo $LASTEXITCODE)." }
    $LASTEXITCODE = 0
}
else {
    Write-Warning "server\data nao existe; o backup contem apenas o dump do banco."
}

Write-Host "Backup concluido em $out"
Write-Host "Dump: $dumpPath"
Write-Host "Restore: .\scripts\restore.ps1 -DumpFile `"$dumpPath`""
