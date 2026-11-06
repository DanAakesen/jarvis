#!/usr/bin/env bash
# Explicit manual-only deployment job; the workflow guards authorization and exact qualification.
set -euo pipefail
umask 077
private_dir=$(mktemp -d "$RUNNER_TEMP/managed-chat.XXXXXX")
trap 'rm -rf -- "$private_dir"' EXIT
fail() { echo "::error::$1"; exit 1; }

if [[ "${INSPECT_MANAGED_CHAT:-false}" == true &&
      ( "${PROVISION_MANAGED_CHAT:-false}" == true || "${REFRESH_MANAGED_CHAT_DEFINITION:-false}" == true ) ]]; then
  fail managed_chat_inspection_conflicts_with_apply
fi

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
if [[ "${INSPECT_MANAGED_CHAT:-false}" == true ]]; then
  python .github/scripts/provision_managed_chat.py --project-id "$project_id" \
    --project-endpoint "$project_endpoint" --manifest "$private_dir/manifest.json" \
    --output "$private_dir/activation.json" --inspect
  exit 0
fi
refresh_args=()
if [[ "${REFRESH_MANAGED_CHAT_DEFINITION:-false}" == true ]]; then
  refresh_args+=(--refresh-definition)
fi
python .github/scripts/provision_managed_chat.py --project-id "$project_id" \
  --project-endpoint "$project_endpoint" --manifest "$private_dir/manifest.json" \
  --output "$private_dir/activation.json" --apply "${refresh_args[@]}"
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
if ! jq -e 'type == "object" and .status == "ok" and .model == "gpt-6.1-terra" and .reasoningEffort == "high" and .requestShape == "managed_policy"' \
  "$private_dir/canary.json" >/dev/null 2>"$private_dir/cli.err"; then
  # Emit only fixed labels and independently revalidated content-free provider metadata.
  if ! diagnostic=$(jq -sr '
    ["managed_readback_forbidden", "managed_readback_unauthorized", "managed_readback_unavailable",
     "managed_readback_invalid", "managed_existing_credential_unavailable", "managed_target_invalid",
     "managed_target_missing", "managed_target_settings_mismatch", "managed_immutable_target_missing",
     "managed_endpoint_invalid", "managed_project_endpoint_mismatch",
     "managed_reviewed_fingerprint_mismatch", "managed_reviewed_definition_mismatch",
     "managed_endpoint_selector_mismatch", "managed_definition_tools_invalid",
     "managed_definition_instructions_missing", "managed_agent_version_mismatch",
     "managed_agent_definition_missing", "managed_agent_definition_mismatch", "managed_agent_extra_skills",
     "managed_agent_unsupported_setting", "managed_agent_toolset_missing",
     "managed_agent_builtin_tools_enabled", "managed_agent_function_tools_mismatch",
     "managed_probe_settings_mismatch", "managed_probe_conversation_missing", "managed_probe_incomplete",
     "managed_probe_requested_tool", "managed_probe_empty_or_unfinished", "managed_probe_timeout",
     "managed_probe_failed", "managed_model_forbidden", "managed_model_unauthorized"] as $reasons |
    ["settings", "target_setup", "definition_readback", "conversation_create", "response_start", "response_stream"] as $stages |
    ["gpt-6.1-terra", "gpt-6-luna"] as $models |
    ["none", "low", "medium", "high", "xhigh"] as $efforts |
    (if length == 1 and (.[0] | type) == "object" then .[0] else {} end) |
    .reason as $reason | .stage as $stage | .httpStatus as $http | .model as $model | .reasoningEffort as $effort |
    (if (.providerCause | type) == "object" then .providerCause else {} end) as $cause |
    (if ($reason | type) == "string" and ($reasons | index($reason)) != null then $reason else "not_reported" end) as $safeReason |
    (if ($stage | type) == "string" and ($stages | index($stage)) != null then $stage else "managed_text_canary" end) as $safeStage |
    (if ($model | type) == "string" and ($models | index($model)) != null then $model else "not_reported" end) as $safeModel |
    (if ($effort | type) == "string" and ($efforts | index($effort)) != null then $effort else "not_reported" end) as $safeEffort |
    "managed_chat_canary_diagnostic reason=" + $safeReason + " stage=" + $safeStage +
    (if ($http | type) == "number" then
       if $http >= 400 and $http <= 599 and ($http | floor) == $http then " http_status=\($http | floor)" else "" end
     else "" end) +
    " expected_model=gpt-6.1-terra actual_model=" + $safeModel + " expected_effort=high actual_effort=" + $safeEffort +
    (if ($cause.httpStatus | type) == "number" then
       if $cause.httpStatus >= 100 and $cause.httpStatus <= 599 and ($cause.httpStatus | floor) == $cause.httpStatus
       then " provider_http_status=\($cause.httpStatus | floor)" else "" end
     else "" end) +
    (if ($cause.code | type) == "string" then
       if ($cause.code | test("^[a-z0-9_.]{1,48}\\z")) then " provider_code=" + $cause.code else "" end
     else "" end) +
    (if ($cause.param | type) == "string" then
       if ($cause.param | test("^[a-z0-9_.]{1,48}\\z")) then " provider_param=" + $cause.param else "" end
     else "" end) +
    (if ($cause.exceptionType | type) == "string" then
       if ($cause.exceptionType | test("^[A-Za-z_][A-Za-z0-9_]{0,47}\\z"))
       then " provider_exception=" + $cause.exceptionType else "" end
     else "" end)
  ' "$private_dir/canary.json" 2>"$private_dir/cli.err"); then
    diagnostic="managed_chat_canary_diagnostic reason=not_reported stage=managed_text_canary expected_model=gpt-6.1-terra actual_model=not_reported expected_effort=high actual_effort=not_reported"
  fi
  printf '%s\n' "$diagnostic"
  fail managed_chat_canary_failed
fi
echo managed_chat_comparison_canary_ok
# This is comparison evidence only; normal release acceptance retains its own required checks.
