# Cheebo · avvio sviluppo locale
# Genera un batch temporaneo che imposta le variabili con SET (cmd nativo)
# e poi chiama vercel dev — garantisce l'ereditarietà su Windows.

$envFile = Join-Path $PSScriptRoot ".env.local"
if (-not (Test-Path $envFile)) { Write-Error "Manca .env.local"; exit 1 }

$batchFile = Join-Path $PSScriptRoot "_dev_tmp.bat"
$lines = @("@echo off")

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $n = $matches[1]; $v = $matches[2]
    if ($n -like 'VITE_*') { return }
    # Rimuove apici avvolgenti
    if ($v.Length -ge 2 -and (
        ($v[0] -eq "'" -and $v[-1] -eq "'") -or
        ($v[0] -eq '"'  -and $v[-1] -eq '"')
    )) { $v = $v.Substring(1, $v.Length - 2) }
    # SET non vuole virgolette attorno al valore (le include letteralmente)
    $lines += "SET $n=$v"
    Write-Host "  caricata $n" -ForegroundColor DarkGray
  }
}

$lines += "SET DO_NOT_TRACK=1"
$lines += "vercel dev"
$lines | Set-Content $batchFile -Encoding ASCII

Write-Host "Variabili caricate. Avvio vercel dev..." -ForegroundColor Green

try {
  cmd /c $batchFile
} finally {
  if (Test-Path $batchFile) { Remove-Item $batchFile -Force }
}
