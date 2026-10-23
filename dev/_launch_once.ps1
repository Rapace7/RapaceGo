$root = 'D:\Git by Rapace\Go\RapaceGo-src'
$exe  = Join-Path $root 'node_modules\electron\dist\electron.exe'
$args = '"' + $root + '" --remote-debugging-port=9333 --user-data-dir="' + (Join-Path $root 'dev\_dbg_profile') + '"'
$act  = New-ScheduledTaskAction -Execute $exe -Argument $args -WorkingDirectory $root
$pri  = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'RapaceGoTestOnce' -Action $act -Principal $pri -Force | Out-Null
Start-ScheduledTask -TaskName 'RapaceGoTestOnce'
Start-Sleep -Seconds 15
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9333/json/version' -UseBasicParsing -TimeoutSec 3
  Write-Output ('PORT-OK ' + $r.StatusCode)
} catch {
  Write-Output 'PORT-DEAD'
}
