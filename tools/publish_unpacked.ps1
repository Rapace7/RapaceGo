# publish_unpacked.ps1 -- sync the unpacked build to the self-use location.
#
# WHY THIS EXISTS
#   electron-builder writes the unpacked app to  <src>\dist\win-unpacked\ .
#   That is a BUILD INTERMEDIATE and must not be the delivered copy.
#   The delivered/self-use unpacked build lives NEXT TO the source tree, named
#   after the product:
#
#     D:\Git by Rapace\Go\RapaceGo-src\      <- source
#     D:\Git by Rapace\Go\RapaceGo\          <- unpacked build (self-use)
#
#   Forgetting this step is exactly how "I fixed the shortcut name but the app
#   still made RapaceGo.lnk" happened: the source was fixed and dist was
#   rebuilt, but the folder the user actually launches was never updated.
#
# WHAT IT DOES
#   1. mirror dist\win-unpacked\  ->  the self-use folder   (robocopy /MIR of
#      code+resources only; user data and engine folders are preserved)
#   2. delete dist\win-unpacked\   (dist keeps only the .zip artifacts)
#
# USAGE (from the project's tools\ folder, or pass paths)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish_unpacked.ps1 `
#       -Dist "D:\Git by Rapace\Chess\RapaceChess-src\dist\win-unpacked" `
#       -Dest "D:\Git by Rapace\Chess\RapaceChess"
#
# NOTE: keep this file ASCII-only (or UTF-8 with BOM) -- PowerShell 5.1 reads
#       Chinese text as GBK and dies on parse otherwise.

param(
    [Parameter(Mandatory = $true)][string]$Dist,
    [Parameter(Mandatory = $true)][string]$Dest,
    [switch]$KeepDist
)

$ErrorActionPreference = 'Stop'

function Say($m) { Write-Host "  $m" }

if (-not (Test-Path $Dist)) {
    Write-Host "[x] source not found: $Dist"
    Write-Host "    (run electron-builder first; dist\win-unpacked is its output)"
    exit 1
}
if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    Say "created $Dest"
}

# ---- 1. copy code + resources (never touch user data / engines) -------------
# Only these subtrees are authoritative build output. Everything else in the
# destination (records\, settings.json, userdata\, engine folders the user
# dropped in) belongs to the user and must survive.
$subs = @('resources', 'locales')
Say "syncing code + resources -> $Dest"
foreach ($s in $subs) {
    $from = Join-Path $Dist $s
    if (-not (Test-Path $from)) { continue }
    $to = Join-Path $Dest $s
    robocopy $from $to /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Host "[x] robocopy failed on $s (code $LASTEXITCODE)"; exit 1 }
}

# Top-level launcher exe + electron support files, but NOT settings.json /
# records / userdata (those are user state).
Say "syncing top-level files"
Get-ChildItem $Dist -File | Where-Object {
    $_.Name -notin @('settings.json')
} | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $Dest $_.Name) -Force
}
# engine folder(s) shipped via extraFiles land at the exe's level
foreach ($eng in @('engine')) {
    $from = Join-Path $Dist $eng
    if (Test-Path $from) {
        robocopy $from (Join-Path $Dest $eng) /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { Write-Host "[x] robocopy failed on $eng"; exit 1 }
    }
}

# ---- 2. verify: resources\app must match ------------------------------------
$A = Join-Path $Dist 'resources\app'
$B = Join-Path $Dest 'resources\app'
if ((Test-Path $A) -and (Test-Path $B)) {
    $bad = 0
    $fa = Get-ChildItem $A -Recurse -File
    foreach ($f in $fa) {
        $rel = $f.FullName.Substring($A.Length + 1)
        $other = Join-Path $B $rel
        if (-not (Test-Path $other)) { Say "[x] missing in dest: $rel"; $bad++; continue }
        if ((Get-FileHash $f.FullName -Algorithm SHA256).Hash -ne
            (Get-FileHash $other -Algorithm SHA256).Hash) { Say "[x] differs: $rel"; $bad++ }
    }
    if ($bad -gt 0) { Write-Host "[x] $bad file(s) mismatch -- NOT deleting dist"; exit 1 }
    Say "verified: resources\app  $($fa.Count) files, 0 mismatches"
}

# ---- 3. drop the intermediate -----------------------------------------------
if (-not $KeepDist) {
    $sz = (Get-ChildItem $Dist -Recurse -File -ErrorAction SilentlyContinue |
           Measure-Object -Property Length -Sum).Sum
    Remove-Item $Dist -Recurse -Force
    Say ("removed intermediate {0} ({1} MB)" -f $Dist, [math]::Round($sz / 1MB, 1))
} else {
    Say "kept $Dist (-KeepDist)"
}

Write-Host ""
Write-Host "OK. self-use unpacked build is at:"
Write-Host "  $Dest"
Write-Host "Reminder: launch it once to confirm before calling the release done."
