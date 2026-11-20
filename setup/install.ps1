[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$ApiPort = 13000,
    [ValidateRange(1024, 65535)][int]$RedisPort = 16380,
    [switch]$RecoverRedis
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$docker = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Docker\Docker\resources\bin\docker.exe'
if (!(Test-Path -LiteralPath $docker -PathType Leaf)) {
    throw 'Instala Docker Desktop en su ruta predeterminada e inicia el motor en modo Linux.'
}
if (!(Test-Path -LiteralPath (Join-Path $root '.env') -PathType Leaf)) {
    throw 'Falta .env en el directorio del clon.'
}
if ((Test-Path -LiteralPath (Join-Path $root '.secrets')) -and
    !(Test-Path -LiteralPath (Join-Path $root '.secrets\team-setup.json') -PathType Leaf)) {
    throw 'Ya existe .secrets de otro entorno. Usa un clon nuevo. No se cambiaron archivos.'
}
$openssl = (Get-Command openssl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) { throw 'Se requiere Node.js 20 o superior.' }
if (!(Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    Push-Location -LiteralPath $root
    $previousErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        Write-Host 'Preparando dependencias locales verificadas por el lockfile.'
        & $npm ci --ignore-scripts --no-audit --no-fund 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las dependencias locales.' }
    } finally {
        $ErrorActionPreference = $previousErrorPreference
        Pop-Location
    }
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$redisRecovery = if ($RecoverRedis) { 'recover' } else { 'normal' }
& $node (Join-Path $PSScriptRoot 'install.cjs') $docker $openssl $sid $ApiPort $RedisPort $redisRecovery
if ($LASTEXITCODE -ne 0) { throw 'El instalador se detuvo. Todos los recursos se conservan.' }
