param([int]$Port = 8080, [string]$DatabasePath = 'data/itsm.sqlite', [string]$PythonPath = '', [switch]$InMemory)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$jdkDirectory = 'C:\Program Files\Java\jdk-21.0.11\bin'
$compilerCommand = Get-Command javac.exe -ErrorAction SilentlyContinue
$javacPath = if ($compilerCommand) { $compilerCommand.Source } else { Join-Path $jdkDirectory 'javac.exe' }
$javaPath = Join-Path (Split-Path $javacPath) 'java.exe'
if (-not (Test-Path -LiteralPath $javacPath)) { throw 'Install a JDK (Java 17 or later) and add its bin directory to PATH.' }
New-Item -ItemType Directory -Force -Path '.build/classes' | Out-Null
$javaSources = @(Get-ChildItem -LiteralPath 'src/main/java' -Recurse -Filter '*.java' | ForEach-Object FullName)
& $javacPath -encoding UTF-8 -d '.build/classes' $javaSources
if ($LASTEXITCODE -ne 0) { throw 'Java compilation failed.' }
if ($InMemory) { & $javaPath -cp '.build/classes' itsm.web.WebServer $Port; exit $LASTEXITCODE }
if (-not $PythonPath) { $PythonPath = $env:ITSM_PYTHON }
if (-not $PythonPath) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) { $PythonPath = $pythonCommand.Source }
}
if (-not $PythonPath -or $PythonPath -like '*Microsoft/WindowsApps/python.exe' -or $PythonPath -like '*Microsoft\WindowsApps\python.exe') {
    $bundledPython = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $PythonPath = $bundledPython }
}
if (-not $PythonPath) { throw 'Python 3 is required for the supplied SQLite adapter. Pass -PythonPath with the path to python.exe.' }
$resolvedDatabase = if ([System.IO.Path]::IsPathRooted($DatabasePath)) { [System.IO.Path]::GetFullPath($DatabasePath) } else { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $DatabasePath)) }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedDatabase) | Out-Null
if (-not (Test-Path -LiteralPath $resolvedDatabase) -and (Test-Path -LiteralPath 'database/sample.sqlite')) {
    Copy-Item -LiteralPath 'database/sample.sqlite' -Destination $resolvedDatabase
}
& $javaPath -cp '.build/classes' itsm.web.WebServer $Port --database $resolvedDatabase --python $PythonPath
