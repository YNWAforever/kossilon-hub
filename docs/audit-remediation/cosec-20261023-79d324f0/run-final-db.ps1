$ErrorActionPreference = 'Stop'
$runId = 'cosec-20261023-79d324f0'
$expectedContainer = '4f5c362905d14782f4bc2c4bf74af3fc8f2b4e76259342e873bfd1ea78424580'
$expectedImage = 'sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232'
$candidateRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $candidateRoot
$identity = (docker inspect kossilon-cosec-79d324f0 | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0 -or $identity.Id -ne $expectedContainer -or
    $identity.Config.Labels.'codex.run' -ne $runId -or
    $identity.Config.Labels.'codex.repo' -ne 'kossilon-hub' -or
    $identity.Image -ne $expectedImage -or $identity.Mounts.Count -ne 0 -or
    !$identity.HostConfig.Tmpfs.'/var/lib/postgresql/data' -or
    $identity.HostConfig.Memory -ne 536870912 -or
    $identity.NetworkSettings.Ports.'5432/tcp'[0].HostIp -ne '127.0.0.1' -or
    $identity.NetworkSettings.Ports.'5432/tcp'[0].HostPort -ne '60953') {
    throw 'ISOLATED_TARGET_IDENTITY_MISMATCH_BEFORE_CLIENT'
}
$ownedCredentials = Get-Content -LiteralPath 'node_modules/.cache/cosec-db-credentials.json' | ConvertFrom-Json
$targetUri = [Uri]$ownedCredentials.url
if ($targetUri.Host -ne '127.0.0.1' -or $targetUri.Port -ne 60953 -or
    $targetUri.AbsolutePath -ne '/cosec_79d324f0') { throw 'RUNNER_TARGET_MISMATCH_BEFORE_CLIENT' }
$databaseUser = [Uri]::UnescapeDataString($targetUri.UserInfo.Split(':')[0])
$sourceSha = (git rev-parse HEAD).Trim()
$sourceDirty = @(git status --porcelain=v1 -- src scripts vite.config.ts package.json package-lock.json bun.lock)
if ($sourceDirty.Count) { throw 'SOURCE_NOT_COMMITTED_FOR_FINAL_DB_RUN' }
@{run_id=$runId;source_sha=$sourceSha;container_id=$identity.Id;image_id=$identity.Image;
  labels=$identity.Config.Labels;ports=$identity.NetworkSettings.Ports;mounts=$identity.Mounts;
  tmpfs=$identity.HostConfig.Tmpfs;memory=$identity.HostConfig.Memory;runner_target_verified=$true;
  observed_utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-target.json')

# This is the independently verified disposable container only. Capture exact
# SQL parameters/IDs for legacy fixtures as well as the new structured receipts.
$startedAt = [DateTime]::UtcNow.ToString('o')
docker exec $expectedContainer psql -X -v ON_ERROR_STOP=1 -U $databaseUser -d cosec_79d324f0 -Atc "ALTER SYSTEM SET log_statement = 'all'"
if ($LASTEXITCODE -ne 0) { throw 'OWNED_SQL_LOG_SETUP_FAILED' }
docker exec $expectedContainer psql -X -v ON_ERROR_STOP=1 -U $databaseUser -d cosec_79d324f0 -Atc "ALTER SYSTEM SET log_parameter_max_length = '-1'"
if ($LASTEXITCODE -ne 0) { throw 'OWNED_SQL_PARAMETER_LOG_SETUP_FAILED' }
docker exec $expectedContainer psql -X -v ON_ERROR_STOP=1 -U $databaseUser -d cosec_79d324f0 -Atc 'SELECT pg_reload_conf()'
if ($LASTEXITCODE -ne 0) { throw 'OWNED_SQL_LOG_RELOAD_FAILED' }

$summaryQuery = "select json_build_object('database',current_database(),'db_user',current_user,'server_version',current_setting('server_version'),'companies',(select count(*) from companies),'users',(select count(*) from users),'staff_profiles',(select count(*) from staff_profiles),'annual_return_cases',(select count(*) from annual_return_cases),'work_items',(select count(*) from work_items),'documents',(select count(*) from documents),'outbox',(select count(*) from notification_outbox),'nar_batches',(select count(*) from nar_import_batches),'bulk_operation_jobs',(select count(*) from bulk_operation_jobs))"
docker exec $expectedContainer psql -X -v ON_ERROR_STOP=1 -U $databaseUser -d cosec_79d324f0 -Atc $summaryQuery |
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-before.json')
if ($LASTEXITCODE -ne 0) { throw 'OWNED_SQL_BASELINE_READ_FAILED' }

Get-ChildItem Env: | Where-Object Name -Match 'DATABASE|AUTH|TOKEN|WHATSAPP|OPENAI|ANTHROPIC|GEMINI|SCANNER|STORAGE|SMTP|API_KEY|AUDIT_NAR_TIMEOUT_PROBE' |
    ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:TEST_DATABASE_URL = $ownedCredentials.url
$env:DATABASE_SSL = 'false'
$env:PGSSLMODE = 'disable'
$env:COSEC_EVIDENCE_DIR = $PSScriptRoot
$files = @(
    'src/features/work-items/queue.integration.test.ts',
    'src/features/work-items/repository.test.ts',
    'src/features/bulk-operations/repository.integration.test.ts',
    'src/features/bulk-operations/actions.integration.test.ts',
    'src/features/documents/company-document-register.integration.test.ts',
    'src/features/documents/repository.integration.test.ts',
    'src/features/documents/document-volume.integration.test.ts',
    'src/features/annual-return/work-views-other.integration.test.ts',
    'src/features/annual-return/readiness.integration.test.ts',
    'src/features/annual-return/payment-review.integration.test.ts',
    'src/features/incorporation/read-page.integration.test.ts',
    'src/features/incorporation/repository.test.ts',
    'src/features/corporate-changes/repository.test.ts',
    'src/features/whatsapp/history-pagination.integration.test.ts',
    'src/features/admin/repository.integration.test.ts',
    'src/features/nar-import/apply.integration.test.ts'
)
$testExit = 1
try {
    npm.cmd test -- --project db @files --maxWorkers 1 > (Join-Path $PSScriptRoot 'db-candidate-final.txt') 2>&1
    $testExit = $LASTEXITCODE
} finally {
    docker exec $expectedContainer psql -X -v ON_ERROR_STOP=1 -U $databaseUser -d cosec_79d324f0 -Atc $summaryQuery |
        Set-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-after.json')
    $postreadExit = $LASTEXITCODE
    docker logs --timestamps --since $startedAt $expectedContainer > (Join-Path $PSScriptRoot 'db-candidate-sql.log') 2>&1
    $sqlLog = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-sql.log') -Raw
    $observedIds = @([regex]::Matches($sqlLog, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b') |
        ForEach-Object Value | Sort-Object -Unique)
    @{run_id=$runId;source_sha=$sourceSha;kind='Observed SQL parameter/reference IDs; not a claim every ID was created';
      count=$observedIds.Count;ids=$observedIds;sql_log_sha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-sql.log')).Hash} |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-sql-ids.json')
    @{run_id=$runId;source_sha=$sourceSha;container_id=$expectedContainer;files=$files;test_exit_code=$testExit;
      postread_exit_code=$postreadExit;started_utc=$startedAt;finished_utc=[DateTime]::UtcNow.ToString('o');
      auth_runtime_verified=$false;provider_calls=$false;native_ticks=$false} |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-result.json')
}
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'db-candidate-final.txt') -Tail 30
if ($testExit -ne 0 -or $postreadExit -ne 0) { exit 1 }


