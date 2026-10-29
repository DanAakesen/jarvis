# Runtime application lifecycle comparison

Local synthetic evidence for migration #1350. The same two scenarios run for
persisted `current` and `copilot` test sessions. This is application lifecycle
coverage, not a provider inference, model parity or deployment qualification.

The test is `apps/backend/src/core/runtime-lifecycle-comparison.test.ts`.
It uses the real session, turn, steering, tool and reattachment HTTP routes,
`RecoverableChat`, and `createFoundryInvocationConversationAgent` SSE parsing.
The injected provider fetcher returns controlled SSE responses; it never contacts
Foundry. A small injected dispatcher selects that bridge from the stored source
message and immutable test-session runtime. It does not execute the Python
Current adapter or the managed Copilot SDK. The conversation store is an
in-memory fixture, not SQL. All records, credentials and tool results are synthetic.

## Identical scenarios

| Scenario | Execution and assertions |
| --- | --- |
| Subscriber disconnect and replay | Create the selected test session through the application route. Start a real loopback HTTP turn and wait for its first delta. Abort the subscriber and wait for the server response to close. Release the controlled provider barrier and execute one synthetic read through the real tool dispatcher. The bridge request stays alive, the reply is stored, and two calls to the reattachment endpoint replay the completion. Exactly one bridge invocation, one read and one final reply exist. The normal-chat active-turn feed does not adopt the test turn. |
| Model interruption and new source | Wait until the first model stream is active, then post a steering message while it is pending. The old bridge signal aborts, its partial reply is stored as interrupted, and the replacement invocation uses the new stored Dan message ID with the original root turn ID. The stale source cannot dispatch a no-op computer action. The new source is resolved, but its Gmail-only instruction independently refuses computer fallback. Neither source executes the no-op action. Both invocations retain the same persisted runtime. |

The tests use promise barriers at active execution and server disconnect, not
arbitrary sleeps. The second scenario interrupts a pending stream; it is not two
ordinary sequential chat turns. The dispatcher refusal reasons distinguish a
stale source from a resolved source whose instruction forbids the attempted
fallback. No external action is attempted.

## Local results

On 29 October 2026, all four tests passed on Node 24.19.0/npm 11.9.0. Backend
lint and TypeScript build also passed. The repository pins Node 22/npm 10;
these local checks do not replace validation on that pinned toolchain.

CI 40864485219 subsequently exposed teardown timeouts on Node 22.23.3 after
both disconnect scenarios completed their assertions. The same failure was
reproduced locally on that exact Node version: each aborted fetch left one open
replacement socket with zero bytes read. The fixture now closes its HTTP
connections in `preClose`, after all recovery assertions, matching the existing
conversation test cleanup. All four tests pass on Node 22.23.3 with that cleanup;
neither the hook timeout nor the lifecycle assertions changed. The combined
lifecycle, conversation activity and shutdown checks pass all 15 tests on that
Node version, and scoped lint passes. Full exact-head CI requalification remains
required.

Commands from the repository root:

```sh
npm test --workspace @jarvis/backend -- src/core/runtime-lifecycle-comparison.test.ts
npm run lint --workspace @jarvis/backend
npm run build --workspace @jarvis/backend
```

## Integration and limits

The worktree starts from `4011ae6c`. The parent integration is moving test-history
exclusion to an explicit `getHistory({ excludeRuntimeTests: true })` option used
only by the unscoped UI history route. Internal history keeps the existing global
behavior, including test messages. This fixture follows that parent-approved
contract and also supports the explicit option when supplied. It adds no search,
recent-context or summary exclusion and does not decide pending product history
behavior. The test does not qualify SQL filtering or the unscoped UI route.

This base permits configured availability through the injected verification
callback. The parent integration additionally requires managed-runtime binding
before advertising Copilot availability. Its fixture setup must preserve that
requirement; this comparison does not establish it. The availability callback
here is a test dependency, not live verification.

No provider inference, Python subscription loop, managed SDK cancellation,
provider-side reconnect, SQL restart recovery, browser/mobile reconnect, approval
parity, settings support, cost or production readiness is proven. Completed
reattachment uses the application's retained in-memory transport; it does not
simulate an application process restart. Positive authorization for an external
write is deliberately outside these read/no-op scenarios. No production code,
UI behavior, publication or deployment changes belong to this test change.
