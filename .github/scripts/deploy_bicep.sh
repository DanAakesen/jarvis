#!/usr/bin/env bash
# Deploy infra/main.bicep as the fixed deployment "jarvis-infra" (P0-11) and
# write its outputs to $1. Optional $2 is the backend image; without it the
# running backend image is kept, and before any backend exists the template
# skips the backend app. Requires an Azure CLI login, SUBSCRIPTION_ID,
# RESOURCE_GROUP and INFRA_DEPLOYMENT. IDs come from the committed bootstrap
# output; the Foundry timestamp from infra/main.parameters.json.
set -euo pipefail

outputs="$1"
image="${2:-}"
identity=$(jq -er '.backendIdentity.resourceId' infra/bootstrap.output.json)
sql_group=$(jq -er '.sqlAdminGroup.objectId' infra/bootstrap.output.json)

if [[ -z "$image" ]]; then
  image=$(az containerapp list --resource-group "$RESOURCE_GROUP" --subscription "$SUBSCRIPTION_ID" \
    --query "[?starts_with(name, 'ca-jarvis-backend-')].properties.template.containers[0].image | [0]" \
    --output tsv --only-show-errors)
fi

parameters=(backendIdentityResourceId="$identity" sqlAdminGroupObjectId="$sql_group")
if [[ -n "${GITHUB_APP_ID:-}" ]]; then
  [[ "$GITHUB_APP_ID" =~ ^[1-9][0-9]{0,19}$ ]] || {
    echo "::error::GITHUB_APP_ID must be a positive decimal identifier"
    exit 1
  }
  parameters+=(githubAppId="$GITHUB_APP_ID")
fi
if [[ -n "${ENTRA_JARVIS_AGENT_OBJECT_ID:-}" ]]; then
  parameters+=(jarvisAgentObjectId="$ENTRA_JARVIS_AGENT_OBJECT_ID")
fi
if [[ -n "$image" ]]; then
  parameters+=(backendImage="$image")
else
  echo "::notice title=Deploy::No backend image exists yet; this Bicep pass skips the backend app."
fi

az deployment group create --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json --parameters "${parameters[@]}" \
  --output none --only-show-errors
az deployment group show --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --query properties.outputs --output json --only-show-errors >"$outputs"
