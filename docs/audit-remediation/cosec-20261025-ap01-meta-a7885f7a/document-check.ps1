$ErrorActionPreference='Stop'
$b=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'baseline.json') -Raw|ConvertFrom-Json
$csv=Join-Path $PSScriptRoot $b.original_csv
if((Get-FileHash -LiteralPath $csv -Algorithm SHA256).Hash.ToLowerInvariant() -ne $b.original_csv_sha256){throw 'Original CSV changed'}
$rows=@(Import-Csv $csv);if($rows.Count -ne 184 -or @($rows.id|Sort-Object -Unique).Count -ne 184){throw 'Original row identities changed'}
foreach($r in $rows){$null=$r.original_row_json|ConvertFrom-Json}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -cne 'F:35|LA:34|R:15|UC:100' -or ($native -join '|') -cne 'BLOCKED:70|NOT_RUN:114'){throw 'Original matrix changed'}
$map=@(Import-Csv (Join-Path $PSScriptRoot '../cosec-20261025-native-plan-fccb7c22/native-scenario-map.csv'))
if($map.Count -ne 100 -or @($map.id|Sort-Object -Unique).Count -ne 100){throw 'Original map changed'}
$out=Join-Path $PSScriptRoot 'document-check.json';if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{check='Local original-CSV/reference integrity only';original_rows=184;original_json_parsed=184;original_bytes_unchanged=$true;counts=$counts;native=$native;native_pass=0;original_uc_map=100;application_tests_executed=0;native_actions=0}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $out -Encoding utf8
Write-Output '184 original records/100UC references unchanged; native0PASS.'
