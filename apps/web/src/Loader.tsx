import type { CSSProperties } from 'react';
import { InputOrbCore } from './InputOrbCore';
import { LivePhrase } from './ToolCallChip';

export type LoaderVariant = 'core' | 'lines' | 'rows' | 'cards' | 'panel' | 'image' | 'stars' | 'inline';

// Fixed, scattered positions so the star placeholder looks the same on every load.
const stars = Array.from({ length: 26 }, (_, index) => ({
  x: (index * 41 + 7) % 92 + 4,
  y: (index * 67 + 13) % 84 + 8,
  size: 3 + (index % 4),
}));

/**
 * Loading (Dan, 7–8 October). `core` is the orb's amber brain lighting up, with a rotating phrase under it; it is the
 * default for a page or window loading. Sections inside a page load lazily: the frame is already there and the area shows a
 * glass placeholder in the shape of what is coming, with a slow light passing over it. The label is for screen readers only; inside an element that already
 * announces status, pass `announce={false}`.
 */
export function Loader({ label, variant = 'lines', size = 'block', announce = true, className }: {
  label: string;
  variant?: LoaderVariant;
  /** Only for `core`: centred in the content area, or inline in a line of text. */
  size?: 'block' | 'inline';
  announce?: boolean;
  className?: string;
}) {
  const status = announce ? { role: 'status', 'aria-live': 'polite' as const } : {};
  const extra = className ? ` ${className}` : '';
  const hidden = <span className="visually-hidden">{label}</span>;
  if (variant === 'core') {
    // The status lives on the hidden label only, so the rotating phrase is never read out or counted as status text.
    return (
      <span className={`loader loader-${size}${extra}`}>
        <span className="loader-core" aria-hidden="true"><InputOrbCore variant="core" active /></span>
        {size === 'block' && <span className="loader-phrase"><LivePhrase phase="loading" /></span>}
        <span className="visually-hidden" {...status}>{label}</span>
      </span>
    );
  }
  const bar = (width: string, key: string | number, modifier = '', index?: number) => (
    <span key={key} className={`skeleton-bar${modifier}`} aria-hidden="true"
      style={{ '--w': width, ...(index === undefined ? {} : { '--i': index }) } as CSSProperties} />
  );
  return (
    <span className={`skeleton skeleton-${variant}${extra}`} {...status}>
      {hidden}
      {variant === 'inline' && bar('100%', 'bar')}
      {variant === 'lines' && ['92%', '78%', '85%', '60%'].map((width, index) => bar(width, index, '', index))}
      {variant === 'rows' && Array.from({ length: 4 }, (_, index) => (
        <span key={index} className="skeleton-row" aria-hidden="true">
          <span className="skeleton-dot" />{bar(`${68 - (index % 3) * 12}%`, 'line', '', index)}
        </span>
      ))}
      {variant === 'cards' && Array.from({ length: 4 }, (_, column) => (
        <span key={column} className="skeleton-column" aria-hidden="true">
          {bar('46%', 'head', ' skeleton-bar-head', column)}
          {Array.from({ length: 3 - (column % 2) }, (_, card) => (
            <span key={card} className="skeleton-card">
              {bar('84%', 'a', '', column + card)}{bar('58%', 'b', '', column + card)}{bar('36%', 'c', '', column + card)}
            </span>
          ))}
        </span>
      ))}
      {variant === 'panel' && (
        <>
          {bar('55%', 'title', ' skeleton-bar-head', 0)}
          <span className="skeleton-grid" aria-hidden="true">
            {['70%', '50%', '64%', '44%', '58%', '40%'].map((width, index) => bar(width, index, '', 1 + (index % 2)))}
          </span>
          <span className="skeleton-slab" aria-hidden="true" />
        </>
      )}
      {variant === 'image' && <span className="skeleton-slab" aria-hidden="true" />}
      {variant === 'stars' && stars.map((star, index) => (
        <span key={index} className="skeleton-star" aria-hidden="true"
          style={{ '--x': `${star.x}%`, '--y': `${star.y}%`, '--s': `${star.size}px`, '--i': index } as CSSProperties} />
      ))}
    </span>
  );
}