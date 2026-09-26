$Host.UI.RawUI.WindowTitle = "Dota 2 AI Assistant + Laya System-1"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   DOTA 2 AI CO-PILOT + LAYA SYSTEM-1 (VAC-SAFE) " -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Clear ports 3000 and 8000 to prevent port collisions
Write-Host "[*] Checking and freeing ports 3000 and 8000..." -ForegroundColor Gray
$connections = Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue
if ($connections) {
    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        try {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            Write-Host "  -> Terminated process PID $p" -ForegroundColor DarkGray
        } catch {}
    }
}

# 2. Check if build exists
if (-not (Test-Path "$projectRoot\dist\server.js")) {
    Write-Host "[*] Building project (npm run build)..." -ForegroundColor Yellow
    npm run build
}

# 3. Start Laya System-1 and Vision Agent in background
Write-Host "[*] Starting Laya System-1 Service (Port 8000)..." -ForegroundColor Green
$pythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $pythonExe) {
    $pythonExe = "python"
}
$layaProcess = Start-Process -FilePath $pythonExe -ArgumentList "laya_service.py" -WorkingDirectory $projectRoot -PassThru -WindowStyle Minimized

Write-Host "[*] Starting Computer Vision Agent (Minimap & Top Bar Hero Tracker)..." -ForegroundColor Green
$visionProcess = Start-Process -FilePath $pythonExe -ArgumentList "vision_service.py" -WorkingDirectory $projectRoot -PassThru -WindowStyle Minimized

# 4. Wait for Laya to become ready (up to 15s)
Write-Host "[*] Waiting for Laya System-1 service to be ready..." -ForegroundColor Gray
$layaReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($res -and $res.status -eq "ok") {
            $layaReady = $true
            break
        }
    } catch {}
}
if ($layaReady) {
    Write-Host "[OK] Laya System-1 is ready!" -ForegroundColor Green
} else {
    Write-Host "[WARNING] Laya is still initializing in the background, proceeding..." -ForegroundColor Yellow
}

# 5. Open dashboard in default browser
Write-Host "[*] Opening Dashboard http://localhost:3000 in browser..." -ForegroundColor Cyan
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  ASSISTANT AND LAYA SYSTEM-1 SUCCESSFULLY STARTED!" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard URL: http://localhost:3000" -ForegroundColor White
Write-Host "  Laya API URL:  http://127.0.0.1:8000/v1/systemone" -ForegroundColor White
Write-Host ""
Write-Host "  To stop the assistant and Laya, close this window or press Ctrl+C." -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# 6. Run Node server in foreground with guaranteed cleanup on exit
try {
    & node "$projectRoot\dist\server.js"
} catch {
    Write-Host "[ERROR] Server error: $_" -ForegroundColor Red
} finally {
    Write-Host ""
    Write-Host "[*] Stopping all background services..." -ForegroundColor Gray
    if ($layaProcess -and -not $layaProcess.HasExited) {
        Stop-Process -Id $layaProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($visionProcess -and -not $visionProcess.HasExited) {
        Stop-Process -Id $visionProcess.Id -Force -ErrorAction SilentlyContinue
    }
    $conns = Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($p in $pids) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "[OK] All services stopped." -ForegroundColor Green
}
