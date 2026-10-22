param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$siteUrl = "http://127.0.0.1:3000/"
$providersUrl = "http://127.0.0.1:3000/api/providers"

function Test-LocalBackend {
    $response = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create($providersUrl)
        $request.Proxy = $null
        $request.Timeout = 3000
        $response = $request.GetResponse()
        return [int]$response.StatusCode -eq 200 `
            -and $response.Headers["X-App-Name"] -eq "huawei-cloud-backend"
    }
    catch {
        return $false
    }
    finally {
        if ($response) { $response.Dispose() }
    }
}

function Open-LocalWebsite {
    try {
        Start-Process -FilePath $siteUrl -ErrorAction Stop
        Write-Host "Website opened: $siteUrl" -ForegroundColor Green
    }
    catch {
        Write-Host "The website is running. Open this address in your browser: $siteUrl" -ForegroundColor Yellow
    }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host "Node.js was not found. Node.js 24 or newer is required." -ForegroundColor Red
    exit 1
}

$nodeMajor = & $nodeCommand.Source -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) {
    Write-Host "Node.js 24 or newer is required. Current version:" -ForegroundColor Red
    & $nodeCommand.Source --version
    exit 1
}

$requiredFiles = @(
    ".env",
    "secrets\gateway_access_token"
)
foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        Write-Host "Missing required file: $requiredFile" -ForegroundColor Red
        exit 1
    }
}

if (Test-LocalBackend) {
    if ($NoBrowser) {
        Write-Host "The local website is already running: $siteUrl"
    }
    else {
        Open-LocalWebsite
    }
    exit 0
}

$portInUse = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "Port 3000 is already used by another program." -ForegroundColor Red
    Write-Host "Close that program, then run this launcher again."
    exit 1
}

Write-Host "Starting the local website: $siteUrl" -ForegroundColor Green
Write-Host "Keep this window open. Press Ctrl+C or close it to stop the website."

$server = $null
try {
    $server = Start-Process -FilePath $nodeCommand.Source `
        -ArgumentList @("--env-file=.env", "src/server.mjs") `
        -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ($server.HasExited) {
            Write-Host "The website process stopped during startup (exit code $($server.ExitCode))." -ForegroundColor Red
            exit $server.ExitCode
        }
        if (Test-LocalBackend) {
            if (-not $NoBrowser) { Open-LocalWebsite }
            $server.WaitForExit()
            exit $server.ExitCode
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "The website did not become ready within 30 seconds." -ForegroundColor Red
    exit 1
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    }
}
