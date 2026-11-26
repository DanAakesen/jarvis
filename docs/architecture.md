# Jarvis architecture

System map from code and workflows, not a production readback. See [PLAN.md](../PLAN.md) for release status, [PRODUCT.md](../PRODUCT.md) for requirements and the [operator manual](agent-context.md) for commands.

## Stack overview

| Component | Where it lives | Responsibility |
| --- | --- | --- |
| iPhone and Apple Watch | [apps/ios](../apps/ios), SwiftUI and `JarvisCore` | Chat, Voice, capture and notifications. Watch dictation uses Azure Speech through the backend's Node WebSocket with a bearer header. Upload/recognition budgets are 30/20 seconds; Watch allows 55 seconds direct, with fresh budgets on a phone retry. |
| Web | [apps/web](../apps/web), React, TypeScript, Vite | Browser UI, Entra sign-in, Chat and Voice. |
| Backend | [apps/backend](../apps/backend), Node 22, TypeScript, Fastify | Auth, Chat, `/voice`, tools and their receipts, PI gateway, scheduled jobs and push. Shared schemas and failure copy live in [packages/contracts](../packages/contracts). |
| Database | [Azure SQL schema and migrations](../db/README.md) | Chat history, owner settings, Personal Memory, Vault index, PI runs and situation, proactive queue, APNs registrations and delivery outboxes. The backend runs forward migrations before listening; preserve existing checksums and matching down batches. |
| Vault and mirror | [Vault API](../apps/backend/src/vault), [mirror job](../apps/vault-mirror/README.md) | Markdown notes and their tasks live in the GitHub vault. The mirror reconciles GitHub and Obsidian, with a Blob-backed base and a separate status record; the backend reads the status, not the mirror's working directory. |
| `jarvis-pi` | [agents/pi](../agents/pi), managed Copilot harness in Azure Foundry | Foreground reasoning and tool use; background wakes use the same agent in scratch conversations. |
| `jarvis-pi-live` | [Voice definition](../agents/pi/voice-definition.json), GPT-Live in Azure Foundry | Listens and speaks. It delegates tool work to its client, the backend Voice relay, which calls PI. The device does not run the tools. |
| Tool dispatcher | [PI MCP door](../apps/backend/src/pi/mcp.ts), [core routes](../apps/backend/src/core/index.ts) | Turn-scoped discovery and execution. GitHub (`gh_`) and Azure (`az_`) are backend bridges; the managed harness runs its own built-ins. |
| Proactive and push | [PI brain](../apps/backend/src/pi/brain), [scheduler](../apps/backend/src/proactive), [push](../apps/backend/src/push) | Ingest signals, wake PI, and durably send owner-visible outcomes via APNs. Not every event should wake the brain or send a push. |
| Software Factory | [Backend Factory](../apps/backend/src/factory), [runner](../runner), [PC bridge](../pc-bridge) | Durable coding work, GitHub status and worker events. PC actions run through the separately authenticated bridge, not in the Foundry session. |

```mermaid
flowchart TB
    APP["iPhone · Watch · web"]
    CHAT["Chat route"]
    RELAY["Voice relay /voice"]
    LIVE["Foundry: jarvis-pi-live"]
    GW["PI gateway"]
    PI["Foundry: jarvis-pi and harness built-ins"]
    DOOR["/pi/mcp: find_tools + call_tool"]
    TOOLS["Jarvis tool dispatcher and bridges"]
    SQL[("Azure SQL")]
    VAULT[("GitHub vault")]
    MIRROR["Vault mirror job"]
    OBS[("Obsidian")]
    EXT["GitHub · Azure · other integrations"]
    PUSH["Reply worker and APNs"]
    LEG["Legend: box = component; cylinder = store; arrow = call or delivery"]
    APP -->|typed turn| CHAT --> GW
    APP <-->|audio and state| RELAY
    RELAY <-->|live session| LIVE
    RELAY -->|whole delegated turn| GW
    GW --> PI --> DOOR --> TOOLS
    CHAT --> SQL
    RELAY --> SQL
    TOOLS --> SQL
    TOOLS --> VAULT
    TOOLS --> EXT
    VAULT <--> MIRROR
    MIRROR <--> OBS
    SQL -->|outbox| PUSH --> APP
```

## The two Foundry agents

| Ownership | `jarvis-pi` | `jarvis-pi-live` |
| --- | --- | --- |
| Foundry owns after bootstrap | Live instruction text | Live instructions, output voice, greeting and `store` |
| The repository owns | `gpt-6.1-terra`, harness, tools, MCP connection and skills in [definition.json](../agents/pi/definition.json) | `gpt-live-1`, the `live` sub-protocol, client delegation and 24 kHz PCM contract |
| Deploy after bootstrap | Reads the serving version. For code-owned drift, carries forward its live instruction text, verifies the new version and pins it. No write when the code-owned definition matches. | Verifies the serving technical contract and model deployment; drift fails Deploy. Does not rewrite an existing voice agent. |

Chat and Voice use `manage_foundry_agent`. Edits copy the serving definition to a new version. Activation pins a version and reads the selector back. If verification fails, PI reports the last known write and reads back before retrying. Model roles and ARM deployments use settings and deployment tools. A PI deployment deletion requires owner confirmation. [Foundry agent API](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/aiproject)

The seed files apply when the agents are created, not as later portal text updates. Preserve the entire **KEEP THIS BLOCK** in the main agent's live instructions; it contains the turn-reference contract. Do not paste the voice text into `jarvis-pi`. Avoid changing Active while Deploy provisions: it rechecks the serving version before writing and pinning.

```mermaid
flowchart LR
    PORTAL["Portal or Jarvis: edit and activate a version"] --> ACTIVE["Serving version"]
    ACTIVE --> DEPLOY["Deploy reads the version"]
    DEPLOY -->|PI code changed| VERSION["Carry forward text, verify, pin"]
    DEPLOY -->|PI unchanged| NONE["No write"]
    DEPLOY -->|existing Voice| VERIFY["Verify only"]
    VERSION --> ACTIVE
    LEG["Legend: boxes are steps; arrow labels select a path"]
```

Without a pin, the [provisioner](../.github/scripts/provision_pi_agent.py) reads the latest version.

<a name="voice"></a>

## Chat and Voice

- **One owner conversation for foreground PI.** Chat and delegated Voice share the persisted PI conversation (`dbo.pi_conversation`) and the gateway's FIFO claim; each turn gets its own tool grant. Waiting counts against the turn deadline (180 seconds by default; 90 for the Voice leg). Warm-up skips a busy turn. On a Foundry 404 before any reply text, the gateway tries to drop the provider binding so the next turn can create a conversation. It does not replay the failed turn or delete saved Chat history. Proactive wakes use separate conversations.
- **Chat.** The server stores the owner message, adds [agent context](agent-context.md#agent-context) and streams text, tool activity and the terminal result. An iPhone reconnect can discover and follow an active turn or reconcile its committed reply without resending. App history, Foundry history and [diagnostic logs](reference/logs.md) are separate records.
- **Voice.** GPT-Live can answer directly. For a delegation the relay joins the whole transcript after 1.5 seconds of quiet (at most 3 seconds), stores the request once and starts PI once; it never cuts at the delegation offset. It relays PI commentary. Near-silent PCM cannot start a response group or clear a pending lookup. Backchannels do not cancel PI; new delegation, session end or timeout can stop it. Delivered generated windows are upserted in the call's Chat history by window ID, without live actions. The backend is audio-only.
- **Watch Voice.** The paired iPhone relays audio without waiting for caption acknowledgements; exhausted caption retries do not end the call. The phone starts its peer timeout after opening the relay. Watch tries echo cancellation first, can retry unprocessed, and checks for fresh PCM before accepting a Voice route restart. It reports playback completion to the phone. A stored turn proves neither speaker delivery nor continuity.
- **Parity is a contract, not identical presentation.** Both channels see the same PI tool effects and failure meaning. The [replay tests](../apps/backend/src/voice/chat-voice-parity.test.ts) exercise the real routes, gateway and door against stubs. Their [report helper](../apps/backend/src/voice/parity-report.testkit.ts) documents intended presentation differences. Native audio and device rendering are separate acceptance.

```mermaid
sequenceDiagram
    participant App as Voice client
    participant Live as GPT-Live
    participant Relay as Backend relay
    participant PI as PI gateway
    App->>Relay: Audio frames
    Relay->>Live: PCM audio
    Live-->>Relay: Transcript deltas and delegation
    Relay->>Relay: Finish transcript and store one owner message
    Relay->>PI: Run delegated turn in shared conversation
    PI-->>Relay: Commentary and reply
    Relay->>Live: Append commentary
    Live-->>Relay: Output audio
    Relay-->>App: Audio and labelled state
    Note over App,PI: Legend: solid = input or command<br/>dashed = event or result
```

## Tools, retries and failure copy

```mermaid
flowchart LR
    TURN["Current owner turn and grant"] --> FIND["find_tools: search name or intent"]
    FIND --> CALL["call_tool: exact name and arguments"]
    CALL --> REPLAY{"Matching local action replay with trusted call ID?"}
    REPLAY -->|yes| PRIOR["Return prior result"]
    REPLAY -->|no| DISPATCH["Shared dispatcher or remote bridge"]
    DISPATCH --> RECEIPT["Outcome and tool evidence"]
    PRIOR --> RECEIPT
    LEG["Legend: diamond = replay check; arrows = request flow"]
```

1. PI passes the **current** turn reference to `find_tools` and `call_tool`. Use an exact name returned by search; `otherMatches` are callable. Prefer aliases over new MCP entry points. GitHub and Azure bridges load on named searches with a bounded wait; the first search can ask PI to try again.
2. The door calls the normal `/tools/:name` route for Jarvis tools using the owner message bound to this turn. GitHub file reads carry the embedded source text and its resource URI. A download receipt alone points PI to `repo_read` for line ranges on the project's default branch. Read results above 24,000 serialized characters get a bounded preview, except `list_capabilities`; paging/status fields and receipts stay intact. Do not truncate action results.
3. **Replay ledger.** Within a live turn, a known local action with the same trusted `_meta` call ID, tool and arguments may reuse the earlier successful or uncertain result. This also covers a duplicate arriving while the first attempt runs. A different call ID is a separate request. Missing or reused-for-different-work IDs disable replay recognition; JSON-RPC IDs are not used. Reads, unclassified calls and remote bridge calls are not replay-suppressed here. `pi.mcp_tool` records the evidence; do not treat the in-memory ledger as durable exactly-once delivery.
4. **Unknown outcome is not failure to act.** If a write might already have run, say so (`outcomeUnknown`), preserve its receipts and verify before retry. A rejected or output-free rate-limited round can retry within its deadline. If a known response stream breaks, Foundry must report it cancelled with no output before the gateway replays it. A later failed round can still return recorded receipts.
5. **Plain copy.** [`failureCopy`](../packages/contracts) gives Chat and Voice the same failure meaning in writing and speech. Separate “nothing happened”, “might have happened”, and a confirmed tool outcome. A refused tool or a missing final answer is not evidence that prior work failed. See the [generated tool conformance table](tool-conformance.md).

Azure MCP uses exact leaf filtering from the pinned 3.0.0 image. Subscription and resource-group inventory, Container Apps listing, scoped storage/blob operations, Monitor metrics/resource-health reads, and workbook management are exposed. Group resource inventory must be repeated per resource group. Raw workspace/resource KQL tools and web tests are excluded; the backend's dedicated `read_backend_logs` tool remains the sanitized diagnostic path. Azure MCP 3.0.0 exposes only Container Apps listing, not get/scale/revision control. Jarvis Storage Queue operations are separate PI tools backed by the backend identity and the existing account's queue service; peek is non-consuming, receive temporarily hides messages, and deletion uses owner confirmation. The queue SDK disables retries for non-idempotent send/receive operations.

```mermaid
flowchart TB
    STREAM["Foundry response stream"] --> ITEM{"Output item"}
    ITEM -->|message or known progress| SHOW["Emit text or evidence"]
    ITEM -->|unknown type| LOG["Log type and keep reading"]
    ITEM -->|function or approval request| END["Read to terminal event, then classify"]
    END --> NATIVE["Native: Foundry ran it; don't answer"]
    END --> CLIENT["Client-owned: settle once in a bounded follow-up"]
    END --> INCOMPLETE["Unknown: leave alone and log"]
    LEG["Legend: diamond = item type; arrows = gateway control flow"]
```

Foundry, not the backend, runs the harness's native shell and sub-agent work.

**Limits.** Large retained conversations can hit the shared model quota across tool rounds. Foundry controls context compaction. Session policy can deny an MCP name *before* `/pi/mcp` sees it; compare `pi.stream_failed` and `pi.mcp_tool`. Live provider replay IDs remain unverified. `get_settings` with the `location` area returns the coarse iPhone observation and timestamp when available. An unsynced permission is unknown until iOS reports it.

Apple Maps requests use the signed-in iPhone workspace connection. MapKit searches and routes on the phone. The native card and local spoken estimate use a temporary result. For nearby searches the iPhone checks matching businesses and distance, then returns the count and checked radius to PI. An explicit nearest search ranks MapKit matches by straight-line distance, not global proximity. Only a bounded receipt returns to PI, not the resolved addresses, route distances or coordinates. Conversation history keeps the lookup request and handle so the owner can request a fresh estimate. [Apple Maps terms, Attachment 6](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).

## Memory and Vault Knowledge

| Store or context | Rule |
| --- | --- |
| Session context | Recent conversation, turn receipts and situation. It helps with follow-ups; it is not a write to Memory or a Vault note. |
| Personal Memory | SQL through [`core/memory.ts`](../apps/backend/src/core/memory.ts) and its policy. Settings `/memory` returns Personal Memory, not notes. Automatic capture obeys the setting. An explicit owner request to remember can still save; acknowledge only after commit. Keep credentials out of model recall, embedding and storage. |
| Vault Knowledge | Markdown and tasks in the GitHub vault via Notes and `vault_*` tools. SQL keeps a rebuildable search/index projection, not a second note source of truth. Re-read the exact Vault revision before writes. |
| Vault mirror | Separate scheduled Container Apps job, with its own identity and base/status blobs. A successful job status is not proof a client has refreshed. Bicep defaults write-back to `dry-run`; do not infer the production setting from that default. |

### Vault note inventory and title repair

[`dbo.vault_notes`](../db/migrations/0103_vault_note_metadata.sql) indexes path, blob SHA, title and content-update time apart from search chunks, including title-only notes. Sync marks inventory ready before title backfill (up to 32 newest-first legacy reads, 20-second deadline). Repair updates only the matching SHA and leaves the content date. A write or Vault push during sync schedules a fresh-tree pass. A Git commit can succeed before its index update; sync repairs it.

Notes and Graph share titles. `/notes/summaries` checks up to 50 exact pin paths, outside page or graph limits. Missing or stale metadata uses a readable filename, not a scan or embedding lookup. iPhone can show an account-bound snapshot while revalidating newest-first pages without HTTP cache reuse.

An iPhone edit and folder move use the original blob SHA and one Vault commit. The filename stays the same; a stale source or occupied destination leaves the draft unsaved.

### Daily integration boundary (P12-01)

Health and workout tools use SQL `daily`. iPhone Today, Chat and Voice use one Copenhagen-day meal ledger and one eligible active-energy reading, not both iPhone and exporter totals. All-history totals aggregate by month; Body All reads occupied metric/year ranges from `/health/dashboard-history/body` and pages the individual measurements. iPhone Health sync and Shortcut ingestion are separate from Watch display. iPhone Gym can record lifts in the Vault; `gym_lifts` reads SQL and the Vault. See the [data model](reference/data-model.md) and [Health module](../apps/backend/src/health/README.md).

Home and Calendar read the primary Google Calendar through the owner-authenticated backend. Edits use Google event versions and publish a Home refresh after Google confirms the write. The Home brief expands short model citations back to original source references.

`PATCH /settings` saves validated appearance settings, including material percentages and Card glow. The iPhone caches the palette and finish in its App Group and sends them via WatchConnectivity application context. Watch caches both and uses the palette in complications. Per-card iPhone overrides change colour only.

## Proactive wake and Inbox review

```mermaid
flowchart LR
    EVENTS["Tracked GitHub or worker changes, calendar clashes, failed reminders"]
    QUEUE[("Deduplicated event queue and future follow-ups")]
    SCHED["Scheduler: tick, slots and Check now"]
    BRAIN["PI brain and activation"]
    WAKE["PI gateway: scratch conversation"]
    INBOX["Inbox review and eligible follow-up"]
    DELIVERY["message_dan: evidence, stored Chat reply and push"]
    EVENTS -->|enabled sources| QUEUE --> BRAIN
    SCHED -->|PI configured| BRAIN
    BRAIN -->|eligible scheduled slot| INBOX
    BRAIN -->|due and permitted background wake| WAKE
    WAKE -->|if PI chooses to reach out| DELIVERY
```

- The brain combines events, watches and scheduled sweeps. It uses source switches, dedupe, spacing, quiet hours, a daily allowance and a separate background spend ledger. The model chooses what matters. Durable state and evidence prevent stale references, duplicate follow-ups and messages based on data the owner has disabled. Exact timed reminders have their own delivery path and do not depend on the background switch.
- Missing switch state means **Off**. iPhone Settings and Proactive share enablement; inline preference saves use revision-checked `PATCH /proactive/settings`. `/pi/brain`, `/pi/status` and `/proactive/status` read state without starting a model. A wake is not proof of delivery.
- PI owns the 07:00 and 18:00 Copenhagen slots and Check now. At the daily turn cap, pending events wait until Copenhagen midnight. An event-covered slot can run its Inbox review once even at the cap, without a second PI wake. No brain configured means no slots claimed.
- Background Calendar reads the next 48 hours; Travel queries its own days 3–7 window. Continuations keep the original Google query. Each background window reads at most two pages and 50 returned events.

## Reply push and reminders

```mermaid
sequenceDiagram
    participant Chat as Chat and proactive comms
    participant SQL as Conversation store and outbox
    participant Worker as Reply notification worker
    participant Apple as APNs
    participant Phone as iPhone or Watch
    Chat->>SQL: Commit reply and outbox rows together
    Worker->>SQL: Lease pending row
    Worker->>Apple: Send the stored preview and exact target
    Apple-->>Worker: Provider result
    Worker->>SQL: Store result for this registration
    Apple-->>Phone: Deliver notification
    Phone->>Chat: Tap opens exact session and message
    Note over Chat,Phone: Legend: solid = request<br/>dashed = provider result or delivery
```

The normal reply sender is [`reply-notifications.ts`](../apps/backend/src/push/reply-notifications.ts), not an inline callback. One stored preview per reply and per-registration delivery evidence keep retries honest. A tap is a `jarvis.reply` target, not an approval or a `jarvis.proactive` item. Watch may defer the tap while busy and retains the exact target across refresh. Explicit reminders use their own occurrence outbox and terminal evidence; see [migration 0102](../db/migrations/0102_owner_reminder_delivery_outbox.sql).

## Deployment and qualification

```mermaid
flowchart LR
    PR["Ready PR on current main"] --> CI["Exact-head CI and independent review"]
    CI --> RECEIPT[("Qualification receipt: head, tree, checks")]
    CI --> MERGE["Integration merges tested tree"]
    RECEIPT --> DEPLOY["Deploy verifies tree before Azure access"]
    MERGE --> DEPLOY
    DEPLOY --> READY["Bicep, components, PI readiness and release evidence"]
    READY --> TF["Separate signed TestFlight build from main"]
    LEG["Legend: cylinder = immutable artifact; arrows = build order or input"]
```

- [Bicep](../infra/README.md) owns Azure SQL, Key Vault, Storage, ACR, Container Apps, Foundry and Static Web Apps. A Container Apps image runs the backend; managed identity gives it scoped Azure access. The mirror is a separate job. Client sign-in is Entra; keys and server credentials do not go to clients.
- [CI](../.github/workflows/ci.yml) qualifies the ready PR, not whatever later happens to be on the branch. [Deploy](../.github/workflows/deploy.yml) selects affected components, verifies the merged Git tree equals the qualified tree, and retains [deployment evidence](../.github/scripts/release_state.py). A no-op or superseded run is not fresh provider acceptance. An unchanged tree need not rerun a component; changed inputs need matching evidence.
- Backend readiness includes PI provisioning/readback and the exact applied revision, not a live conversation test. [TestFlight](../.github/workflows/ios-testflight.yml) signs and uploads the dispatch SHA and reads back Apple processing and internal beta state. A normal release uses `main` after Deploy is green. A receipt is not device acceptance.

<a name="sandbox-credentials"></a>

### Coding sandbox

Factory runtime sandboxes are not this repository's development environment. Credentials belong to the runner, its managed identity and protected secret storage. See the [runner](../runner/README.md) and [infra map](../infra/README.md) for those boundaries.

### Cost

Foreground PI tracks input, cached input and output separately; background reserves and reconciles its own allowance. See [cost and safety](agent-context.md#cost-and-safety) for approval rules.

## Invariants to keep

- **P0: same tools in Chat and Voice.** One foreground PI conversation and dispatcher; do not add a second provider or path to mask failure.
- **Model decides; code proves facts.** No new approval or confirmation gates for PI except delete. That product rule does not remove sign-in, owner identity, data provenance or safe delivery checks. An accepted request or APNs send is not proof of the final outcome.
- **Unknown outcomes stay unknown.** Use actual receipts and require a readback before recommending a retry of a potentially committed action.
- **Qualify the exact tree.** Merge through a PR with independent review and green checks for its current head on current `main`; the PR author may merge after those checks. See [merge and release](agent-context.md#merge-and-release).
