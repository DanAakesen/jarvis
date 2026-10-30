export type ShellIconName = 'home' | 'factory' | 'knowledge' | 'tasks' | 'notes_tree' | 'usage' | 'status' | 'navigation' | 'screen' | 'camera' | 'context' | 'settings' | 'close' | 'workspaces' | 'daily' | 'present' | 'away' | 'on_the_move' | 'running' | 'done' | 'failed' | 'idle' | 'attention' | 'chat' | 'health' | 'menu' | 'chevron' | 'sparkle';

export function ShellIcon({ name }: { name: ShellIconName }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'home':
      return <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></svg>;
    case 'factory':
      return <svg {...common}><path d="M3 21V9l6 3V8l6 4V5h6v16Z" /><path d="M7 17h1m4 0h1m4 0h1m-10-4h1m4 0h1m4-8h1" /></svg>;
    case 'knowledge':
      return <svg {...common}><circle cx="6" cy="7" r="2.2" /><circle cx="17.5" cy="5.5" r="1.8" /><circle cx="12.5" cy="13" r="2.4" /><circle cx="5.5" cy="18" r="1.7" /><circle cx="18.5" cy="18.5" r="2" /><path d="m8 8.3 2.6 3M15.9 6.6l-2.4 4.3M10.4 14.4l-3.4 2.6M14.6 14.4l2.5 2.6M7.9 6.7l7.8-1" /></svg>;
    case 'tasks':
      return <svg {...common}><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 8h8m-8 4h8m-8 4h5" /></svg>;
    case 'notes_tree':
      return <svg {...common}><rect x="4" y="3.5" width="5" height="4.5" rx="1" /><path d="M6.5 8v10M6.5 12H10M6.5 18H10" /><rect x="10" y="10" width="10" height="4" rx="1" /><rect x="10" y="16" width="10" height="4" rx="1" /></svg>;
    case 'usage':
      return <svg {...common}><path d="M4 20V11m5 9V5m5 15v-7m5 7V8" /><path d="M2 21h20" /></svg>;
    case 'status':
      return <svg {...common}><path d="M2 12h4l3-8 5 16 3-8h5" /></svg>;
    case 'daily':
      return <svg {...common}><path d="m6.5 6.5 11 11M3 7l4-4m-2 6 4-4m6 14 4-4m-2 6 4-4" /></svg>;
    case 'navigation':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m-3-11h1m-1 4h1" /></svg>;
    case 'screen':
      return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>;
    case 'camera':
      return <svg {...common}><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'context':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2A1.7 1.7 0 0 0 8 17.4l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 4.4 12H4.2a1.7 1.7 0 1 1 0-3.4h.2A1.7 1.7 0 0 0 5.6 5.7l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1A1.7 1.7 0 0 0 11 2.1v-.2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.5 3Z" /></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'workspaces':
      return <svg {...common}><rect x="7" y="3" width="13" height="15" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h10M11 8h5m-5 4h5" /></svg>;
    case 'present':
      return <svg {...common}><circle cx="12" cy="7" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg>;
    case 'away':
      return <svg {...common}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" /></svg>;
    case 'on_the_move':
      return <svg {...common}><circle cx="14" cy="4" r="2" /><path d="m7 21 4-7-2-5 4-2 3 5h4M3 11l6-2m2 5 5 3v4" /></svg>;
    case 'running':
      return <svg {...common}><path d="M12 3a9 9 0 1 1-9 9" /></svg>;
    case 'done':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case 'failed':
      return <svg {...common}><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3v.2" /></svg>;
    case 'idle':
      return <svg {...common}><path d="M4 4h16v16H4Z" /><path d="M4 14h5l2 3h2l2-3h5" /></svg>;
    case 'attention':
      return <svg {...common}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
    case 'chat':
      return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.5A7.5 7.5 0 1 1 20 11.5Z" /></svg>;
    case 'health':
      return <svg {...common}><path d="M20.8 8.7c0 5.1-8.8 11.1-8.8 11.1S3.2 13.8 3.2 8.7A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.8 2.3Z" /></svg>;
    case 'menu':
      return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
    case 'chevron':
      return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case 'sparkle':
      return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>;
  }
}
