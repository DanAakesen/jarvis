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
trap 'rm -f "$budget_parameters"; if [[ -n "${RUNNER_TEMP:-}" ]]; then rm -f "$RUNNER_TEMP/backend-log-probe.params.json"; fi' EXIT
jq -n --argjson emails "$budget_emails" \
  '{parameters: {budgetContactEmails: {value: $emails}}}' >"$budget_parameters"

backend_apps=$(az containerapp list --resource-group "$RESOURCE_GROUP" --subscription "$SUBSCRIPTION_ID" \
  --query "[?starts_with(name, 'ca-jarvis-backend-')].{name:name,image:properties.template.containers[0].image,copilot:properties.template.containers[0].env[?name=='FOUNDRY_COPILOT_AGENT_NAME' || name=='FOUNDRY_COPILOT_AGENT_VERSION' || name=='FOUNDRY_COPILOT_DEFINITION_SHA256']}" \
  --output json --only-show-errors)
if ! jq -e 'type == "array" and length <= 1 and all(.[]; type == "object")' <<<"$backend_apps" >/dev/null; then
  echo "::error::Unable to identify one existing backend configuration."
  exit 1
fi
if [[ -z "$image" ]]; then
  image=$(jq -r '.[0].image // ""' <<<"$backend_apps")
fi
copilot_env=$(jq -c '.[0].copilot // []' <<<"$backend_apps")
if ! copilot_values=$(jq -cer '
  if type != "array" or any(.[]; type != "object" or
      (.name != "FOUNDRY_COPILOT_AGENT_NAME" and
       .name != "FOUNDRY_COPILOT_AGENT_VERSION" and
       .name != "FOUNDRY_COPILOT_DEFINITION_SHA256") or
      (.value | type != "string")) or
      (map(.name) | unique | length) != length then error
  else reduce .[] as $item ({}; .[$item.name] = $item.value)
  end
' <<<"$copilot_env"); then
  echo "::error::Existing Copilot target configuration is invalid."
  exit 1
fi
copilot_agent_name=$(jq -r '.FOUNDRY_COPILOT_AGENT_NAME // ""' <<<"$copilot_values")
copilot_agent_version=$(jq -r '.FOUNDRY_COPILOT_AGENT_VERSION // ""' <<<"$copilot_values")
copilot_definition_sha256=$(jq -r '.FOUNDRY_COPILOT_DEFINITION_SHA256 // ""' <<<"$copilot_values")
copilot_value_count=$(jq 'length' <<<"$copilot_env")
if (( copilot_value_count != 0 )); then
  if [[ ! "$copilot_agent_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ||
        "$copilot_agent_name" == jarvis ||
        ! "$copilot_agent_version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ||
        ! "$copilot_definition_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    echo "::error::Existing Copilot target configuration is invalid."
    exit 1
  fi
fi

parameters=(backendIdentityResourceId="$identity" sqlAdminGroupObjectId="$sql_group")
if [[ -f "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/backend-log-preflight.private.json" ]]; then
  python .github/scripts/backend_log_probe_parameters.py
  parameters+=("@${RUNNER_TEMP}/backend-log-probe.params.json")
fi
vault_mirror_requested="${JARVIS_VAULT_MIRROR_ENABLED:-false}"
vault_mirror_configuration_valid=true
if [[ -n "${GITHUB_APP_ID:-}" ]]; then
  if [[ "$GITHUB_APP_ID" =~ ^[1-9][0-9]{0,19}$ ]]; then
    parameters+=(githubAppId="$GITHUB_APP_ID")
  elif [[ "$vault_mirror_requested" == true ]]; then
    echo "::warning title=Vault mirror::The GitHub App ID is invalid; keeping the mirror disabled and omitting the optional ID."
    vault_mirror_configuration_valid=false
  else
    echo "::error::GITHUB_APP_ID must be a positive decimal identifier"
    exit 1
  fi
elif [[ "$vault_mirror_requested" == true ]]; then
  echo "::warning title=Vault mirror::The GitHub App ID is missing; keeping the mirror disabled."
  vault_mirror_configuration_valid=false
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
if [[ -n "$copilot_agent_name" ]]; then
  parameters+=(foundryCopilotAgentName="$copilot_agent_name"
    foundryCopilotAgentVersion="$copilot_agent_version"
    foundryCopilotDefinitionSha256="$copilot_definition_sha256")
fi

vault_mirror_enabled="$vault_mirror_requested"
vault_mirror_image=""
if [[ "$vault_mirror_enabled" != true && "$vault_mirror_enabled" != false ]]; then
  echo "::notice title=Vault mirror::JARVIS_VAULT_MIRROR_ENABLED is not true or false; keeping the mirror disabled."
  vault_mirror_enabled=false
fi

vault_mirror_write_back="${JARVIS_VAULT_MIRROR_WRITE_BACK:-dry-run}"
vault_mirror_max_changed="${JARVIS_VAULT_MIRROR_MAX_CHANGED:-25}"
vault_mirror_max_deletes="${JARVIS_VAULT_MIRROR_MAX_DELETES:-3}"
if [[ "$vault_mirror_enabled" == true && "$vault_mirror_configuration_valid" == true ]] &&
  { [[ "$vault_mirror_write_back" != dry-run && "$vault_mirror_write_back" != on ]] ||
    [[ ! "$vault_mirror_max_changed" =~ ^[1-9][0-9]{0,2}$ ]] ||
    (( vault_mirror_max_changed > 100 )) ||
    [[ ! "$vault_mirror_max_deletes" =~ ^(0|[1-9][0-9]?)$ ]] ||
    (( vault_mirror_max_deletes > 10 )); }; then
  echo "::warning title=Vault mirror::The write-back mode or change caps are invalid; keeping the mirror disabled."
  vault_mirror_configuration_valid=false
fi

if [[ "$vault_mirror_enabled" == true && "$vault_mirror_configuration_valid" != true ]]; then
  vault_mirror_enabled=false
fi

if [[ "$vault_mirror_enabled" == true ]]; then
  if [[ ! -f apps/vault-mirror/Dockerfile ]]; then
    echo "::notice title=Vault mirror::apps/vault-mirror/Dockerfile is absent; skipping the image build and keeping the mirror disabled."
    vault_mirror_enabled=false
  elif [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    echo "::notice title=Vault mirror::GITHUB_SHA is unavailable; skipping the image build and keeping the mirror disabled."
    vault_mirror_enabled=false
  elif [[ ! "${GITHUB_APP_ID:-}" =~ ^[1-9][0-9]{0,19}$ ]]; then
    echo "::notice title=Vault mirror::JARVIS_GITHUB_APP_ID is unavailable; keeping the mirror disabled."
    vault_mirror_enabled=false
  else
    registry_outputs=$(az deployment group show --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
      --subscription "$SUBSCRIPTION_ID" \
      --query 'properties.outputs.{name:containerRegistryName.value,host:containerRegistryLoginServer.value}' \
      --output json --only-show-errors 2>/dev/null || true)
    registry=$(jq -r '.name // ""' <<<"$registry_outputs")
    registry_host=$(jq -r '.host // ""' <<<"$registry_outputs")
    if [[ -z "$registry" || -z "$registry_host" ]]; then
      echo "::notice title=Vault mirror::The existing registry outputs are unavailable; keeping the mirror disabled."
      vault_mirror_enabled=false
    elif az acr build --registry "$registry" --image "jarvis-vault-mirror:$GITHUB_SHA" \
      --file apps/vault-mirror/Dockerfile --platform linux/amd64 --subscription "$SUBSCRIPTION_ID" \
      --only-show-errors .; then
      vault_mirror_digest=$(az acr manifest show-metadata --registry "$registry" \
        --name "jarvis-vault-mirror:$GITHUB_SHA" --subscription "$SUBSCRIPTION_ID" \
        --query digest --output tsv --only-show-errors 2>/dev/null || true)
      if [[ "$vault_mirror_digest" =~ ^sha256:[0-9a-fA-F]{64}$ ]]; then
        vault_mirror_image="$registry_host/jarvis-vault-mirror@$vault_mirror_digest"
      else
        echo "::notice title=Vault mirror::The built image digest is unavailable; keeping the mirror disabled."
        vault_mirror_enabled=false
      fi
    else
      echo "::warning title=Vault mirror::The image build failed; continuing the infrastructure deployment with the mirror disabled."
      vault_mirror_enabled=false
    fi
  fi
fi

remove_vault_mirror() {
  local job_name identities outputs registry_name vault_name storage_name registry_id vault_id storage_id group_id scopes_json
  job_name=$(az containerapp job list --resource-group "$RESOURCE_GROUP" --subscription "$SUBSCRIPTION_ID" \
    --query "[?name=='job-jarvis-vault-mirror'].name | [0]" --output tsv --only-show-errors) || return 1
  if [[ -n "$job_name" && "$job_name" != None ]]; then
    az containerapp job delete --name "$job_name" --resource-group "$RESOURCE_GROUP" \
      --subscription "$SUBSCRIPTION_ID" --yes --output none --only-show-errors || return 1
  fi
  identities=$(az identity list --resource-group "$RESOURCE_GROUP" --subscription "$SUBSCRIPTION_ID" \
    --query "[?starts_with(name, 'id-jarvis-vault-mirror-')].{name:name,principalId:principalId}" \
    --output json --only-show-errors) || return 1
  jq -e 'type == "array"' <<<"$identities" >/dev/null || return 1
  if [[ "$(jq 'length' <<<"$identities")" == 0 ]]; then
    return 0
  fi
  outputs=$(az deployment group show --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
    --subscription "$SUBSCRIPTION_ID" --query properties.outputs --output json --only-show-errors) || return 1
  registry_name=$(jq -er '.containerRegistryName.value' <<<"$outputs") || return 1
  vault_name=$(jq -er '.keyVaultName.value' <<<"$outputs") || return 1
  storage_name=$(jq -er '.storageAccountName.value' <<<"$outputs") || return 1
  registry_id=$(az acr show --name "$registry_name" --resource-group "$RESOURCE_GROUP" \
    --subscription "$SUBSCRIPTION_ID" --query id --output tsv --only-show-errors) || return 1
  vault_id=$(az keyvault show --name "$vault_name" --subscription "$SUBSCRIPTION_ID" \
    --query id --output tsv --only-show-errors) || return 1
  storage_id=$(az storage account show --name "$storage_name" --resource-group "$RESOURCE_GROUP" \
    --subscription "$SUBSCRIPTION_ID" --query id --output tsv --only-show-errors) || return 1
  group_id=$(az group show --name "$RESOURCE_GROUP" --subscription "$SUBSCRIPTION_ID" \
    --query id --output tsv --only-show-errors) || return 1
  scopes_json=$(jq -cn --arg registry "$registry_id" --arg vault "$vault_id" --arg storage "$storage_id" \
    --arg group "$group_id" \
    '[$group, $registry, $vault, ($storage + "/blobServices/default/containers/vault-mirror-state"), ($storage + "/blobServices/default/containers/vault-mirror-status")]') || return 1
  while IFS=$'\t' read -r identity_name principal_id; do
    [[ -n "$identity_name" ]] || continue
    while IFS= read -r scope; do
      assignment_ids=$(az role assignment list --scope "$scope" --assignee-object-id "$principal_id" \
        --fill-principal-name false --subscription "$SUBSCRIPTION_ID" \
        --query '[].id' --output tsv --only-show-errors) || return 1
      while IFS= read -r assignment_id; do
        [[ -n "$assignment_id" ]] || continue
        az role assignment delete --ids "$assignment_id" --subscription "$SUBSCRIPTION_ID" \
          --output none --only-show-errors || return 1
      done <<<"$assignment_ids"
    done < <(jq -r '.[]' <<<"$scopes_json")
    az identity delete --name "$identity_name" --resource-group "$RESOURCE_GROUP" \
      --subscription "$SUBSCRIPTION_ID" --output none --only-show-errors || return 1
  done < <(jq -r '.[] | [.name, .principalId] | @tsv' <<<"$identities")
}

if [[ "${JARVIS_VAULT_MIRROR_ENABLED:-}" == false ]]; then
  if remove_vault_mirror; then
    echo "::notice title=Vault mirror::Removed the scheduled job, dedicated identity and its role assignments; retained private state/status containers."
  elif [[ "${GITHUB_EVENT_NAME:-}" == push ]]; then
    echo "::warning title=Vault mirror::Teardown is incomplete; a later infrastructure run will retry it."
  else
    echo "::error::Vault mirror teardown failed; retry the Deploy workflow."
    exit 1
  fi
fi

parameters+=(vaultMirrorEnabled="$vault_mirror_enabled")
if [[ "$vault_mirror_enabled" == true ]]; then
  parameters+=(vaultMirrorImage="$vault_mirror_image"
    vaultMirrorWriteBack="$vault_mirror_write_back"
    vaultMirrorMaxChanged="$vault_mirror_max_changed"
    vaultMirrorMaxDeletes="$vault_mirror_max_deletes")
fi

az deployment group create --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --mode Incremental --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json --parameters "@$budget_parameters" --parameters "${parameters[@]}" \
  --output none --only-show-errors
az deployment group show --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --query properties.outputs --output json --only-show-errors >"$outputs"
