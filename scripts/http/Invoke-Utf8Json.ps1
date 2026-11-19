# ASCII-only source so Windows PowerShell 5.1 can load this file without a BOM.
# Request bodies are encoded explicitly; no global encoding or TLS settings change.
function Invoke-Utf8Json {
    [CmdletBinding(DefaultParameterSetName = 'Object')]
    param(
        [Parameter(Mandatory = $true)]
        [uri] $Uri,

        [Parameter(Mandatory = $true)]
        [ValidateSet('POST', 'PUT', 'PATCH', 'DELETE')]
        [string] $Method,

        [Parameter(Mandatory = $true, ParameterSetName = 'Object')]
        [AllowNull()]
        [object] $Body,

        [Parameter(Mandatory = $true, ParameterSetName = 'Json')]
        [ValidateNotNullOrEmpty()]
        [string] $Json,

        [hashtable] $Headers = @{},

        [ValidateRange(1, 300)]
        [int] $TimeoutSec = 30
    )

    if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -notin @('http', 'https') -or $Uri.UserInfo) {
        throw 'Use an absolute HTTP(S) URI without embedded credentials.'
    }
    if (@($Headers.Keys | Where-Object { $_ -ieq 'Content-Type' }).Count -gt 0) {
        throw 'Content-Type is managed by Invoke-Utf8Json.'
    }

    $payload = if ($PSCmdlet.ParameterSetName -eq 'Json') {
        $Json
    } else {
        ConvertTo-Json -InputObject $Body -Depth 32 -Compress -ErrorAction Stop
    }
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    $bytes = $encoding.GetBytes($payload)

    Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -TimeoutSec $TimeoutSec -ErrorAction Stop
}
