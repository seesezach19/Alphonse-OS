$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required and docker must be on PATH."
}
docker compose version | Out-Null

function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($bytes)
  $generator.Dispose()
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root ".env.release"
$projectName = if ($env:ALPHONSE_COMPOSE_PROJECT) { $env:ALPHONSE_COMPOSE_PROJECT } else { "alphonse-kernel-v0-1" }
if (-not (Test-Path $envFile)) {
  $values = [ordered]@{
    POSTGRES_PASSWORD = New-LocalSecret
    KERNEL_INSTALLATION_ID = [guid]::NewGuid().ToString()
    KERNEL_INSTALLATION_NAME = "Alphonse_Local_Installation"
    KERNEL_ENVIRONMENT_ID = [guid]::NewGuid().ToString()
    KERNEL_ENVIRONMENT_NAME = "Local_Development"
    KERNEL_BOOTSTRAP_TOKEN = New-LocalSecret
    KERNEL_PACKAGE_SIGNING_SECRET = New-LocalSecret
    KERNEL_WORKLOAD_GRANT_SIGNING_SECRET = New-LocalSecret
    SUBSTRATE_SERVICE_TOKEN = New-LocalSecret
    SUBSTRATE_OBSERVATION_SECRET = New-LocalSecret
    DISPATCH_PERMIT_SIGNING_SECRET = New-LocalSecret
    KERNEL_ADAPTER_TOKEN = New-LocalSecret
    BROKER_SERVICE_TOKEN = New-LocalSecret
    DATA_PLANE_SERVICE_TOKEN = New-LocalSecret
    DATA_PLANE_RECEIPT_SECRET = New-LocalSecret
    KERNEL_SUPPORT_DIAGNOSTIC_SECRET = New-LocalSecret
    STOREFRONT_CREDENTIAL_ISSUER_SECRET = New-LocalSecret
    ADAPTER_BROKER_TOKEN = New-LocalSecret
  }
  $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $envFile
}

docker compose --project-name $projectName --env-file $envFile -f (Join-Path $root "compose.yaml") up --build -d --wait
$kernelPort = if ($env:KERNEL_PORT) { $env:KERNEL_PORT } else { "3000" }
Write-Host "Alphonse Kernel V0.1 ready: http://127.0.0.1:$kernelPort/kernel/v0/bootstrap"
Write-Host "Local credentials remain in $envFile"
