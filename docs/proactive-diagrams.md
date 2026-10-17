# Proactive assistance diagrams

Discussion proposal, 17 October 2026. No implementation or activation approved.
See [design](proactive-assistance.md) and [plan](../PLAN.md#proactive-assistance--proposed-scope-17-october-2026).

Labels carry status independently of color: **E** = existing repository component,
**P** = proposed application behavior/integration, **O** = optional evaluation,
**F** = future channel. Arrows describe proposed connections, not live verification.
Foundry Routines is a documented capability; Jarvis compatibility, identity and
completion handling remain unverified. Memory is preview, not canonical storage.
Reuse existing components; no cadence or new resource is selected.

## Architecture overview

[SVG preview](assets/proactive-architecture.svg). Mermaid below is editable source.

```mermaid
flowchart TB
    subgraph intake["Triggers and configuration"]
        CFG["E settings / P proactive policy<br/>Editable sources, interests and guidance"]
        SRC["P configurable source adapters<br/>Generic external events and feeds"]
        ROUT["P Foundry Routines integration<br/>Documented schedules / one-shot<br/>Native events: GitHub issues, Teams"]
    end
    GATE["P system-run adapter + policy gates<br/>Trusted owner / run ID / deduplication<br/>No work or delivery 22–07 Copenhagen"]
    CFG --> GATE
    SRC --> GATE
    ROUT -->|"dispatch, not completion"| GATE
    AGENT["E hosted Jarvis agent<br/>P bounded system-run contract<br/>No fabricated Dan messages"]
    BACK["E backend / authenticated tools<br/>P scoped proactive capabilities<br/>Preserve sleep and existing approvals"]
    GATE --> AGENT
    AGENT --> BACK
    subgraph state["Data ownership"]
        VAULT["E vault<br/>Canonical todos and knowledge<br/>P version-safe todo edits"]
        SQL["E SQL / P proactive records<br/>Settings, weekly plans, run outcomes<br/>Evidence and delivery intent"]
        BLOB["E Blob<br/>Artifacts; optional derived checkpoints<br/>No canonical todos or approvals"]
    end
    BACK --> VAULT
    BACK --> SQL
    BACK --> BLOB
    CTX["P shared owner-scoped context<br/>Bounded relevant results + detail lookup<br/>Freshness and system-origin labels"]
    CHAT["E fresh chat<br/>Real authenticated Dan message"]
    MEM["O Foundry Memory preview<br/>Semantic recall; may lag<br/>Not policy, todos or operational truth"]
    SQL --> CTX
    VAULT --> CTX
    MEM -.-> CTX
    CTX --> AGENT
    CHAT --> AGENT
    DEL["P delivery adapters + policy recheck<br/>Only committed durable findings<br/>Notification grants no action authority"]
    SQL --> DEL
    PUSH["P primary channel<br/>iPhone PWA Web Push"]
    PHONE["F telephone calls<br/>Separate approval; no implementation"]
    DEL --> PUSH
    DEL -.-> PHONE
    classDef existing fill:#eef4fa,stroke:#425b76,color:#172b40
    classDef proposed fill:#edf5ef,stroke:#40694b,color:#163020
    classDef optional fill:#f7f1e7,stroke:#83652c,color:#392b13,stroke-dasharray:5 4
    class AGENT,BACK,VAULT,SQL,BLOB,CHAT,CFG existing
    class SRC,ROUT,GATE,CTX,DEL,PUSH proposed
    class MEM,PHONE optional
```

Foundry's hosted Invocations dispatch can carry JSON; the new adapter must
authenticate and validate it. Generic source events use adapters, not assumed
native Routines triggers. Public capability documentation is linked in the
[architecture recommendation](proactive-assistance.md#recommended-architecture-after-the-foundry-comparison).
Low-to-medium use, bounded lifetime and measured total cost guide evaluation.

## Run and fresh-chat flow

[SVG preview](assets/proactive-flow.svg). This activity diagram separates
dispatch acceptance from completed work and shows the later fresh-chat path.

```mermaid
flowchart TB
    TRIG["P scheduled / one-shot dispatch<br/>or external event through source adapter"]
    CHECK{"P deterministic gate<br/>07–22 Europe/Copenhagen?<br/>Identity, owner and policy valid?"}
    STOP["No proactive source/model work or delivery<br/>Defer to daytime or refuse<br/>No emergency exception"]
    CLAIM["P application run ID + deduplicated claim<br/>Dispatch acceptance is not completion"]
    CONTEXT["P bounded relevant context<br/>SQL outcomes/plans + vault evidence<br/>Optional semantic recall; verify freshness"]
    RUN["E Jarvis + backend tools / P bounded run<br/>Recheck policy before source/model calls and writes<br/>Todo edits require current version and authority"]
    CUT["At 22:00 or revocation: cancel/defer<br/>No new proactive calls, writes or delivery<br/>No completed-result claim"]
    SAVE["P durable SQL outcome + delivery intent<br/>Stable finding ID and evidence references<br/>Reconcile uncertain completion before retry"]
    CLOSE["P owned-session cleanup on every exit<br/>Preserve interactive sessions and sleep<br/>Uncertain cleanup requires recovery"]
    DUE{"P delivery gate<br/>Daytime, opted in, fresh,<br/>relevant and not duplicate?"}
    HOLD["Silent / defer / expire<br/>Keep durable item for later retrieval"]
    SEND["P Web Push to authenticated item<br/>Accepted is not displayed or read<br/>Never approves an action"]
    NEW["Later: E fresh authenticated chat"]
    READ["P same-owner context retrieval<br/>Relevant outcomes, todos, plans and notifications<br/>Bounded summary + detail lookup"]
    ANSWER["E Jarvis answers using evidence<br/>System observations are not human instructions<br/>Memory lag cannot hide current SQL outcomes"]
    TRIG --> CHECK
    CHECK -->|"no"| STOP
    CHECK -->|"yes"| CLAIM
    CLAIM --> CONTEXT --> RUN
    RUN -->|"cutoff / revoked"| CUT
    RUN -->|"finished"| SAVE
    RUN -->|"error / uncertain: record if possible"| CLOSE
    CUT --> CLOSE
    SAVE --> CLOSE
    SAVE --> DUE
    DUE -->|"no"| HOLD
    DUE -->|"yes"| SEND
    NEW --> READ --> ANSWER
    SAVE -.->|"durable across sessions"| READ
    classDef proposed fill:#edf5ef,stroke:#40694b,color:#163020
    classDef existing fill:#eef4fa,stroke:#425b76,color:#172b40
    classDef gate fill:#f7f1e7,stroke:#83652c,color:#392b13
    class TRIG,CLAIM,CONTEXT,SAVE,CLOSE,HOLD,SEND,READ proposed
    class RUN,NEW,ANSWER existing
    class CHECK,DUE,STOP,CUT gate
```

The delivery branch requires the SQL commit; cleanup is required even on failure.
At the cutoff, only termination/recovery bookkeeping is permitted, not continued
proactive work. No cadence is selected. Tests must prove the full nighttime pause,
retry deduplication, owner isolation, fresh-chat recall and actual sleep/cleanup
cost. These diagrams do not establish deployed compatibility or billing behavior.

## Rendering

Keep SVG previews synchronized with the two Mermaid blocks. Render the first
block to `assets/proactive-architecture.svg` and the second to
`assets/proactive-flow.svg` using Mermaid CLI. No runtime dependency is required.
The checked previews use Mermaid CLI 11.17.0's Mermaid renderer, Arial 17px,
the base theme, `htmlLabels: false`, and flowchart settings `curve: linear`,
`nodeSpacing: 25`, `rankSpacing: 35`, on white. Chromium rendered the source in
memory because this environment blocks the CLI's `file://` page. Both SVGs were
visually inspected and their text bounds checked against the SVG view boxes.
