import { formatNumber } from './formatters';

export function Meter({ label, value, target, unit, partial = false, unknownLabel = 'Value unknown', partialLabel = 'Partial value' }: {
  label: string;
  value: number | null | undefined;
  target: number | null | undefined;
  unit?: string;
  partial?: boolean;
  unknownLabel?: string;
  partialLabel?: string;
}) {
  const knownValue = typeof value === 'number' && Number.isFinite(value);
  const knownTarget = typeof target === 'number' && Number.isFinite(target);
  const progressValue = knownValue && value >= 0;
  const progressTarget = knownTarget && target >= 0;
  const ratio = progressValue && progressTarget
    ? target === 0 ? (value === 0 ? 1 : 0) : Math.min(1, Math.max(0, value / target))
    : 0;
  const valueText = knownValue ? `${formatNumber(value)}${unit ? ` ${unit}` : ''}` : unknownLabel;
  const targetText = knownTarget ? `${formatNumber(target)}${unit ? ` ${unit}` : ''}` : 'Target not set';
  return <div className="daily-meter">
    <p className="daily-meter-label">{label}</p>
    {progressValue && progressTarget
      ? <div className="daily-meter-track" role="progressbar" aria-label={label} aria-valuemin={0}
        aria-valuemax={target} aria-valuenow={Math.min(target, Math.max(0, value))}
        aria-valuetext={`${valueText}${partial ? ' (lower bound)' : ''} of ${targetText}`}>
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      : <div className="daily-meter-track daily-meter-track--unknown" aria-hidden="true"><span /></div>}
    <p className="daily-meter-values">
      <span className="daily-meter-value"><span>{valueText}</span>{partial && <> <span className="daily-meter-note">{partialLabel}</span></>}</span><span>{targetText}</span>
    </p>
  </div>;
}
