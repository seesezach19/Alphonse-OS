$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required and docker must be on PATH."
}
docker compose version | Out-Null
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
  throw "OpenSSL is required to generate the local TLS identity."
}

function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($bytes)
  $generator.Dispose()
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root ".env.release"
$tlsDir = Join-Path $root ".tls"
$projectName = if ($env:ALPHONSE_COMPOSE_PROJECT) { $env:ALPHONSE_COMPOSE_PROJECT } else { "alphonse-v0-2" }
if (-not (Test-Path $envFile)) {
  $values = [ordered]@{
    POSTGRES_PASSWORD = New-LocalSecret
    DIAGNOSTIC_DATABASE_PASSWORD = New-LocalSecret
    TOKENIZATION_DATABASE_PASSWORD = New-LocalSecret
    KERNEL_INSTALLATION_ID = [guid]::NewGuid().ToString()
    KERNEL_INSTALLATION_NAME = "Alphonse_Local_Installation"
    KERNEL_ENVIRONMENT_ID = [guid]::NewGuid().ToString()
    KERNEL_ENVIRONMENT_NAME = "Local_Development"
    KERNEL_BOOTSTRAP_TOKEN = New-LocalSecret
    KERNEL_OWNER_TOKEN = New-LocalSecret
    DIAGNOSTIC_CONSOLE_VIEWER_TOKEN = New-LocalSecret
    CONSOLE_OPERATOR_AGENT_TOKEN = New-LocalSecret
    CONSOLE_VIEWER_LOGIN_SECRET = New-LocalSecret
    CONSOLE_OPERATOR_LOGIN_SECRET = New-LocalSecret
    CONSOLE_OWNER_LOGIN_SECRET = New-LocalSecret
    ALPHONSE_CONSOLE_SESSION_SECRET = New-LocalSecret
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
    DIAGNOSTIC_MODEL_BROKER_GRANT_SIGNING_SECRET = New-LocalSecret
    DIAGNOSTIC_MODEL_BROKER_RECEIPT_SECRET = New-LocalSecret
    DIAGNOSTIC_RUNNER_ATTESTATION_SECRET = New-LocalSecret
    DIAGNOSTIC_RUNTIME_ADAPTER_SECRET = New-LocalSecret
    N8N_DETAIL_ADAPTER_TOKEN = New-LocalSecret
    N8N_REPAIR_DELIVERY_API_KEY = New-LocalSecret
    VERIFICATION_RUNNER_SIGNING_SECRET = New-LocalSecret
    N8N_ENCRYPTION_KEY = New-LocalSecret
    KERNEL_BACKUP_KEY = New-LocalSecret
    KERNEL_BACKUP_KEY_ID = "single-tenant-release-backup-key-v1"
  }
  $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $envFile
}

if (-not (Test-Path $tlsDir)) { New-Item -ItemType Directory -Path $tlsDir | Out-Null }
$tlsCert = Join-Path $tlsDir "tls.crt"
$tlsKey = Join-Path $tlsDir "tls.key"
if (-not (Test-Path $tlsCert) -or -not (Test-Path $tlsKey)) {
  & openssl req -x509 -newkey rsa:3072 -sha256 -days 397 -nodes `
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" `
    -keyout $tlsKey -out $tlsCert
  if ($LASTEXITCODE -ne 0) { throw "TLS identity generation failed." }
}

$compose = @("compose", "--project-name", $projectName, "--env-file", $envFile, "-f", (Join-Path $root "compose.yaml"))
& docker @compose up --build -d --wait postgres diagnostic-bootstrap n8n-runtime-adapter kernel
if ($LASTEXITCODE -ne 0) { throw "Kernel startup failed." }
& docker @compose run --rm --no-deps -T kernel node src/release-console-bootstrap.js
if ($LASTEXITCODE -ne 0) { throw "Console Operator admission failed." }
& docker @compose up --build -d --wait
if ($LASTEXITCODE -ne 0) { throw "Release startup failed." }
$httpsPort = if ($env:ALPHONSE_HTTPS_PORT) { $env:ALPHONSE_HTTPS_PORT } else { "3443" }
Write-Host "Alphonse V0.2 ready: https://localhost:$httpsPort"
Write-Host "Trust $tlsCert only after verifying its fingerprint. Replace it with a customer-issued certificate before network exposure."
Write-Host "Local credentials remain in $envFile"
