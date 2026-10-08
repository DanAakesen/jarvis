/** Folio data (P9-25): item shape mirrored from packages/contracts on main, validation and grouping. */
export type FolioKind = 'research' | 'html_app' | 'image' | 'knowledge_graph';
export interface FolioItem { id: string; title: string; kind: FolioKind; createdAt: string; promptSummary: string; pinned: boolean }

export const folioKinds: readonly { kind: FolioKind; label: string }[] = [
  { kind: 'research', label: 'Reports' },
  { kind: 'html_app', label: 'Apps' },
  { kind: 'image', label: 'Images' },
  { kind: 'knowledge_graph', label: 'Graphs' },
];
const idPattern = /^(?:research|html_app|image|knowledge_graph):[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
export const folioPageSize = 100;

export function isFolioItem(value: unknown): value is FolioItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && idPattern.test(item.id) &&
    folioKinds.some(({ kind }) => kind === item.kind) && item.id.startsWith(`${String(item.kind)}:`) &&
    typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 200 &&
    typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)) &&
    typeof item.promptSummary === 'string' && item.promptSummary.length <= 500 && typeof item.pinned === 'boolean';
}

/** Pinned first, then by local day: Today, This week (the previous six days), Earlier. Newest first in each group. */
export function groupFolio(items: readonly FolioItem[], now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 86_400_000;
  const newest = (left: FolioItem, right: FolioItem) => Date.parse(right.createdAt) - Date.parse(left.createdAt);
  const groups: { label: string; items: FolioItem[] }[] = [
    { label: 'Pinned', items: [] }, { label: 'Today', items: [] }, { label: 'This week', items: [] }, { label: 'Earlier', items: [] },
  ];
  for (const item of [...items].sort(newest)) {
    const at = Date.parse(item.createdAt);
    groups[item.pinned ? 0 : at >= startOfToday ? 1 : at >= startOfWeek ? 2 : 3]!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}
