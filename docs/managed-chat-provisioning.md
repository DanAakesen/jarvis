# Managed chat comparison provisioning

This is local preparation for one separate agent named
`jarvis-main-copilot-preview`. The script never changes `jarvis`, invokes a model,
creates credentials, assigns roles, creates connections, or deletes resources.
No provisioning or live verification ran while preparing it.

After the identity correction in #1357, manual Deploy
[40884299864](https://github.com/DanAakesen/jarvis/actions/runs/40884299864) printed
`managed_chat_provisioned` at 14:03:43 UTC, updated the backend target and passed
revision readiness. It then printed `managed_chat_canary_failed` at 14:05:08.
The private canary response was deleted and never uploaded. No exact model,
permission or protocol cause is established. The local diagnostic correction
preserves existing safe reason codes and logs only allowlisted stage, bounded
HTTP status and model/effort constants. Missing internal stage is reported as the
known `managed_text_canary` handoff operation. The 6 November policy-shaped
canary below supersedes that earlier diagnostic-only change.
Raw responses, instructions, schemas,
CLI errors and identifiers remain private. No retry or new resource is included.

Runtime availability currently depends on target metadata/settings verification,
not this canary result. A selectable Copilot option therefore does not prove
inference succeeded. Actual authenticated availability has not been observed;
changing that guard remains separate from this diagnostic correction.

Manual Deploy [40877005757](https://github.com/DanAakesen/jarvis/actions/runs/40877005757)
reached `agent_identity_unverified` on 29 October 2026. That check follows readback
of one active, exact comparison-agent version and precedes endpoint pinning,
backend target configuration and the canary. The comparison resource therefore
exists; do not create a replacement or another version. The combined failure
does not distinguish agent state, optional identity status and principal ID, so
no missing grant or exact failing field is proven.

Microsoft's [governance contract](https://learn.microsoft.com/en-us/azure/foundry/control-plane/govern-agent-infrastructure-entra-admin)
defines `state` as effective runtime enablement and identity `status` as optional,
omitted when unset. The provisioner now accepts omitted/null status only with an
enabled agent and valid principal UUID. It still refuses explicit disabled or
unknown status, disabled/unknown effective state and invalid principal IDs, with
distinct fixed failure codes. Readback after pinning must retain that principal;
optional status becoming populated does not change identity. These checks neither
enable an agent nor change Entra state or roles. The existing exact-name/version/
definition checks run before any reuse or endpoint write. This correction passed
live provisioning in run 40884299864; managed inference remains unverified. All
30 provisioning/handoff/deploy-plan tests, scoped Ruff, compilation and shell
syntax checks passed locally before its qualification and merge.

The target is the existing Jarvis project in Sweden Central:

- Project ID: `/subscriptions/0ac7d719-89bc-4100-be87-a79d33e953a7/resourceGroups/rg-jarvis/providers/Microsoft.CognitiveServices/accounts/jarvis-20261003200000-rmw7kae3bza6a/projects/jarvis-20261003200000`
- Project endpoint: `https://jarvis-20261003200000-rmw7kae3bza6a.services.ai.azure.com/api/projects/jarvis-20261003200000`
- Model deployment: `gpt-6.1-terra`; reasoning effort: `high`.
- Definition: prompt agent, `microsoft_copilot_preview` harness, complete existing
  Jarvis function catalogue with `strict: false`, one
  `microsoft_copilot_toolset_preview` with `default_config.enabled: false`.

The script checks actual ARM project/account location and existing deployment
metadata before agent writes. These observations establish target configuration,
not live model acceptance or harness support for this deployment.

Microsoft's [harness guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
describes new-agent creation, the `MicrosoftCopilot=V1Preview` opt-in, function
tools and disabled built-ins. It requires caller Foundry User access. The
instance identity needs its own project grant for Toolbox/generated-file use;
this candidate uses neither. The existing deployment OIDC principal already has
project Foundry User/Project Manager through the normal deployment path. This
script adds no grants. Any real permission rejection must be assessed for the
specific action and target before requesting an expansion.

## Explicit definition refresh (6 November 2026)

Normal Deploy [42210649006](https://github.com/DanAakesen/jarvis/actions/runs/42210649006)
passed readiness and live acceptance for merged `ab464314`. The subsequent
explicit comparison Deploy
[42212979149](https://github.com/DanAakesen/jarvis/actions/runs/42212979149), job
`127876394689`, completed OIDC login but stopped at 11:50:31 UTC with only
`azure_request_failed`. No `managed_chat_provisioned` or canary marker appeared.
That evidence does not identify the failed operation, prove a permission
rejection, or establish whether a version was created. Inspect the existing
inventory before any provisioning retry.

After deploying the current Jarvis backend and hosted agent, dispatch the existing
Deploy workflow with `provision_managed_chat=true` and the separate default-off
`refresh_managed_chat_definition=true` when the approved tool/identity update needs
a new comparison definition. The shell handoff passes `--refresh-definition` to
the provisioner only for that explicit input. Model/effort remain the existing
`gpt-6.1-terra` / `high`; mismatching selected chat settings still fail verification
rather than being silently changed.

The provisioner now reads the bounded version inventory and reuses one exact
current-manifest match. With multiple versions, every version must still be active,
non-draft and carry the comparison ownership marker. Duplicate exact matches stop
as ambiguous. When no match exists, default behavior remains refusal. Explicit
refresh verifies the existing identity and a single concrete 100% endpoint pin,
creates one new immutable version, verifies exactly one new inventory entry and
unchanged identity, then pins and reads it back. Earlier versions remain intact.
Any uncertain create stops with no retry or pin write. A later reviewed run can
reuse its unique exact match without creating another version. Existing sessions
bound to an earlier fingerprint remain protected by the original target checks.

Local checks exercise refresh refusal, one-version creation, old-version retention,
ambiguous matches, unowned versions, uncertain creation and later exact reuse.
Live target state and original-path inference still require coordinator acceptance.

After the version-route correction, activation
[42219195236](https://github.com/DanAakesen/jarvis/actions/runs/42219195236), job
`127913011998`, printed `managed_chat_provisioned` at 13:17:00 UTC. Backend target
configuration and readiness completed, but the full-policy canary failed at
13:17:58 with `reason=managed_probe_failed`, `stage=response_start`, HTTP 400,
`provider_code=invalid_payload`, `provider_param=instructions` and
`provider_exception=BadRequestError`. The target remains configured. Metadata
availability can therefore verify while inference fails; a selectable runtime
must not be reported as working from that metadata alone.

The [shared policy transport correction](managed-policy-client.md#trusted-policy-input-6-november-2026)
preserves the complete runtime policy in a trusted developer input message instead
of the rejected top-level override. It changes neither manifest nor fingerprint.
Deploy the updated hosted agent, inspect/reuse the unique current-manifest version,
then require the same full-policy canary before declaring Copilot ready. No extra
immutable version, cleanup mutation, access change or availability bypass is
needed for this transport-only correction. Earlier uncertain owner turns still
require their existing explicit recovery flow.

The refresh request follows Microsoft's
[create-agent-version REST contract](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/aiproject#agents---create-agent-version):
`POST /agents/{agent_name}/versions?api-version=v1`, with `definition` and ownership
`metadata` in the body. The name belongs in the path. The earlier refresh code
incorrectly reused `POST /agents` with a body name, which is the separate
agent-creation operation. Initial provisioning still uses that documented
agent-creation operation; only refreshing an existing agent uses the version
route. Diagnostics distinguish `agent_create` from `agent_version_create`.

This contract was checked on 6 November against the published
[azure-ai-projects 2.7.0](https://pypi.org/project/azure-ai-projects/2.7.0/) and
[2.9.0](https://pypi.org/project/azure-ai-projects/2.9.0/) wheel sources:
`operations/_operations.py`'s `build_agents_create_version_request` and
`AgentsOperations.create_version` agree on the route and body. The 2.7.0 wheel's
SHA256 `4bce987ebc93641311f7f9406b94f75f00d96b7d388056bb8b06e1f6f64deeaf`
matches the repository's voice-provisioner lockfile. This establishes a request
contract defect, not the failing operation in the earlier opaque live log.
Inventory inspection must still precede any apply, and uncertain writes are
never automatically retried.

### Read existing inventory before retrying

The separate default-off `inspect_managed_chat` Deploy input runs the same bounded
preflight and version readback against the current hosted manifest. It cannot be
combined with `provision_managed_chat` or `refresh_managed_chat_definition`; the
handoff rejects either combination before its first Azure command. After this
change has qualified and merged, the coordinator can request inspection with:

```bash
gh workflow run deploy.yml --repo DanAakesen/jarvis --ref main \
  -f inspect_managed_chat=true
```

The handoff reads existing infrastructure outputs and invokes the fixed manifest
read operation, which executes no tool or model. It then passes `--inspect` to
the provisioner, whose Azure client permits only GET requests. Inspection exits
before comparison creation, endpoint pinning, activation-file output, backend
configuration, readiness polling or the managed canary. It adds no grants. The
Deploy workflow's normal qualification, deployment selection and independent
live acceptance remain unchanged; this switch restricts the comparison job.

Success prints `managed_chat_inspection_ok` with only the agent's presence,
version count, exact current-manifest match count and whether the existing pin
matches. Unowned, inactive or ambiguous versions and an unverifiable pin still
fail closed. A unique exact match left by an uncertain create can be reused by a
later reviewed apply run without creating another version. Inspection is neither
activation nor inference acceptance.

Failed provisioner requests now print `managed_chat_azure_diagnostic` before the
existing fixed failure code. Its fields are a fixed operation name, method,
whether any write was attempted, and—only when recognized—an HTTP status and
allowlisted Azure error code. Raw CLI stderr, provider messages, identifiers,
URLs, request/response bodies and instructions are never printed. An unknown or
malformed CLI error still identifies the operation without exposing its content.
A write attempt followed by a failed response/readback is not retried. A confirmed
authorization failure must be investigated for that operation, existing OIDC
identity and exact known target before considering any permission change.

## Private manifest input

`--manifest` must be a private UTF-8 JSON file assembled from the authorized
current Jarvis application/agent read, with exactly these top-level keys:

```json
{"instructions":"<current approved instructions>","tools":[{"type":"function","name":"<existing tool>","description":"<current description>","parameters":{"type":"object","properties":{}},"strict":false}]}
```

Supply every current function, retaining exact parameter schemas and descriptions.
Do not use the smoke subset or a manually curated list. The script sorts functions
by name without changing their schemas. It rejects duplicate names, nonfunction
tools, names containing `___`, and enabled strict mode. No private manifest,
instructions, activation file, CLI stderr or provider body belongs in logs or
uploaded artifacts.

The explicit manual job obtains this file through the existing hosted agent's
fixed `managed_definition_manifest` Invocations operation. The current deployment
OIDC identity already has Foundry User authorization to invoke that endpoint. The
hosted bridge uses its existing backend authorization to read the full current
catalogue and returns static normal English chat instructions plus function
schemas. This operation executes no tool or model and includes no user context,
personal settings or credentials. There is no new backend role or token relay.

## Commands and state transitions

For a private manifest already present at `$RUNNER_TEMP/managed-manifest.json`,
validate locally first. The command without `--apply` makes no Azure calls:

```bash
python .github/scripts/provision_managed_chat.py \
  --project-id "$project_id" \
  --project-endpoint "$project_endpoint" \
  --manifest "$RUNNER_TEMP/managed-manifest.json" \
  --output "$RUNNER_TEMP/managed-activation.json"
```

The two target variables must equal the exact project above. After review, run the
same command with `--apply` using the already authenticated normal deployment CLI.
No `az login`, token export, SDK install or additional role step is needed here.
The script captures `az rest` output privately and uses restricted temporary body
files, rather than putting prompts or tools in process arguments.

The apply path performs:

1. Read ARM account/project/deployment metadata using the existing API versions.
2. Read all bounded agent inventory pages. If the comparison name is absent,
   `POST {projectEndpoint}/agents?api-version=v1` once, with its new definition and
   the version metadata marker `jarvis_migration=managed-chat-1350`.
3. Read the agent and all its versions, including drafts. Require one unique exact matching
   version, the marker, exact normalized definition, active status and active
   instance identity principal and effective enabled state, accepting documented
   unset identity status. Pending version `creating` status has bounded read-only polling.
   Existing-name ambiguity stops without writing a new version; the explicit refresh path above handles a changed approved definition.
4. Pin only this agent's endpoint by `PATCH /agents/jarvis-main-copilot-preview`
   with `agent_endpoint.version_selector.version_selection_rules` containing one
   `FixedRatio` rule for the concrete version at `traffic_percentage: 100`.
   An already identical selector requires no write.
5. Read back the selector, identity and version definition. Write a new activation
   file with mode `0600`, refusing existing output paths. Print only
   `managed_chat_provisioned`; failures print a fixed code.

The endpoint selector shape follows Microsoft's
[configuration guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-agent).
One exact existing match can be reused without creating a version, including after a reviewed refresh.
Definition changes require the explicit refresh input; they never silently produce a replacement version. Mutations are not retried after errors or uncertain
outcomes. Inspect the existing candidate before rerunning.

`POST /agents` can create a version for an existing name; the documented API does
not promise atomic create-only behavior. Use the existing shared deployment
concurrency group and ensure no external writer is provisioning this name. The
inventory check is not a distributed lock. The script never targets `jarvis`.

## Fingerprint and activation handoff

The shared standard-library helper
`agents/jarvis/managed_definition_fingerprint.py` normalizes the actual provider
readback after validating it against the intended definition. Its canonical object
is:

```text
{"projectEndpoint": endpoint-without-trailing-slash,
 "agentName": name, "version": version, "definition": normalized-actual-definition}
```

It uses Python `json.dumps(..., ensure_ascii=False, sort_keys=True,
separators=(',', ':'), allow_nan=False)`, UTF-8 encoding and lowercase SHA-256 hex.
Normalization puts the disabled toolset first and sorts functions by name. It
preserves parameter data and array order; only supported benign null/default empty
fields are discarded. The live bridge recomputes the same hash before claiming or
invoking a managed turn.

The private output contains exactly `projectEndpoint`, `agentName`, `version` and
`fingerprint`. Parent integration maps these to the existing project endpoint and
`FOUNDRY_COPILOT_AGENT_NAME`, `FOUNDRY_COPILOT_AGENT_VERSION`,
`FOUNDRY_COPILOT_DEFINITION_SHA256`. Provisioning alone must not mark the runtime
available. A new agent endpoint exists immediately after creation; only the
separate comparison option may be wired to it.

## Explicit manual deployment integration

`deploy.yml` now exposes boolean `workflow_dispatch` input
`provision_managed_chat` and `inspect_managed_chat`, both default `false`. Its separate
`managed-chat-comparison` job requires main, either explicit true input, successful exact
qualification through `plan`, successful deterministic `smoke` readiness and
successful or compatible skipped infra/backend/agent jobs. It retains
`jarvis-production-deploy` concurrency and the current OIDC login permissions.
Normal pushes and dispatches with both inputs false never run this job.

The handoff script `.github/scripts/provision_managed_chat_handoff.sh` reads
existing infrastructure outputs, fetches the manifest through the fixed existing
hosted operation, provisions the comparison, validates its private activation
file and updates only these existing-backend environment variables:

- `FOUNDRY_COPILOT_AGENT_NAME`
- `FOUNDRY_COPILOT_AGENT_VERSION`
- `FOUNDRY_COPILOT_DEFINITION_SHA256`

It preserves other environment values and the normal agent/model defaults. It
then follows the existing bounded `latestRevisionName == latestReadyRevisionName`
readiness pattern and calls the fixed `managed_text_canary` hosted operation.
The canary uses the actual bridge credential for one synthetic managed text turn,
executes no backend tool and cleans up only its own canary conversation. It shares
the production policy request builder and full dynamic chat instructions while
sending only synthetic reference/user inputs. Deploy the updated hosted agent
first: the job requires `status: ok`, model `gpt-6.1-terra`, effort `high` and
`requestShape: managed_policy`; an old plain-string success does not qualify.
Failures log only revalidated stage, HTTP status, provider code/parameter and
exception identifier, never returned text, instructions or raw provider error.
Each invocation has the existing 210-second bound.
The job's 20-minute timeout accommodates the existing readiness loop. There is no
new grant, credential, connection or automatic mutation retry.

All manifest, operation, CLI error and activation files stay in a private
`RUNNER_TEMP` directory with `umask 077` and are removed on exit. None is uploaded.
A failure after backend configuration leaves that configuration visible for
review; it does not reset the target, invoke a fallback or claim success.

This is a comparison configuration handoff, not full release acceptance. The
normal live conversation/research acceptance job and release receipt remain
independent; this canary cannot turn their failures into accepted releases.

Ordinary Bicep deployment now reads only these three existing backend values and
passes a complete, validated tuple through optional Bicep parameters. Missing
configuration remains absent; partial or invalid configuration stops before the
infrastructure deployment rather than silently dropping the target. This keeps
the target optional and does not change the production runtime default. The
provisioning handoff remains the only path that creates or pins the separate
comparison agent. Provisioning another version or changing the fingerprint is
not a substitute for preserving the existing tuple. Runtime parity and
uncertain-turn recovery still need their own qualification.

## Offline checks

```bash
PYTHONPATH=.github/scripts python -m unittest discover \
  -s .github/scripts/tests -p 'test_provision_managed_chat.py'
PYTHONPATH=.github/scripts python -m unittest discover \
  -s .github/scripts/tests -p 'test_managed_chat_handoff.py'
bash -n .github/scripts/provision_managed_chat_handoff.sh
python -m compileall -q .github/scripts/provision_managed_chat.py
```

Fixtures cover exact reuse, name/version ambiguity, private bodies/output,
no mutation retry, complete function schemas, disabled built-ins, target
preflight failures, GET-only inspection, conflicting-mode refusal, post-create
inventory recovery and bounded error diagnostics. They provide no live Azure
authorization or inference proof.
