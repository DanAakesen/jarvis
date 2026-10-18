# Proactive assistance

Status: **Decided; in build, off by default** (17 October 2026).

The decisions below define the intended behaviour. Each feature stays off until
its own enabling change follows acceptance of the previous deployment. A push
provider accepting a notification is not proof that an iPhone displayed it.

## Decided

- Push is the only delivery path; Teams is not used ([decision](decisions.md#keep-the-first-web-push-proof-dark-and-user-triggered-17-october-2026-p13-01-917)).
- Checks run at 07:00 and 18:00 Europe/Copenhagen, and Dan can request “Check now” at any time; an in-process loop claims each scheduled slot atomically ([decision](decisions.md)).
- No proactive work or delivery runs from 22:00 to 07:00 Europe/Copenhagen, including for manual checks, with no emergency exception; output follows the language of Dan's last chat message ([decision](decisions.md)).
- Todos, Factory, weather, calendar, mail headers, calendar-derived travel and news are read-only sources; their content is untrusted data, never instructions, and system runs inherit no approvals ([decision](decisions.md)).
- Estimated spend has a hard limit of 100 DKK per Copenhagen month and a warning at 80%; it is labelled as an estimate ([decision](decisions.md)).
- The vault todo file is canonical; Jarvis may add todos under its own heading but never edits, completes, reorders or deletes existing todos ([decision](decisions.md)).
- Push alerts cover only a deadline within 24 hours, a calendar clash or a travel disruption, plus a reminder about an hour before a todo is due; quiet-hour reminders wait until 07:00, with one bundled push per run and daily caps ([decision](decisions.md)).
- Every scheduled or manual run appears in the header Background work popover as running, then done or failed ([decision](decisions.md)).
- Each milestone has its own exact-`true`, default-off switch; enable push, then checks, then todo writes and alerts/reminders, only after the prior deployment is accepted ([decision](decisions.md)).

## Open

- The todo filename is unsettled (`task.md` or `Tasks.md`); the resolver accepts exactly one case-insensitive root match and never guesses.
- The travel-disruption provider and key are undecided; travel remains a “no provider” placeholder until Dan chooses one.
- **Unverified:** real-device iPhone delivery needs Dan's phone and the installed Home Screen app.

## Build plan

This table is the task-ID-to-issue mapping for proactive assistance and its
follow-up UI work.

| ID | Issue | What it delivers | Depends on |
| --- | --- | --- | --- |
| P13-01 | [#917](https://github.com/DanAakesen/jarvis/issues/917) | Push delivery proof, backend (merged, deployed) | none |
| P13-02 | [#919](https://github.com/DanAakesen/jarvis/issues/919) | Push delivery proof, web (merged, deployed) | none |
| P13-03 | [#934](https://github.com/DanAakesen/jarvis/issues/934) | Enable web push (infrastructure and web build flag) | P13-01, P13-02 |
| P13-04 | [#939](https://github.com/DanAakesen/jarvis/issues/939) | Record the decisions and the plan (docs only) | none |
| P13-05 | [#924](https://github.com/DanAakesen/jarvis/issues/924) | Proactive foundation: flags, settings, findings store, status route, time and language helpers | P13-01, P13-02 |
| P13-06 | [#926](https://github.com/DanAakesen/jarvis/issues/926) | Engine: scheduler, run pipeline, detection, budget, job visibility | P13-05 |
| P13-07 | [#927](https://github.com/DanAakesen/jarvis/issues/927) | Sources: todo file, Factory, weather | P13-05 |
| P13-08 | [#928](https://github.com/DanAakesen/jarvis/issues/928) | Sources: calendar, mail, travel | P13-05 |
| P13-09 | [#929](https://github.com/DanAakesen/jarvis/issues/929) | Source: news | P13-05 |
| P13-10 | [#930](https://github.com/DanAakesen/jarvis/issues/930) | Web: Proactive page, Settings section, Background work entries | P13-05 |
| P13-11 | [#931](https://github.com/DanAakesen/jarvis/issues/931) | Todo writer: add-only suggested todos | P13-05, P13-06, P13-07 |
| P13-12 | [#932](https://github.com/DanAakesen/jarvis/issues/932) | Run alerts: time-critical push with a shared sender | P13-01, P13-02, P13-05, P13-06 |
| P13-13 | [#933](https://github.com/DanAakesen/jarvis/issues/933) | Todo reminders, one hour before due | P13-12, P13-06, P13-07, P13-05 |
| P13-14 | [#935](https://github.com/DanAakesen/jarvis/issues/935) | Enable proactive checks | P13-03, P13-05 to P13-10 |
| P13-15 | [#936](https://github.com/DanAakesen/jarvis/issues/936) | Enable suggested todos, alerts and reminders | P13-11 to P13-14 |
| P13-16 | [#937](https://github.com/DanAakesen/jarvis/issues/937) | Chat and voice recall of proactive findings | P13-05, P13-06, P13-10 |
| P14-01 | [#938](https://github.com/DanAakesen/jarvis/issues/938) | Unify UI styles and add small refinements | Other in-flight web pull requests: Daily page, Proactive page and Settings section, attention icon, per-project policy control |

## Unverified and out of scope

- **Unverified:** Foundry Routines availability and integration, and Foundry Memory preview features; neither is selected.
- **Out of scope:** Telephony.
