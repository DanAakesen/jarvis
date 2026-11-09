# Image API repair ledger

## Authorized scope

9 November: owner requested diagnosis and implementation of the latest OpenAI
image API, explicitly preferring 2.6 if available. Existing migration approval
covers this image path only. Current custom chat/voice harness remains unchanged;
Copilot migration stays parked. No new credential is created. Existing Key Vault
metadata inspection is in PR1693; credential availability remains unverified.

## Evidence and delivery

- Official generation reference: https://developers.openai.com/api/reference/resources/images/methods/generate
- 2.6 announcement: https://openai.com/index/introducing-images-2-6/
- Old path: backend → Foundry runner → Codex CLI, gpt-5.5, then upload.
  Generic runner/catch errors do not identify the exact historical provider failure.
- New path: backend → OpenAI Images API, gpt-image-2.6-sunburst → existing Blob/SQL
  artifact store → workspace/conversation. Flare can be configured independently.
- Medium quality, automatic dimensions, PNG; no repeated paid requests or changes
  to saved-image contracts. API billing replaces subscription allowance for images.
- Stage: implementing/testing. Live key, model access and production generation pending.

## Applicability review

Model selection and request controls apply: verified 2.6 API IDs; one image per
call. Provider compatibility: Codex subscription cannot authenticate the direct
API, so use the existing managed identity to read the OpenAI secret in Key Vault.
Instruction filenames and application prompts are unchanged.

Responses migration, WebSocket, processing tiers, prompt cache keys/retention/
breakpoints/diagnostics, previous_response_id, encrypted reasoning, reasoning
effort/context/summaries, verbosity, text output-token limits, message phases,
compaction, structured text outputs, tool search/choice, parallel/programmatic
calling and model-aligned tool redesign do not apply to this single Images API
request. No chat/agent migration is authorized or needed. Existing streaming tool
activity continues; partial-image streaming is not necessary for the repair.

Privacy/residency: existing private artifacts and no prompt/provider-body logging
are preserved. The expressly requested OpenAI API receives the image prompt;
this change makes no Zero Data Retention or regional processing claim and creates
no OpenAI conversation state. No new premium processing tier or retained state.

## Validation coverage

API request endpoint/model, real PNG decoding, HTTP failures, missing credentials,
invalid base64/data, oversized response, cancellation and no automatic retry;
artifact persistence/display errors and saved-ID recovery; owner-only artifact
routes and prompt/URL exclusion from durable tool audit; configuration validation.
Proactive diagnostic tests verify stage classification without model-text logging.

Proactive follow-up: reproduced a valid Foundry text response being rejected
because `tool_calls: null` / `function_call: null` were treated as attempted
tool execution. Microsoft's 2024-05-01-preview API example explicitly returns
null tool calls. The repair accepts absent/null/empty tool metadata and still
rejects actual or malformed tool calls, refusals, incomplete responses and
invalid findings. Regression tests failed before the fix. This is a confirmed
compatibility bug, not proof of the historical 18:00 response's contents.
