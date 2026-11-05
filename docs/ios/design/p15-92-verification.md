# P15-92 shared page verification

Reference: `board.html` at main commit `2522aca2` (PR #1603). The board's values
are approved illustrative data. App screenshots use deterministic native test
fixtures; differing values must not be scored as layout defects.

| Page | Shared change | Native screenshot status |
| --- | --- | --- |
| Usage | Hero contains period control; no initial filters; shared section headlines and task rows | Pending Mac run |
| Status | Summary hero before All/Issues; separated rows | Pending Mac run |
| Proactive | Summary/next-check hero before Open/Earlier; separated rows and section headlines | Pending Mac run |
| Notes | Shared initial skeleton without tabs or filters | Pending Mac run; folder redesign belongs to #1599 |
| Health | Shared initial skeleton and section headlines | Pending Mac run; carousel/data work belongs to #1601 |
| Factory | Segments above bottom search, below scrolling hero/content; shared skeleton | Pending Mac run; tab/content changes belong to #1600 |
| Notifications | Transparent pinned header; existing phrase/hero; shared initial skeleton | Pending Mac run |
| Workspaces | Phrase and current-view hero before kind filters; shared headings/skeleton | Pending Mac run; separate older `workspaces.html` reference |
| Sheets | Shared confirm left, cancel right | Pending bilingual geometry test |

`ComponentGalleryUITests` is already selected by the existing Mac workflow. The
new cases attach Usage/Status/Proactive in da/en and light/dark, Workspaces in
English dark/Danish light, loading states, shared row/heading examples, and sheet
actions. They assert rendered positions
and controls, not that every button is circular. UI fixtures use process-local
memory caching so a previous test cannot replace a loading scenario with saved data.

Local checks: all 468 JarvisCore tests pass on Swift 6.2, including the new
localized count contract. All changed Swift sources pass parser checks.

Local Core tests and Swift parser checks do not establish SwiftUI compilation
or visual acceptance. No screenshot is labelled verified before it is inspected.

Apple guidance used:
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): consistent spacing and grouping; adapt across display sizes.
- [Loading](https://developer.apple.com/design/human-interface-guidelines/loading): show placeholders promptly and keep other actions available.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): Dynamic Type and accessible control labels.

First Mac attempt (run 42075005655, commit 84219890) caught an extension target
boundary: the page skeleton was placed in the loading file also compiled by the
Voice Activity target. The skeleton now lives with the app page components, and
a Core source guard prevents shared controls/loading from depending on those
app-only types.

Second Mac attempt (run 42075818100, commit 7bfef3db): native compilation, CI
and CodeQL passed. The iPhone 17 Pro UI suite completed 42 tests in 967.6 seconds:
41 passed, including shared loading, row spacing/actions, bilingual sheet order,
sidebar navigation and Home tests. The new page-order test failed on its first
Usage capture because its `staticTexts` lookup did not find `page.headline`.
The follow-up uses the identifier across accessibility element types, retains the
position assertions, and captures evidence before those assertions. This fix is
not verified on a native run yet.

The job exceeded its 45-minute limit later, during the existing screenshot
sequence. Logs show that it had already written Health and Factory captures.
The screenshot upload step did not run after cancellation. The 143 MB xcresult
archive survived as artifact 13442092604; the cloud environment currently blocks
the OpenAI file-download host returned by the GitHub connector, so its frames
have not been inspected. No board/native comparison is accepted yet.

Prepared follow-up layout corrections place Usage's amount beside its chart,
remove Proactive's extra hero title, use three equal-width Proactive statistics,
and keep the Workspaces hero out of a second List-row glass surface. These are
source-reviewed against the rendered board; native comparison is still pending.
