---
name: jarvis-situational-context
description: Read, resolve and maintain Jarvis's compact PI situational state during a normal owner turn or a background activation. Use it whenever current cross-source context, freshness, a source reference or a material state change matters.
---

# PI situational context

The situational state is a compact, revisioned working model. It is not the source archive, conversation history or provider memory. Raw records stay with their existing tools and stores.

## On a PI activation

1. Read the trusted state block in the activation first. It identifies the current revision/hash, compact summary, raw reference ids, and stale, missing or disabled sources.
2. Use `situation_read` when the state must be inspected or refreshed during the turn. The tool only runs under the live activation grant.
3. Use `situation_lookup` for a specific raw reference only when the decision needs detail. Keep the lookup bounded and cite the returned source and observed time in the decision.
4. Treat freshness and `stale`/`missing` labels as facts. Never turn missing data into a claim.
5. A direct owner request may use the underlying source tool normally. A Proactive switch off does not grant automatic background reads: for wakes, skip the source and its stale state.
6. Location is an independent, coarse, permissioned context source. It may ground hotel, flight, driving, traffic and map requests. It is not live GPS, and Weather being off does not disable it.
7. Use `situation_patch` for a material change. Pass the exact revision, state hash and policy revision returned by `situation_read`, then include only changed refs, facts, sources, summary or follow-ups. A new `upsertRefs` item must be copied exactly from a server provider observation or `situation_lookup.verifiedRef`, including `observedAt` and `verifiedAt`; never invent an id, identity, label or either instant. A lookup receipt is not active evidence until this exact generation is patched/committed. Use the remove arrays to invalidate only affected evidence. Compatibility `situation_commit` is not the normal path because it replaces the whole model.
8. A stale patch is refused. Read the current revision and re-evaluate; never overwrite unrelated facts.

## State quality

- Keep the state useful at roughly 500–2000 tokens. Summarise; never copy full conversations, mail, notes or source archives.
- Every material fact links to one or more raw refs with a source and observation time. A non-empty summary also names its `summaryRefIds`; if one becomes disabled or stale, the summary is withheld rather than copied as an unqualified claim.
- Retain prior facts only with an explicit stale label and reason. Disabled-source facts must not be used proactively and are excluded from a new automatic contribution. Re-enabling the source does not revive them: only an observation newer than the persisted disable epoch can make its refs, facts, summary or follow-ups current again. A failed refresh or activation only invalidates the facts tied to that source.
- A follow-up with `dueAt` and raw refs is scheduled by the server in the existing event queue. Update or remove that one follow-up through a patch instead of recreating it in another note or timer.
- When `message_dan` carries a suggestion that Dan may accept later, include only server-current evidence refs/identities and observation times, plus any pending follow-up IDs. Chat and Voice recover that same bounded receipt for "do that". A follow-up is queued durably with the state revision; the model never needs a second timer or a duplicate note.
- Never put secrets, credentials, raw credentials, tokens or unnecessary personal detail in state.
- A tool or commit failure is a failure. Report it as such; do not describe the old state as freshly confirmed.
