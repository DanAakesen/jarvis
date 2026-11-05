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
new cases attach Usage/Status/Proactive in da/en and light/dark, loading states,
shared row/heading examples, and sheet actions. They assert rendered positions
and controls, not that every button is circular. UI fixtures use process-local
memory caching so a previous test cannot replace a loading scenario with saved data.

Local checks: all 467 JarvisCore tests pass on Swift 6.2, including the new
localized count contract. All changed Swift sources pass parser checks.

Local Core tests and Swift parser checks do not establish SwiftUI compilation
or visual acceptance. No screenshot is labelled verified before it is inspected.

Apple guidance used:
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): consistent spacing and grouping; adapt across display sizes.
- [Loading](https://developer.apple.com/design/human-interface-guidelines/loading): show placeholders promptly and keep other actions available.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): Dynamic Type and accessible control labels.
