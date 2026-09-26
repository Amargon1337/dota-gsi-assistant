$desktopPath = [System.IO.Path]::Combine($env:USERPROFILE, 'Desktop')
$shortcutPath = Join-Path $desktopPath 'Dota 2 AI Assistant.lnk'
$targetBat = 'C:\ag\dota-gsi-assistant\start_assistant.bat'
$workingDir = 'C:\ag\dota-gsi-assistant'

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetBat
$shortcut.WorkingDirectory = $workingDir
$shortcut.WindowStyle = 1
$shortcut.Description = 'Dota 2 AI Co-Pilot + Laya System-1 + Computer Vision'
$shortcut.Save()

Write-Host "Shortcut created/updated at: $shortcutPath" -ForegroundColor Green
