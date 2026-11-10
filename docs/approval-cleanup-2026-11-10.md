## Owner approval cleanup — 10 November 2026

Dan directs Jarvis to execute authenticated, resolved owner requests without another approval, while preserving actual resource authorization, secret handling, duplicate protection and stale-write checks. Sign-out confirmation on the current device and all devices stays unchanged.

This branch is work in progress: it removes contradictory identity/project instructions, uses persisted owner messages in the same session for selected GitHub project follow-ups, removes selected iPhone/web confirmation dialogs and permits requested task recovery. The project-context, native UI, backend and end-to-end behavior have not yet been qualified or deployed. Remaining items from the owner's numbered inventory include intent-based sensitive capture, food logging, remaining UI/legacy approval paths, full tool catalogue and production checks. Do not claim the cleanup is complete based on this branch alone.

The separate Watch Factory/lift inputs handoff is PR #1698 and must be integrated with the previously released Watch steps/reconnect work and qualified on the combined source. Physical device acceptance remains pending.
