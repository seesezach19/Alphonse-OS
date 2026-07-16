#!/bin/sh
set -eu

command -v docker >/dev/null 2>&1 || { echo "Docker with Compose is required." >&2; exit 1; }
docker compose version >/dev/null

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$root/.env.release"
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
KERNEL_INSTALLATION_ID=$(uuid)
KERNEL_INSTALLATION_NAME=Alphonse_Local_Installation
KERNEL_ENVIRONMENT_ID=$(uuid)
KERNEL_ENVIRONMENT_NAME=Local_Development
KERNEL_BOOTSTRAP_TOKEN=$(secret)
KERNEL_OWNER_TOKEN=$(secret)
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
DIAGNOSTIC_RUNTIME_ADAPTER_SECRET=$(secret)
N8N_DETAIL_ADAPTER_TOKEN=$(secret)
N8N_REPAIR_DELIVERY_API_KEY=$(secret)
VERIFICATION_RUNNER_SIGNING_SECRET=$(secret)
N8N_ENCRYPTION_KEY=$(secret)
EOF
fi

docker compose --project-name "$project_name" --env-file "$env_file" -f "$root/compose.yaml" up --build -d --wait
kernel_port=${KERNEL_PORT:-3000}
n8n_port=${N8N_PORT:-5678}
printf '%s\n' "Alphonse V0.2 ready: http://127.0.0.1:$kernel_port/diagnostic/v0/bootstrap"
printf '%s\n' "Customer-owned n8n: http://127.0.0.1:$n8n_port"
printf '%s\n' "Local credentials remain in $env_file"
