# Restore do Microzup a partir de um backup gerado por scripts/backup.ps1.
#
# Passos executados:
#   1. Garante os papeis de banco (microzup_owner / microzup_app) e seus grants;
#   2. Cria (ou recria, com -DropTarget) o banco de destino;
#   3. pg_restore do dump (formato custom -Fc);
#   4. Reaplica os grants canonicos das migrations (idempotente);
#   5. alembic upgrade head (no-op se o dump ja esta no head);
#   6. robocopy dos arquivos de data/ (pasta "files" do backup);
#   7. Smoke test: contagens do banco restaurado + existencia/integridade
#      (tamanho e SHA-256) de cada anexo no disco.
#
# Modos de acesso ao Postgres (automatico):
#   - Local:  pg_restore/psql no PATH do host + -AdminDsn apontando para o banco
#             de manutencao "postgres" com papel administrador.
#   - Docker: quando o host nao tem as ferramentas, usa as do container
#             (-ContainerName, padrao microzup-db) via docker exec/docker cp.
#
# Exemplos:
#   .\scripts\restore.ps1 -DumpFile C:\backups\microzup\20261118-140000\microzup.dump -OwnerPassword <senha>
#   .\scripts\restore.ps1 -DumpFile ...\microzup.dump -TargetDatabase microzup_restore_test -DropTarget `
#       -OwnerPassword <senha> -DataDir C:\temp\microzup-data -SourceDatabase microzup
#
# Strings sem acentuacao de proposito: o arquivo e UTF-8 sem BOM e o Windows
# PowerShell 5.1 le arquivos sem BOM como ANSI (acentos virariam mojibake).
[CmdletBinding()]
param(
    # Dump gerado por scripts/backup.ps1 (formato custom do pg_dump -Fc).
    [Parameter(Mandatory = $true)]
    [string]$DumpFile,

    # Pasta "files" do backup (copia de server\data feita pelo backup.ps1).
    # Padrao: pasta "files" ao lado do dump.
    [string]$FilesDir = "",

    # Destino dos arquivos (STORAGE_DIR do servidor). Padrao: <repo>\server\data.
    [string]$DataDir = "",

    # Nome do banco de destino do restore.
    [string]$TargetDatabase = "microzup",

    # Se informado, o smoke test compara as contagens do banco de origem com as
    # do banco restaurado (users/mensagens/anexos devem bater).
    [string]$SourceDatabase = "",

    # Modo local: DSN com papel administrador apontando para o banco "postgres".
    # Ex.: postgresql://microzup_owner:senha@localhost:55432/postgres
    [string]$AdminDsn = "",

    # URL usada pelo Alembic (papel owner, banco de destino). Se vazia, e derivada
    # de -DbHost/-DbPort/-OwnerRole/-OwnerPassword.
    # Ex.: postgresql+psycopg://microzup_owner:senha@localhost:55432/microzup
    [string]$MigrationUrl = "",

    [string]$DbHost = "localhost",
    [int]$DbPort = 55432,

    # Papel de DDL (migrations/Alembic). Credenciais de dev: server/docker-compose.yml.
    [string]$OwnerRole = "microzup_owner",
    [string]$OwnerPassword = "",

    # Papel de runtime (sem UPDATE/DELETE em audit_log).
    # Credenciais de dev: server/infra/initdb/01-init.sql.
    [string]$AppRole = "microzup_app",
    [string]$AppRolePassword = "",

    [string]$ContainerName = "microzup-db",

    # Apaga e recria o banco de destino antes do restore (para re-testes).
    [switch]$DropTarget,

    # Pula o "alembic upgrade head" (o dump ja traz o schema e o alembic_version).
    [switch]$SkipMigrations
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Escape-SqlLiteral([string]$Value) {
    return $Value.Replace("'", "''")
}

$script:UseDocker = $false
$script:Step = 0

$script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("microzup-restore-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $script:TempDir | Out-Null

function Write-TempSql([string]$Content) {
    $script:Step = $script:Step + 1
    $path = Join-Path $script:TempDir ("step-{0:d2}.sql" -f $script:Step)
    # ASCII deliberado: todo o SQL gerado aqui nao usa acentos.
    [System.IO.File]::WriteAllText($path, $Content, [System.Text.Encoding]::ASCII)
    return $path
}

function Get-LocalDsn([string]$Database) {
    if ($AdminDsn -notmatch '/postgres/?$') {
        throw "No modo local, -AdminDsn deve apontar para o banco de manutencao 'postgres'. Ex.: postgresql://usuario:senha@host:porta/postgres"
    }
    return $AdminDsn -replace '/postgres/?$', ("/" + $Database)
}

# Executa uma consulta e devolve as linhas (psql -t -A -F "|").
function Invoke-Query {
    param(
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$Sql
    )
    $result = $null
    if ($script:UseDocker) {
        $psqlArgs = @(
            "exec", $ContainerName, "psql",
            "-U", $OwnerRole, "-d", $Database,
            "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|", "-c", $Sql
        )
        $result = & docker @psqlArgs
    }
    else {
        $d = Get-LocalDsn $Database
        $psqlArgs = @("-d", $d, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|", "-c", $Sql)
        $result = & psql @psqlArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Consulta SQL falhou (codigo $LASTEXITCODE) no banco '$Database': $Sql"
    }
    $lines = @()
    foreach ($line in @($result)) {
        if ($null -ne $line -and $line.Trim() -ne "") { $lines += $line.TrimEnd() }
    }
    return ,$lines
}

# Executa um arquivo .sql com ON_ERROR_STOP=1.
function Invoke-SqlFile {
    param(
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$SqlFile
    )
    if ($script:UseDocker) {
        $remote = "/tmp/microzup-restore/" + (Split-Path -Leaf $SqlFile)
        docker cp $SqlFile "${ContainerName}:$remote"
        if ($LASTEXITCODE -ne 0) { throw "docker cp do SQL falhou (codigo $LASTEXITCODE)." }
        $psqlArgs = @(
            "exec", $ContainerName, "psql",
            "-U", $OwnerRole, "-d", $Database,
            "-v", "ON_ERROR_STOP=1", "-f", $remote
        )
        & docker @psqlArgs
    }
    else {
        $d = Get-LocalDsn $Database
        $psqlArgs = @("-d", $d, "-v", "ON_ERROR_STOP=1", "-f", $SqlFile)
        & psql @psqlArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "psql -f falhou (codigo $LASTEXITCODE) no banco '$Database' com $SqlFile."
    }
}

# ---------------------------------------------------------------------------
# 0. Validacao de entrada e escolha do modo de acesso ao Postgres
# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $DumpFile)) {
    throw "Dump nao encontrado: $DumpFile"
}

if ($FilesDir -eq "") {
    $FilesDir = Join-Path (Split-Path -Parent $DumpFile) "files"
}
if ($DataDir -eq "") {
    $repo = Split-Path -Parent $PSScriptRoot
    $DataDir = Join-Path (Join-Path $repo "server") "data"
}

if ($OwnerRole -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$' -or
    $AppRole -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$' -or
    $TargetDatabase -notmatch '^[a-zA-Z_][a-zA-Z0-9_-]*$' -or
    ($SourceDatabase -ne "" -and $SourceDatabase -notmatch '^[a-zA-Z_][a-zA-Z0-9_-]*$')) {
    throw "Nome de papel ou de banco contem caracteres invalidos."
}

$hasPgTools = (Test-CommandExists pg_restore) -and (Test-CommandExists psql)
if ($AdminDsn -ne "" -and $hasPgTools) {
    $script:UseDocker = $false
    Write-Host "[modo local] pg_restore/psql do host + AdminDsn"
}
elseif (Test-CommandExists docker) {
    $running = @(docker ps --filter "name=$ContainerName" --format "{{.Names}}")
    if ($LASTEXITCODE -ne 0) { throw "Docker respondeu com erro. O daemon esta em execucao?" }
    if ($running -notcontains $ContainerName) {
        throw "Container '$ContainerName' nao esta em execucao. Opcoes: suba o Postgres (docker compose -f server/docker-compose.yml up -d), ou instale pg_restore/psql no host e passe -AdminDsn."
    }
    $script:UseDocker = $true
    # O docker cp nao cria diretorios intermediarios no container.
    docker exec $ContainerName mkdir -p /tmp/microzup-restore
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel criar /tmp/microzup-restore no container '$ContainerName'." }
    Write-Host "[modo docker] usando as ferramentas do container '$ContainerName'"
}
else {
    throw "Sem acesso ao Postgres: instale pg_restore/psql no host e passe -AdminDsn, ou tenha o container '$ContainerName' em execucao via Docker."
}

if ((Test-Path -LiteralPath $FilesDir) -and (Test-Path -LiteralPath $DataDir)) {
    $sameSrc = [System.IO.Path]::GetFullPath($FilesDir)
    $sameDst = [System.IO.Path]::GetFullPath($DataDir)
    if ($sameSrc -eq $sameDst) {
        throw "Pasta de arquivos do backup (-FilesDir) e o destino (-DataDir) sao o mesmo caminho: $sameSrc"
    }
}

try {
    # -----------------------------------------------------------------------
    # 1. Papeis de banco (o pg_dump nao inclui CREATE ROLE)
    # -----------------------------------------------------------------------
    Write-Host "=> Passo 1/7: garantindo papeis de banco ($OwnerRole / $AppRole)"
    $existingRoles = Invoke-Query -Database "postgres" -Sql ("SELECT rolname FROM pg_roles WHERE rolname IN ('{0}','{1}');" -f (Escape-SqlLiteral $OwnerRole), (Escape-SqlLiteral $AppRole))
    $missingOwner = $existingRoles -notcontains $OwnerRole
    $missingApp = $existingRoles -notcontains $AppRole
    if ($missingOwner -and $OwnerPassword -eq "") {
        throw "O papel '$OwnerRole' nao existe no cluster e -OwnerPassword nao foi informada (necessaria para cria-lo)."
    }
    if ($missingApp -and $AppRolePassword -eq "") {
        throw "O papel '$AppRole' nao existe no cluster e -AppRolePassword nao foi informada. Esse papel normalmente e criado por server/infra/initdb/01-init.sql na primeira subida do container."
    }
    if ($missingOwner -or $missingApp) {
        $parts = New-Object System.Collections.Generic.List[string]
        if ($missingOwner) {
            $parts.Add(("CREATE ROLE {0} LOGIN PASSWORD '{1}';" -f $OwnerRole, (Escape-SqlLiteral $OwnerPassword)))
        }
        if ($missingApp) {
            $parts.Add(("CREATE ROLE {0} LOGIN PASSWORD '{1}';" -f $AppRole, (Escape-SqlLiteral $AppRolePassword)))
        }
        Invoke-SqlFile -Database "postgres" -SqlFile (Write-TempSql (($parts -join "`n") + "`n"))
        Write-Host "   Papel(is) criado(s) conforme necessario."
    }
    else {
        Write-Host "   Ambos os papeis ja existem; nada a criar."
    }

    # -----------------------------------------------------------------------
    # 2. Banco de destino
    # -----------------------------------------------------------------------
    Write-Host "=> Passo 2/7: preparando banco de destino '$TargetDatabase'"
    $dbExists = Invoke-Query -Database "postgres" -Sql ("SELECT 1 FROM pg_database WHERE datname = '{0}';" -f (Escape-SqlLiteral $TargetDatabase))
    if ($DropTarget -and $dbExists.Count -gt 0) {
        Write-Host "   -DropTarget: apagando banco existente..."
        Invoke-SqlFile -Database "postgres" -SqlFile (Write-TempSql (('DROP DATABASE IF EXISTS "{0}" WITH (FORCE);' -f $TargetDatabase) + "`n"))
        $dbExists = Invoke-Query -Database "postgres" -Sql ("SELECT 1 FROM pg_database WHERE datname = '{0}';" -f (Escape-SqlLiteral $TargetDatabase))
    }
    if ($dbExists.Count -gt 0) {
        Write-Host "   Banco ja existe; o pg_restore roda com --clean --if-exists (objetos do dump sao recriados)."
    }
    else {
        Invoke-SqlFile -Database "postgres" -SqlFile (Write-TempSql (('CREATE DATABASE "{0}" OWNER {1};' -f $TargetDatabase, $OwnerRole) + "`n"))
        Write-Host "   Banco criado (owner: $OwnerRole)."
    }

    # -----------------------------------------------------------------------
    # 3. pg_restore
    # -----------------------------------------------------------------------
    Write-Host "=> Passo 3/7: pg_restore do dump"
    if ($script:UseDocker) {
        $remoteDump = "/tmp/microzup-restore/microzup.dump"
        docker cp $DumpFile "${ContainerName}:$remoteDump"
        if ($LASTEXITCODE -ne 0) { throw "docker cp do dump falhou (codigo $LASTEXITCODE)." }
        $restoreArgs = @(
            "exec", $ContainerName, "pg_restore",
            "-U", $OwnerRole, "-d", $TargetDatabase,
            "--clean", "--if-exists", "--exit-on-error", $remoteDump
        )
        & docker @restoreArgs
    }
    else {
        $d = Get-LocalDsn $TargetDatabase
        $restoreArgs = @("-d", $d, "--clean", "--if-exists", "--exit-on-error", $DumpFile)
        & pg_restore @restoreArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "pg_restore falhou (codigo $LASTEXITCODE). Verifique se o dump nao esta corrompido e se os papeis existem."
    }
    Write-Host "   Dump restaurado."

    # -----------------------------------------------------------------------
    # 4. Grants canonicos (idempotentes; iguais aos das migrations)
    # -----------------------------------------------------------------------
    Write-Host "=> Passo 4/7: reaplicando grants para '$AppRole'"
    $grantsSql = @'
GRANT USAGE ON SCHEMA public TO {{APP}};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {{APP}};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {{APP}};
DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
        REVOKE UPDATE, DELETE ON TABLE audit_log FROM {{APP}};
    END IF;
END
$do$;
ALTER DEFAULT PRIVILEGES FOR ROLE {{OWNER}} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {{APP}};
ALTER DEFAULT PRIVILEGES FOR ROLE {{OWNER}} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO {{APP}};
'@
    $grantsSql = $grantsSql.Replace("{{APP}}", $AppRole).Replace("{{OWNER}}", $OwnerRole)
    Invoke-SqlFile -Database $TargetDatabase -SqlFile (Write-TempSql $grantsSql)
    Write-Host "   Grants ok (audit_log continua sem UPDATE/DELETE para $AppRole)."

    # -----------------------------------------------------------------------
    # 5. alembic upgrade head
    # -----------------------------------------------------------------------
    if ($SkipMigrations) {
        Write-Host "=> Passo 5/7: alembic SKIPPED (-SkipMigrations)"
    }
    else {
        Write-Host "=> Passo 5/7: alembic upgrade head"
        if ($MigrationUrl -eq "") {
            if ($OwnerPassword -eq "") {
                throw "Para rodar 'alembic upgrade head' informe -OwnerPassword (ou -MigrationUrl), ou use -SkipMigrations."
            }
            $MigrationUrl = "postgresql+psycopg://{0}:{1}@{2}:{3}/{4}" -f `
                $OwnerRole, [uri]::EscapeDataString($OwnerPassword), $DbHost, $DbPort, $TargetDatabase
        }
        if (-not (Test-CommandExists uv)) {
            throw "Comando 'uv' nao encontrado no PATH; instale-o ou use -SkipMigrations."
        }
        $repo = Split-Path -Parent $PSScriptRoot
        $server = Join-Path $repo "server"
        if (-not (Test-Path -LiteralPath (Join-Path $server "alembic.ini"))) {
            throw "alembic.ini nao encontrado em $server. Rode o restore a partir do checkout do repositorio."
        }
        Push-Location $server
        $oldUrl = $env:MIGRATION_DATABASE_URL
        try {
            $env:MIGRATION_DATABASE_URL = $MigrationUrl
            uv run alembic upgrade head
            if ($LASTEXITCODE -ne 0) { throw "alembic upgrade head falhou (codigo $LASTEXITCODE)." }
            Write-Host "   Schema do banco restaurado:"
            uv run alembic current
            if ($LASTEXITCODE -ne 0) { Write-Warning "'alembic current' falhou (nao fatal)." }
        }
        finally {
            if ($null -ne $oldUrl) { $env:MIGRATION_DATABASE_URL = $oldUrl }
            else { Remove-Item Env:\MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue }
            Pop-Location
        }
    }

    # -----------------------------------------------------------------------
    # 6. Arquivos (robocopy da pasta "files" do backup)
    # -----------------------------------------------------------------------
    Write-Host "=> Passo 6/7: copiando arquivos de $FilesDir para $DataDir"
    $attachCountRow = Invoke-Query -Database $TargetDatabase -Sql "SELECT count(*)::text FROM attachments;"
    $attachCount = 0
    if ($attachCountRow.Count -gt 0) { $attachCount = [int]$attachCountRow[0] }
    if (Test-Path -LiteralPath $FilesDir) {
        New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
        robocopy $FilesDir $DataDir /E /NFL /NDL /NJH /NJS | Out-Null
        # robocopy: codigo 0-7 e sucesso; 8+ e falha.
        if ($LASTEXITCODE -ge 8) { throw "robocopy falhou (codigo $LASTEXITCODE)." }
        $LASTEXITCODE = 0
        Write-Host "   Arquivos copiados."
    }
    elseif ($attachCount -gt 0) {
        throw "O backup NAO contem a pasta de arquivos (esperada em: $FilesDir), mas o banco restaurado tem $attachCount anexo(s). Gere o backup novamente com scripts/backup.ps1 a partir de uma maquina com server\data."
    }
    else {
        Write-Host "   Backup sem pasta de arquivos e sem anexos no banco; nada a copiar."
    }

    # -----------------------------------------------------------------------
    # 7. Smoke test
    # -----------------------------------------------------------------------
    Write-Host "=> Passo 7/7: smoke test"

    $countSql = @'
SELECT 'users', count(*)::text FROM users
UNION ALL SELECT 'conversations', count(*)::text FROM conversations
UNION ALL SELECT 'messages', count(*)::text FROM messages
UNION ALL SELECT 'attachments', count(*)::text FROM attachments
UNION ALL SELECT 'audit_log', count(*)::text FROM audit_log;
'@
    $restored = @{}
    foreach ($line in (Invoke-Query -Database $TargetDatabase -Sql $countSql)) {
        $pair = $line -split '\|', 2
        $restored[$pair[0]] = [int]$pair[1]
    }
    $schemaVersion = "(desconhecida)"
    $versionRows = Invoke-Query -Database $TargetDatabase -Sql "SELECT version_num FROM alembic_version;"
    if ($versionRows.Count -gt 0) { $schemaVersion = $versionRows[0] }

    Write-Host "   Banco restaurado ('$TargetDatabase'):"
    Write-Host ("     users={0} conversations={1} messages={2} attachments={3} audit_log={4}" -f `
        $restored["users"], $restored["conversations"], $restored["messages"], $restored["attachments"], $restored["audit_log"])
    Write-Host "     schema (alembic_version): $schemaVersion"

    if ($restored["users"] -eq 0) {
        throw "Smoke test FALHOU: o banco restaurado nao tem usuarios (restore vazio?)."
    }

    if ($SourceDatabase -ne "") {
        Write-Host "   Comparando com o banco de origem '$SourceDatabase':"
        $source = @{}
        foreach ($line in (Invoke-Query -Database $SourceDatabase -Sql $countSql)) {
            $pair = $line -split '\|', 2
            $source[$pair[0]] = [int]$pair[1]
        }
        $divergences = @()
        foreach ($key in @("users", "conversations", "messages", "attachments")) {
            if ($source[$key] -ne $restored[$key]) {
                $divergences += ("{0}: origem={1} x restaurado={2}" -f $key, $source[$key], $restored[$key])
            }
        }
        if ($divergences.Count -gt 0) {
            throw "Smoke test FALHOU: contagens divergem entre origem e restore -> $($divergences -join '; ')"
        }
        if ($source["audit_log"] -ne $restored["audit_log"]) {
            Write-Warning ("audit_log divergiu (origem={0} x restaurado={1}); normal se o servidor de origem continuou gravando auditoria depois do backup." -f $source["audit_log"], $restored["audit_log"])
        }
        else {
            Write-Host "     Contagens iguais a origem: OK"
        }
    }

    if ($attachCount -gt 0) {
        Write-Host "   Verificando $attachCount anexo(s) no disco ($DataDir):"
        $rows = Invoke-Query -Database $TargetDatabase -Sql "SELECT storage_path, size_bytes::text, coalesce(sha256, '') FROM attachments ORDER BY storage_path;"
        $missing = @()
        $integrity = @()
        foreach ($row in $rows) {
            $cols = $row -split '\|', 3
            $rel = $cols[0] -replace '/', '\'
            $full = Join-Path $DataDir $rel
            if (-not (Test-Path -LiteralPath $full)) {
                $missing += $cols[0]
                continue
            }
            $item = Get-Item -LiteralPath $full
            if ($cols[1] -ne "" -and $item.Length -ne [int64]$cols[1]) {
                $integrity += ("{0}: tamanho em disco {1} != {2} no banco" -f $cols[0], $item.Length, $cols[1])
            }
            if ($cols[2] -ne "") {
                $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLower()
                if ($hash -ne $cols[2].ToLower()) {
                    $integrity += ("{0}: sha256 em disco != sha256 no banco" -f $cols[0])
                }
            }
        }
        if ($missing.Count -gt 0) {
            throw "Smoke test FALHOU: arquivo(s) de anexo ausente(s) em $DataDir -> $($missing -join '; ')"
        }
        if ($integrity.Count -gt 0) {
            throw "Smoke test FALHOU: integridade -> $($integrity -join '; ')"
        }
        Write-Host "     Todos os arquivos de anexo existem e conferem (tamanho + SHA-256): OK"
    }

    Write-Host ""
    Write-Host "RESTORE CONCLUIDO COM SUCESSO."
    Write-Host "  Banco:     $TargetDatabase"
    Write-Host "  Arquivos:  $DataDir"
    if ($TargetDatabase -ne "microzup") {
        Write-Host "  Atencao: o banco de destino tem outro nome; ajuste DATABASE_URL/MIGRATION_DATABASE_URL em server\.env se for usa-lo."
    }
}
finally {
    # limpeza do temporario local
    if (Test-Path -LiteralPath $script:TempDir) {
        Remove-Item -LiteralPath $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    # limpeza do temporario no container
    if ($script:UseDocker -and (Test-CommandExists docker)) {
        try {
            docker exec $ContainerName sh -c "rm -rf /tmp/microzup-restore" | Out-Null
        }
        catch { }
        if ($LASTEXITCODE -ne 0) { Write-Warning "Nao foi possivel limpar /tmp/microzup-restore no container (nao fatal)." }
    }
}
