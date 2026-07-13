$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktopDirectory)) {
    throw "Unable to locate the current user's Desktop directory."
}

$items = @(
    @{
        Name = "Cocos Playable Packer - Start.lnk"
        Command = Join-Path $projectRoot "start-web-mvp.cmd"
        Description = "Start Cocos Playable Packer Web MVP"
    },
    @{
        Name = "Cocos Playable Packer - Stop.lnk"
        Command = Join-Path $projectRoot "stop-web-mvp.cmd"
        Description = "Stop Cocos Playable Packer Web MVP"
    }
)

$shell = New-Object -ComObject WScript.Shell
foreach ($item in $items) {
    if (-not (Test-Path -LiteralPath $item.Command -PathType Leaf)) {
        throw "Shortcut command does not exist: $($item.Command)"
    }

    $shortcutPath = Join-Path $desktopDirectory $item.Name
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $env:ComSpec
    $shortcut.Arguments = "/d /c `"`"$($item.Command)`"`""
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = $item.Description
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
    $shortcut.WindowStyle = 1
    $shortcut.Save()
    Write-Host "Created: $shortcutPath"
}

Write-Host "Desktop shortcuts installed successfully."
