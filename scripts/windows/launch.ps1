# PDF Narrator - Windows launcher.
# First run: finds (or offers to install) Python, creates a private virtual
# environment, installs dependencies, downloads Hebrew+English OCR data and
# creates a desktop shortcut.  Later runs start in a few seconds.
param([switch]$Console, [switch]$Reinstall, [int]$Port = 8765)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Venv = Join-Path $Root ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$VenvPyw = Join-Path $Venv "Scripts\pythonw.exe"
$DataDir = Join-Path $env:LOCALAPPDATA "PDFNarrator"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function Say($msg) { Write-Host "[PDF Narrator] $msg" -ForegroundColor Cyan }

function Test-Python($cmd, $argsList) {
  try {
    $v = & $cmd @argsList -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
    $parts = $v.Trim().Split(".")
    if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 10) { return $v.Trim() }
  } catch { }
  return $null
}

function Find-Python {
  $candidates = @(
    @("py", @("-3.13")), @("py", @("-3.12")), @("py", @("-3.11")), @("py", @("-3.10")), @("py", @("-3")),
    @("python", @()), @("python3", @())
  )
  foreach ($c in $candidates) {
    $ver = Test-Python $c[0] $c[1]
    if ($ver) { return ,@($c[0], $c[1], $ver) }
  }
  return $null
}

if ($Reinstall -and (Test-Path $Venv)) { Say "Removing old environment..."; Remove-Item -Recurse -Force $Venv }

if (-not (Test-Path $VenvPy)) {
  $py = Find-Python
  if (-not $py) {
    Say "Python 3.10 or newer is required but was not found."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
      $ans = Read-Host "Install Python 3.12 now with winget (for your user only)? [Y/n]"
      if ($ans -eq "" -or $ans -match "^[Yy]") {
        winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $py = Find-Python
      }
    }
    if (-not $py) {
      Say "Please install Python from https://www.python.org/downloads/windows/ (tick 'Add python.exe to PATH'), then start PDF Narrator again."
      Start-Process "https://www.python.org/downloads/windows/"
      exit 1
    }
  }
  Say "Using Python $($py[2]) - creating a private environment (one time)..."
  & $py[0] @($py[1]) -m venv $Venv
  if ($LASTEXITCODE -ne 0) { throw "Could not create the virtual environment." }
}

# install / update dependencies when requirements change
$req = Join-Path $Root "requirements.txt"
$hashFile = Join-Path $Venv ".requirements.sha256"
$hash = (Get-FileHash $req -Algorithm SHA256).Hash
if (-not (Test-Path $hashFile) -or (Get-Content $hashFile) -ne $hash) {
  Say "Installing components (first start can take a few minutes)..."
  & $VenvPy -m pip install --disable-pip-version-check --upgrade pip | Out-Null
  & $VenvPy -m pip install --disable-pip-version-check -r $req
  if ($LASTEXITCODE -ne 0) { throw "Installing dependencies failed (check your internet connection)." }
  Set-Content -Path $hashFile -Value $hash
}

# OCR language data for scanned PDFs (Hebrew + English, ~5 MB, Apache-2.0)
$tess = Join-Path $DataDir "tessdata"
New-Item -ItemType Directory -Force -Path $tess | Out-Null
foreach ($lang in @("heb", "eng")) {
  $f = Join-Path $tess "$lang.traineddata"
  if (-not (Test-Path $f)) {
    try {
      Say "Downloading OCR data: $lang"
      Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata" -OutFile "$f.part"
      Move-Item -Force "$f.part" $f
    } catch {
      Say "Could not download OCR data ($lang). Scanned pages will be flagged until it is available."
      Remove-Item -ErrorAction SilentlyContinue "$f.part"
    }
  }
}

# desktop shortcut (first run only)
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "PDF Narrator.lnk"
if (-not (Test-Path $lnk)) {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $Root "Start PDF Narrator.bat"
    $s.WorkingDirectory = "$Root"
    $s.WindowStyle = 7
    $s.IconLocation = "$env:SystemRoot\System32\imageres.dll,177"
    $s.Description = "PDF Narrator - natural-sounding PDF reader"
    $s.Save()
    Say "Created a desktop shortcut."
  } catch { }
}

Say "Starting..."
if ($Console) {
  & $VenvPy -m narrator --port $Port
} else {
  Start-Process -FilePath $VenvPyw -ArgumentList @("-m", "narrator", "--port", "$Port") -WorkingDirectory $Root -WindowStyle Hidden
}
exit 0
