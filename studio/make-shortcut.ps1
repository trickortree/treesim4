# Puts "Tree Sim 4 Studio <version>" on the desktop and removes the old Studio shortcuts.
# The version comes from studio/studio.json. Run it with: npm run studio:shortcut
$repo = Split-Path -Parent $PSScriptRoot
$ver = (Get-Content (Join-Path $PSScriptRoot "studio.json") -Raw | ConvertFrom-Json).version
$desk = [Environment]::GetFolderPath("Desktop")
$exe = Join-Path $repo "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $exe)) { Write-Error "Electron isn't installed. Run npm install in $repo first."; exit 1 }

Get-ChildItem -Path $desk -Filter "Tree Sim 4 Studio*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-Output "Removed $($_.Name)"
}

$name = "Tree Sim 4 Studio $ver.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk $name))
$sh.TargetPath = $exe
$sh.Arguments = ". --studio"
$sh.WorkingDirectory = $repo
$sh.IconLocation = (Join-Path $repo "build\icon.ico")
$sh.Description = "Tree Sim 4 Studio $ver"
$sh.Save()
Write-Output "Made $name"
