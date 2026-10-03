---
name: engineering
description: Implement or assess business logic, APIs, persistence, authentication, background jobs, integrations, runtime/build changes, and system structure. Read relevant sections for the affected boundary. Presentation-only UI work uses product-ui.
---

# Engineering

Use this as the single detailed software workflow. Follow the mandatory engineering baseline in the project entrypoint. Work directly within the requested scope; no PR, extra agent, recurring audit, or fixed architecture is required. Read the sections that affect the change.

## Trace and bound the change

- Follow the `AGENTS.md` context map. Read relevant requirements, system boundaries, prior choices, and execution constraints; inspect nearby code, callers, and existing checks before editing.
- Reproduce the reported behavior or identify the precise missing behavior. Trace the flow from entrypoint through services, storage, integrations, and user-visible result.
- Identify who owns state, retries, side effects, and recovery. Explain affected service, data, identity, or deployment boundaries before implementing a structural change.
- Reuse the repository's stack, versions, frameworks, conventions, package managers, lockfiles, and stable abstractions. Make the smallest coherent change and keep unrelated cleanup/formatting out of it.
- Add a service, queue, cache, plugin, interface, framework, or abstraction only for a demonstrated requirement. Use interfaces at genuine replacement, integration, or test boundaries; avoid forwarding wrappers and a layer for every domain noun.
- Keep names tied to domain actions and outcomes, branching and state transitions visible, and code locally understandable. Remove dead code only within scope. Do not make TODOs or placeholders look like completed behavior.
- Measure before optimizing. Separate measurements from hypotheses and estimates. A scoped performance investigation uses `swe-performance-hunt` when installed.

## APIs, persistence, and domain behavior

- Validate and normalize untrusted input at the receiving boundary. Keep API, domain, and persistence contracts distinct where their responsibilities differ; do not expose database rows, exceptions, or raw provider responses as public contracts.
- Return protocol-appropriate status codes and stable error shapes. Handle expected failures explicitly at the boundary that can recover or report them; preserve diagnostic causes while sanitizing sensitive details.
- Bound request/response sizes, result sets, concurrency, and downstream calls. Paginate or stream growing collections.
- Use transactions for changes that must succeed together. Define concurrency behavior for overlapping requests or workers and idempotency for duplicate delivery.
- Keep migrations reproducible and compatible with deployment order. Preserve data and contracts unless the task includes a reviewed change and recovery path. Derive retention/deletion from product and privacy requirements.
- Store money as exact decimals with explicit currency. Preserve timezone and date-only semantics; do not silently reinterpret a local date as a UTC instant.
- Choose indexes and query changes from actual access patterns and query plans. Reuse the database client's lifecycle and connection pooling; add persistence wrappers only for a concrete benefit.

## Jobs, integrations, and resource lifetimes

- Give asynchronous work an owner, lifecycle, observable status, terminal states, timeout, cancellation, ordering, retry, and recovery behavior appropriate to its risk.
- A disconnect, restart, timeout, or duplicate delivery must not silently corrupt or duplicate important work. Make partial completion visible.
- Propagate request deadlines and cancellation downstream where supported. Dispose resources, cancel tasks, and unsubscribe handlers when their owner ends.
- Retry only transient failures within a deadline; protect side effects from duplicates. Do not blindly retry payments, sends, creates, or other non-idempotent writes.
- Use operation identifiers and useful sanitized diagnostics. Keep telemetry proportional to the application's risk and scale.

## Security boundaries

- Authenticate the caller and authorize the specific operation and resource server-side. Fail closed when identity or permission cannot be verified. Keep sensitive writes behind the product's explicit confirmation boundary.
- Use least privilege for services and jobs. Store credentials in approved secret storage or protected runtime configuration; never copy them into source, client bundles, fixtures, exports, prompts, or ordinary logs.
- Do not expose privileged tokens to browsers, untrusted plugins, or task sandboxes unless explicitly scoped for that use. Redact secrets and unnecessary financial, health, or personal data from diagnostics.
- Validate input shape, size, encoding, and permitted values. Use parameterized queries and context-appropriate output encoding.
- Address CSRF, SSRF, replay, rate limits, and abuse controls when the actual endpoint and data/cost make them relevant. Use maintained authentication, cryptography, and transport libraries; do not create custom cryptography or disable certificate validation.
- Assess dependency advisories against the installed version and reachable code. Distinguish confirmed exploitability from outdated-package hygiene; requested package/license audits use `swe-security-audit` when installed.
- Preserve access controls, compatibility, and recovery for persisted-data changes. Follow actual authorization for migration, deletion, credential rotation, publication, deployment, and paid resources.

## Node.js, when applicable

- Preserve the selected Node version, module format, package manager, lockfile, framework, and validation tools.
- Validate required environment configuration at startup with clear, non-secret diagnostics. Keep server-only dependencies and credentials out of client bundles.
- Await asynchronous work and handle rejection where it can be reported or recovered. Apply downstream timeouts/response-size limits and propagate deadlines/cancellation.
- Keep CPU-heavy/blocking work off the event loop and avoid shared mutable global request/task state.
- Use the framework's error pipeline and lifecycle hooks. Handle graceful shutdown, cleanup, and readiness for long-lived work; make serverless invocations safe under concurrency and retries.

## .NET, when applicable

- Preserve the supported SDK, nullable settings, analyzers, formatting, dependency versions, and validation conventions.
- Keep endpoints focused on binding/validation, authorization, the domain/application operation, and mapping the established response contract.
- Use host dependency injection and configuration; validate required options at startup. Avoid service locators and static mutable request state.
- Pass `CancellationToken` through database, HTTP, and other asynchronous work. Do not block on async or swallow cancellation exceptions.
- Use `IHttpClientFactory` or the established client lifecycle. Set deadlines, limit response content, and dispose owned resources.
- Use reproducible EF Core migrations and transactions/concurrency handling when needed. Avoid wrappers that merely duplicate EF APIs.
- Preserve error handling, structured logging, and API conventions; keep stack traces, secrets, and provider internals out of responses. Do not impose Clean Architecture, CQRS, MediatR, or additional layers without a demonstrated need.

## Validation and delivery

- Follow the user's requested validation scope and project commands. When testing is requested, cover changed observable behavior, important failures, and likely regressions with existing tools; add no framework or coverage target without a concrete need.
- Prefer deterministic evidence: controlled time, randomness, and external responses; avoid arbitrary sleeps and live services in unit tests. Use integration checks where mocks would hide persistence, identity, network, or process risk.
- Start with narrow relevant checks, broadening for shared code, public contracts, authentication, stored data, packaging, or deployment. Reuse CI evidence only for the exact revision it covers.
- Never delete/weaken a failing check to make it green. Distinguish baseline issues from regressions. Requested coverage improvements use `swe-test-gap-hunt`; a commit-scoped regression review uses `swe-recent-commit-bug-hunt`, when installed.
- Inspect the final diff for unrelated changes, leaked secrets, unfinished behavior, and stale docs. Update `docs/architecture.md` for changed system boundaries and `docs/decisions.md` for accepted trade-offs, dates, rationale, and evidence. Mark future options proposed/open.
- Report changed behavior, exact commands/results that ran, blocked checks, and material uncertainty. Separate local checks, live verification, and human acceptance. Engineering decisions do not grant authorization for external actions.
