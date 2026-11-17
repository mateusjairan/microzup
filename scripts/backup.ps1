[CmdletBinding()]
param(
    [string]$BackupDir = "C:\backups\microzup"
)

$ErrorActionPreference = "Stop"

# Requer pg_dump no PATH e a variável BACKUP_DSN apontando para o banco.
# Ex.: BACKUP_DSN=postgresql://microzup_owner:senha@localhost:55432/microzup
if (-not $env:BACKUP_DSN) {
    throw "Defina a variável BACKUP_DSN com a DSN do PostgreSQL."
}

$server = Join-Path (Split-Path -Parent $PSScriptRoot) "server"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $BackupDir $stamp
New-Item -ItemType Directory -Force -Path $out | Out-Null

pg_dump -Fc -d $env:BACKUP_DSN -f (Join-Path $out "microzup.dump")
if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou." }

$data = Join-Path $server "data"
if (Test-Path $data) {
    robocopy $data (Join-Path $out "files") /E /NFL /NDL /NJH /NJS | Out-Null
}

Write-Host "Backup concluído em $out"
