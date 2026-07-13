$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktopDirectory)) {
    throw "Unable to locate the current user's Desktop directory."
}

$items = @(
    @{
        Name = "Cocos Playable Packer - Start.lnk"
        Target = Join-Path $projectRoot "start-web-mvp.cmd"
        Description = "Start Cocos Playable Packer Web MVP"
    },
    @{
        Name = "Cocos Playable Packer - Stop.lnk"
        Target = Join-Path $projectRoot "stop-web-mvp.cmd"
        Description = "Stop Cocos Playable Packer Web MVP"
    }
)

$shell = New-Object -ComObject WScript.Shell
foreach ($item in $items) {
    if (-not (Test-Path -LiteralPath $item.Target -PathType Leaf)) {
        throw "Shortcut target does not exist: $($item.Target)"
    }

    $shortcutPath = Join-Path $desktopDirectory $item.Name
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $item.Target
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = $item.Description
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
    $shortcut.WindowStyle = 1
    $shortcut.Save()
    Write-Host "Created: $shortcutPath"
}

Write-Host "Desktop shortcuts installed successfully."
