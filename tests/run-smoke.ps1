# MyFit スモークテスト: 簡易サーバーを起動し、headless Edge で tests/smoke.html を実行する
#   使い方: powershell -ExecutionPolicy Bypass -File tests/run-smoke.ps1
#   終了コード: 0 = PASS, 1 = FAIL
param([int]$Port = 8090)

$root = Split-Path $PSScriptRoot -Parent
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
          "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Host 'Microsoft Edge が見つかりません'; exit 1 }

$server = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\serve.ps1`"", '-Port', $Port -WindowStyle Hidden -PassThru
try {
  # サーバーの起動待ち
  $ready = $false
  for ($i = 0; $i -lt 20 -and -not $ready; $i++) {
    try { Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ready) { Write-Host "サーバーが起動しませんでした (port $Port)"; exit 1 }
  # テストごとに新しいプロファイル（実際のブラウザデータには触れない）
  $prof = Join-Path ([IO.Path]::GetTempPath()) "myfit-smoke-$([guid]::NewGuid())"
  $out = & $edge --headless=new --disable-gpu --no-first-run --user-data-dir="$prof" --virtual-time-budget=20000 `
    --dump-dom "http://localhost:$Port/tests/smoke.html?run" 2>$null | Out-String
  Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue

  $m = [regex]::Match($out, '<pre id="out">([\s\S]*?)</pre>')
  $text = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
  Write-Host $text
  if ($text -match 'RESULT: PASS') { exit 0 } else { exit 1 }
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
