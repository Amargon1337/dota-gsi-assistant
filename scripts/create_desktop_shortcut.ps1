$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $desktop "Dota 2 AI Assistant.lnk"
$shortcut = $wsh.CreateShortcut($shortcutPath)

$target = "C:\ag\dota-gsi-assistant\start_assistant.bat"
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = "C:\ag\dota-gsi-assistant"
$shortcut.Description = "Dota 2 AI Co-Pilot + Laya System-1"

$dotaExe = "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\bin\win64\dota2.exe"
if (Test-Path $dotaExe) {
    $shortcut.IconLocation = "$dotaExe,0"
} else {
    $shortcut.IconLocation = "shell32.dll,43"
}

$shortcut.Save()
Write-Host "✅ Ярлык успешно создан на рабочем столе: $shortcutPath"
