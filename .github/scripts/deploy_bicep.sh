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
if [[ -z "${JARVIS_BUDGET_CONTACT_EMAILS:-}" ]]; then
  echo "::error::Set JARVIS_BUDGET_CONTACT_EMAILS to the comma-separated alert recipients, including Dan."
  exit 1
fi
budget_emails=$(jq -cn --arg value "$JARVIS_BUDGET_CONTACT_EMAILS" \
  '$value | split(",") | map(gsub("^\\s+|\\s+$"; ""))')
if ! jq -e 'length > 0 and all(.[]; test("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$"))' <<<"$budget_emails" >/dev/null; then
  echo "::error::JARVIS_BUDGET_CONTACT_EMAILS must contain valid comma-separated email addresses."
  exit 1
fi
budget_parameters=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/jarvis-budget-parameters.XXXXXX")
chmod 600 "$budget_parameters"
trap 'rm -f "$budget_parameters"' EXIT
jq -n --argjson emails "$budget_emails" \
  '{parameters: {budgetContactEmails: {value: $emails}}}' >"$budget_parameters"

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
if [[ -n "${JARVIS_PC_BRIDGE_CLIENT_ID:-}" ]]; then
  [[ "$JARVIS_PC_BRIDGE_CLIENT_ID" =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]] || {
    echo "::error::JARVIS_PC_BRIDGE_CLIENT_ID must be a UUID"
    exit 1
  }
  parameters+=(pcBridgeClientId="$JARVIS_PC_BRIDGE_CLIENT_ID")
fi
if [[ -n "${JARVIS_GOOGLE_TIME_ZONE:-}" ]]; then
  [[ "$JARVIS_GOOGLE_TIME_ZONE" =~ ^(UTC|[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+)$ ]] || {
    echo "::error::JARVIS_GOOGLE_TIME_ZONE must be an IANA time zone."
    exit 1
  }
  parameters+=(jarvisGoogleTimeZone="$JARVIS_GOOGLE_TIME_ZONE")
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
  --subscription "$SUBSCRIPTION_ID" --mode Incremental --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json --parameters "@$budget_parameters" --parameters "${parameters[@]}" \
  --output none --only-show-errors
az deployment group show --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --query properties.outputs --output json --only-show-errors >"$outputs"
