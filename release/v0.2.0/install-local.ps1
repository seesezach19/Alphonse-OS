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
$projectName = if ($env:ALPHONSE_COMPOSE_PROJECT) { $env:ALPHONSE_COMPOSE_PROJECT } else { "alphonse-v0-2" }
if (-not (Test-Path $envFile)) {
  $values = [ordered]@{
    POSTGRES_PASSWORD = New-LocalSecret
    DIAGNOSTIC_DATABASE_PASSWORD = New-LocalSecret
    KERNEL_INSTALLATION_ID = [guid]::NewGuid().ToString()
    KERNEL_INSTALLATION_NAME = "Alphonse_Local_Installation"
    KERNEL_ENVIRONMENT_ID = [guid]::NewGuid().ToString()
    KERNEL_ENVIRONMENT_NAME = "Local_Development"
    KERNEL_BOOTSTRAP_TOKEN = New-LocalSecret
    KERNEL_OWNER_TOKEN = New-LocalSecret
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
    KERNEL_DIAGNOSTIC_DISPATCH_SIGNING_SECRET = New-LocalSecret
    DIAGNOSTIC_RUNTIME_ADAPTER_SECRET = New-LocalSecret
    N8N_DETAIL_ADAPTER_TOKEN = New-LocalSecret
    N8N_REPAIR_DELIVERY_API_KEY = New-LocalSecret
    VERIFICATION_RUNNER_SIGNING_SECRET = New-LocalSecret
    N8N_ENCRYPTION_KEY = New-LocalSecret
  }
  $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $envFile
}

docker compose --project-name $projectName --env-file $envFile -f (Join-Path $root "compose.yaml") up --build -d --wait
$kernelPort = if ($env:KERNEL_PORT) { $env:KERNEL_PORT } else { "3000" }
$n8nPort = if ($env:N8N_PORT) { $env:N8N_PORT } else { "5678" }
Write-Host "Alphonse V0.2 ready: http://127.0.0.1:$kernelPort/diagnostic/v0/bootstrap"
Write-Host "Customer-owned n8n: http://127.0.0.1:$n8nPort"
Write-Host "Local credentials remain in $envFile"
