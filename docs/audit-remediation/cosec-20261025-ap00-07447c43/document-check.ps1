$ErrorActionPreference='Stop'
$b=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'baseline.json') -Raw|ConvertFrom-Json
$csv=Join-Path $PSScriptRoot $b.original_csv
if((Get-FileHash -LiteralPath $csv -Algorithm SHA256).Hash.ToLowerInvariant() -ne $b.original_csv_sha256){throw 'Original CSV changed'}
$rows=@(Import-Csv $csv);if($rows.Count -ne 184 -or @($rows.id|Sort-Object -Unique).Count -ne 184){throw 'Original identities changed'}
foreach($r in $rows){$null=$r.original_row_json|ConvertFrom-Json}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -cne 'F:35|LA:34|R:15|UC:100' -or ($native -join '|') -cne 'BLOCKED:70|NOT_RUN:114'){throw 'Original matrix changed'}
$map=@(Import-Csv (Join-Path $PSScriptRoot '../cosec-20261025-native-plan-fccb7c22/native-scenario-map.csv'))
if($map.Count -ne 100 -or @($map.id|Sort-Object -Unique).Count -ne 100){throw 'Original UC map changed'}
$input=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'minimum-input-template.json') -Raw|ConvertFrom-Json
if($input.future_permission.approved -ne $false -or $input.future_permission.current -ne 'Preparation only' -or $input.data.needed_for_metadata_identity_only -ne $false){throw 'Accidental permission/data scope expansion'}
$out=Join-Path $PSScriptRoot 'document-check.json';if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{check='Local original-CSV and preparation-only scope integrity';original_rows=184;parsed_original_json=184;counts=$counts;native=$native;native_pass=0;original_bytes_unchanged=$true;original_uc_map=100;future_permission_approved=$false;new_application_tests=0;native_actions=0}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $out -Encoding utf8
Write-Output 'Original184 rows/100UC references unchanged; minimum template remains preparation-only.'
