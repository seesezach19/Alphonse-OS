#!/bin/sh
set -eu

command -v docker >/dev/null 2>&1 || { echo "Docker with Compose is required." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is required to generate the local TLS identity." >&2; exit 1; }
docker compose version >/dev/null

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$root/.env.release"
tls_dir="$root/.tls"
project_name=${ALPHONSE_COMPOSE_PROJECT:-alphonse-v0-2}

secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr '[:upper:]' '[:lower:]';
  else printf '%s-%s-4%s-8%s-%s\n' "$(secret | cut -c1-8)" "$(secret | cut -c1-4)" \
    "$(secret | cut -c1-3)" "$(secret | cut -c1-3)" "$(secret | cut -c1-12)"; fi
}

if [ ! -f "$env_file" ]; then
  umask 077
  cat >"$env_file" <<EOF
POSTGRES_PASSWORD=$(secret)
DIAGNOSTIC_DATABASE_PASSWORD=$(secret)
TOKENIZATION_DATABASE_PASSWORD=$(secret)
KERNEL_INSTALLATION_ID=$(uuid)
KERNEL_INSTALLATION_NAME=Alphonse_Local_Installation
KERNEL_ENVIRONMENT_ID=$(uuid)
KERNEL_ENVIRONMENT_NAME=Local_Development
KERNEL_BOOTSTRAP_TOKEN=$(secret)
KERNEL_OWNER_TOKEN=$(secret)
DIAGNOSTIC_CONSOLE_VIEWER_TOKEN=$(secret)
CONSOLE_OPERATOR_AGENT_TOKEN=$(secret)
CONSOLE_VIEWER_LOGIN_SECRET=$(secret)
CONSOLE_OPERATOR_LOGIN_SECRET=$(secret)
CONSOLE_OWNER_LOGIN_SECRET=$(secret)
ALPHONSE_CONSOLE_SESSION_SECRET=$(secret)
KERNEL_PACKAGE_SIGNING_SECRET=$(secret)
KERNEL_WORKLOAD_GRANT_SIGNING_SECRET=$(secret)
SUBSTRATE_SERVICE_TOKEN=$(secret)
SUBSTRATE_OBSERVATION_SECRET=$(secret)
DISPATCH_PERMIT_SIGNING_SECRET=$(secret)
KERNEL_ADAPTER_TOKEN=$(secret)
BROKER_SERVICE_TOKEN=$(secret)
DATA_PLANE_SERVICE_TOKEN=$(secret)
DATA_PLANE_RECEIPT_SECRET=$(secret)
KERNEL_SUPPORT_DIAGNOSTIC_SECRET=$(secret)
KERNEL_DIAGNOSTIC_DISPATCH_SIGNING_SECRET=$(secret)
DIAGNOSTIC_MODEL_BROKER_GRANT_SIGNING_SECRET=$(secret)
DIAGNOSTIC_MODEL_BROKER_RECEIPT_SECRET=$(secret)
DIAGNOSTIC_RUNNER_ATTESTATION_SECRET=$(secret)
DIAGNOSTIC_RUNTIME_ADAPTER_SECRET=$(secret)
N8N_DETAIL_ADAPTER_TOKEN=$(secret)
N8N_REPAIR_DELIVERY_API_KEY=$(secret)
VERIFICATION_RUNNER_SIGNING_SECRET=$(secret)
N8N_ENCRYPTION_KEY=$(secret)
KERNEL_BACKUP_KEY=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n')
KERNEL_BACKUP_KEY_ID=single-tenant-release-backup-key-v1
EOF
fi

if [ ! -f "$tls_dir/tls.crt" ] || [ ! -f "$tls_dir/tls.key" ]; then
  umask 077
  mkdir -p "$tls_dir"
  openssl req -x509 -newkey rsa:3072 -sha256 -days 397 -nodes \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$tls_dir/tls.key" -out "$tls_dir/tls.crt" >/dev/null 2>&1
fi
chmod 600 "$env_file" "$tls_dir/tls.key"

compose() {
  docker compose --project-name "$project_name" --env-file "$env_file" -f "$root/compose.yaml" "$@"
}

compose up --build -d --wait postgres diagnostic-bootstrap n8n-runtime-adapter kernel
compose run --rm --no-deps -T kernel node src/release-console-bootstrap.js
compose up --build -d --wait
https_port=${ALPHONSE_HTTPS_PORT:-3443}
printf '%s\n' "Alphonse V0.2 ready: https://localhost:$https_port"
printf '%s\n' "Trust $tls_dir/tls.crt only after verifying its fingerprint. Replace it with a customer-issued certificate before network exposure."
printf '%s\n' "Local credentials remain in $env_file"
