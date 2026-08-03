# ============================================================================
# Cheebo · avvio sviluppo locale con le variabili d'ambiente caricate
# ----------------------------------------------------------------------------
# `vercel dev` NON inietta .env.local nelle funzioni /api (bug noto): le
# carichiamo noi nella sessione, poi avviamo vercel dev nello STESSO processo.
#
# Uso (dalla cartella del progetto, dove sta .env.local):
#   .\dev.bat
# oppure:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\dev-with-env.ps1
# ============================================================================

$envFile = Join-Path $PSScriptRoot ".env.local"
if (-not (Test-Path $envFile)) {
  Write-Error "Manca .env.local accanto allo script ($envFile)."
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#') { return }            # salta i commenti
  if ($_ -match '^\s*$') { return }            # salta le righe vuote
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $n = $matches[1]; $v = $matches[2]
    # Le variabili VITE_* le legge Vite direttamente dal file .env.local: NON
    # vanno messe nella sessione, altrimenti prendono la precedenza sul file e
    # restano "congelate" al valore vecchio anche dopo averlo cambiato.
    if ($n -like 'VITE_*') { return }
    # toglie eventuali apici che avvolgono l'intero valore
    if ($v.Length -ge 2 -and (($v[0] -eq "'" -and $v[-1] -eq "'") -or ($v[0] -eq '"' -and $v[-1] -eq '"'))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    Set-Item "env:$n" $v
    Write-Host "  caricata $n" -ForegroundColor DarkGray
  }
}

Write-Host "Variabili caricate. Avvio vercel dev..." -ForegroundColor Green
vercel.cmd dev
