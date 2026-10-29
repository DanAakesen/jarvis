#!/usr/bin/env bash
# Explicit manual-only deployment job; the workflow guards authorization and exact qualification.
set -euo pipefail
umask 077
private_dir=$(mktemp -d "$RUNNER_TEMP/managed-chat.XXXXXX")
trap 'rm -rf -- "$private_dir"' EXIT
fail() { echo "::error::$1"; exit 1; }

if ! az deployment group show --name "$INFRA_DEPLOYMENT" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --query properties.outputs --output json --only-show-errors \
  >"$private_dir/infra.json" 2>"$private_dir/cli.err"; then
  fail managed_chat_infrastructure_unavailable
fi
project_endpoint=$(jq -er '.foundryAdminEndpoint.value | strings' "$private_dir/infra.json")
backend_app=$(jq -er '.backendAppName.value | strings' "$private_dir/infra.json")
account=$(jq -er '.foundryAccountName.value | strings' "$private_dir/infra.json")
project=$(jq -er '.foundryProjectName.value | strings' "$private_dir/infra.json")
project_id="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/$account/projects/$project"
invocations="$project_endpoint/agents/jarvis/endpoint/protocols/invocations?api-version=v1"

printf '%s\n' '{"operation":"managed_definition_manifest"}' >"$private_dir/manifest-operation.json"
if ! timeout 210s az rest --method POST --url "$invocations" --resource https://ai.azure.com/ \
  --headers Content-Type=application/json --body "@$private_dir/manifest-operation.json" --output json \
  --only-show-errors >"$private_dir/manifest.json" 2>"$private_dir/cli.err"; then
  fail managed_chat_manifest_unavailable
fi
# Existing hosted identity reads its normal tool registry; no tool executes here.
python .github/scripts/provision_managed_chat.py --project-id "$project_id" \
  --project-endpoint "$project_endpoint" --manifest "$private_dir/manifest.json" \
  --output "$private_dir/activation.json" --apply
if ! jq -e --arg endpoint "$project_endpoint" '
  type == "object" and (keys | sort) == ["agentName", "fingerprint", "projectEndpoint", "version"] and
  .projectEndpoint == $endpoint and .agentName == "jarvis-main-copilot-preview" and
  (.version | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")) and
  (.fingerprint | type == "string" and test("^[0-9a-f]{64}$"))
' "$private_dir/activation.json" >/dev/null 2>"$private_dir/cli.err"; then
  fail managed_chat_activation_invalid
fi
agent_name=$(jq -er .agentName "$private_dir/activation.json")
version=$(jq -er .version "$private_dir/activation.json")
fingerprint=$(jq -er .fingerprint "$private_dir/activation.json")
if ! az containerapp update --name "$backend_app" --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --set-env-vars \
  "FOUNDRY_COPILOT_AGENT_NAME=$agent_name" "FOUNDRY_COPILOT_AGENT_VERSION=$version" \
  "FOUNDRY_COPILOT_DEFINITION_SHA256=$fingerprint" --output none --only-show-errors \
  >"$private_dir/update.json" 2>"$private_dir/cli.err"; then
  fail managed_chat_backend_configuration_failed
fi
ready=false
# Same bounded revision readiness pattern as the normal backend deploy; job timeout is the outer bound.
for _ in $(seq 1 30); do
  if ! az containerapp show --name "$backend_app" --resource-group "$RESOURCE_GROUP" \
    --subscription "$SUBSCRIPTION_ID" --query '{latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}' \
    --output json --only-show-errors >"$private_dir/backend.json" 2>"$private_dir/cli.err"; then
    fail managed_chat_backend_readiness_unavailable
  fi
  if jq -e '.latest as $latest | ($latest | type == "string" and length > 0) and .ready == $latest' \
    "$private_dir/backend.json" >/dev/null 2>"$private_dir/cli.err"; then
    ready=true
    break
  fi
  sleep 30
done
[[ "$ready" == true ]] || fail managed_chat_backend_not_ready

printf '%s\n' '{"operation":"managed_text_canary"}' >"$private_dir/canary-operation.json"
if ! timeout 210s az rest --method POST --url "$invocations" --resource https://ai.azure.com/ \
  --headers Content-Type=application/json --body "@$private_dir/canary-operation.json" --output json \
  --only-show-errors >"$private_dir/canary.json" 2>"$private_dir/cli.err"; then
  fail managed_chat_canary_unavailable
fi
if ! jq -e 'type == "object" and .status == "ok" and .model == "gpt-6.1-terra" and .reasoningEffort == "high"' \
  "$private_dir/canary.json" >/dev/null 2>"$private_dir/cli.err"; then
  fail managed_chat_canary_failed
fi
echo managed_chat_comparison_canary_ok
# This is comparison evidence only; normal release acceptance retains its own required checks.
