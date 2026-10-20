import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { dailyQuerySources as sources, type DailyJson, type DailySourceId } from '@jarvis/contracts';
import { dailyColumns, dailyRowKey, isNumericColumn, readable, type Row } from '../../presentation';
import { ScrollTable } from '../../ui/ScrollTable';
import { formatDate, formatNumber, formatTime } from '../../ui/formatters';
import './data.css';

function subscribe(onChange: () => void) {
  const media = window.matchMedia('(width < 700px)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function phoneSnapshot() { return window.matchMedia?.('(width < 700px)').matches ?? false; }
function serverSnapshot() { return false; }

function recordValue(source: DailySourceId, field: string, value: DailyJson | undefined): string {
  if (value == null) return 'Not recorded';
  if (typeof value === 'number') return formatNumber(value, 3);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    // Brief timestamps have no inferred timezone; preserve the stored text.
    if (source === sources.briefs || source === sources.brief) return value;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return Number.isFinite(Date.parse(value)) ? formatDate(value) : 'Unknown';
    if (/^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))) return formatTime(value);
    return field === 'metric_name' ? readable(value) : value || 'Empty text';
  }
  if (Array.isArray(value)) return value.length ? value.map(item => recordValue(source, field, item)).join(', ') : 'None';
  return Object.entries(value).map(([key, item]) => `${readable(key)}: ${recordValue(source, key, item)}`).join('; ');
}

function fieldUnit(source: DailySourceId, field: string, row: Row, units: Readonly<Record<string, string>>) {
  const declared = units[field] ?? Object.entries(units).find(([key]) => key.startsWith('*_') && field.endsWith(key.slice(1)))?.[1];
  return dailyColumns(source).find(column => column.key === field)?.unit ?? (declared?.includes(' ') ? undefined : declared) ??
    (['value', 'avg_value', 'min_value', 'max_value'].includes(field) && typeof row.unit === 'string' ? row.unit : undefined);
}

export function RecordFields({ source, row, units = {} }: {
  source: DailySourceId; row: Row; units?: Readonly<Record<string, string>>;
}) {
  return <dl className="daily-facts daily-record-fields">{Object.entries(row).map(([field, value]) => {
    const unit = fieldUnit(source, field, row, units);
    return <div key={field}>
      <dt>{dailyColumns(source).find(column => column.key === field)?.label ?? readable(field)}{unit ? ` (${unit})` : ''}</dt>
      <dd>{value !== null && typeof value === 'object' && !Array.isArray(value)
        ? <RecordFields source={source} row={value} units={units} />
        : recordValue(source, field, value)}</dd>
    </div>;
  })}</dl>;
}

export function DataRecords({ source, rows, units = {}, onOpenRecord, openLabel }: {
  source: DailySourceId; rows: readonly Row[]; units?: Readonly<Record<string, string>>;
  onOpenRecord?: (id: string) => void; openLabel?: string;
}) {
  const phone = useSyncExternalStore(typeof window.matchMedia === 'function' ? subscribe : () => () => {}, phoneSnapshot, serverSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const records = useRef<HTMLDivElement>(null);
  const id = useId();
  const columns = dailyColumns(source);
  const numericColumns = new Set(columns.filter(column => isNumericColumn(column) || rows.some(row => typeof row[column.key] === 'number'))
    .map(column => column.key));
  const occurrences = new Map<string, number>();
  const keys = rows.map((row, index) => {
    const base = source === sources.metrics ? JSON.stringify([source, row.metric_date, row.metric_name, row.unit]) :
      source === sources.metricCatalog ? JSON.stringify([source, row.metric_name]) :
        source === sources.days ? JSON.stringify([source, row.meal_date]) : dailyRowKey(row, source, index);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  });
  const selectedIndex = selected === null ? -1 : keys.indexOf(selected);
  const active = rows[selectedIndex];
  useEffect(() => {
    if (selected === null) return;
    const container = records.current;
    return () => {
      if (container?.isConnected && document.activeElement === document.body) container.focus();
    };
  }, [selected]);
  if (selected !== null && selectedIndex === -1) setSelected(null);
  const label = (row: Row) => recordValue(source, columns[0]!.key, row[columns[0]!.key]);
  const rowLabel = (row: Row, index: number) => rows.filter(item => label(item) === label(row)).length > 1
    ? `${label(row)}, record ${index + 1}` : label(row);
  const close = () => {
    const opener = document.getElementById(`${id}-${selectedIndex}`);
    setSelected(null);
    opener?.focus();
  };
  const details = (row: Row, index: number) => <button id={`${id}-${index}`} className="secondary-button" type="button"
    aria-expanded={selected === keys[index]} aria-controls={`${id}-detail`} onClick={() => {
      setSelected(keys[index]!);
      requestAnimationFrame(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView?.({ block: 'start' }); });
    }}>Details for {rowLabel(row, index)}</button>;
  const value = (row: Row, field: string) => <>
    {recordValue(source, field, row[field])}
    {(field === 'meal_name' || field === 'plan_name') && row.deleted_at != null && <span className="daily-deleted">Deleted record</span>}
  </>;
  return <div className="daily-data-records" ref={records} role="group" aria-label="Health records" tabIndex={-1}>
    {phone ? <ul className="daily-record-cards" aria-label="Health records">{rows.map((row, index) =>
      <li key={keys[index]}>
        <h3>{value(row, columns[0]!.key)}</h3>
        <p className="daily-record-summary">{columns.slice(1, 3).map(column => {
          const unit = fieldUnit(source, column.key, row, units);
          return <span key={column.key}>{column.label}: {value(row, column.key)}{unit ? ` ${unit}` : ''}</span>;
        })}</p>
        <dl className="daily-facts">{columns.slice(3).map(column => {
          const unit = fieldUnit(source, column.key, row, units);
          return <div key={column.key}><dt>{column.label}{unit ? ` (${unit})` : ''}</dt><dd>{value(row, column.key)}</dd></div>;
        })}</dl>
        {details(row, index)}
      </li>)}</ul> :
      <ScrollTable label="Health record table" stickyFirstColumn>
        <table>
          <caption className="visually-hidden">Recorded Health values; unknown values are not zero</caption>
          <thead><tr>{columns.map(column => {
            const unit = fieldUnit(source, column.key, {}, units);
            return <th scope="col" key={column.key} className={numericColumns.has(column.key) ? 'daily-record-number' : undefined}>
              {column.label}{unit ? ` (${unit})` : ''}</th>;
          })}<th scope="col">Details</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={keys[index]}>
            {columns.map((column, columnIndex) => {
              const cell = <span className="daily-record-cell">{value(row, column.key)}</span>;
              const className = numericColumns.has(column.key) ? 'daily-record-number' : undefined;
              return columnIndex === 0
                ? <th key={column.key} scope="row"
                  className={`daily-record-row-header${className ? ` ${className}` : ''}`}>{cell}</th>
                : <td key={column.key} className={className}>{cell}</td>;
            })}
            <td>{details(row, index)}</td>
          </tr>)}</tbody>
        </table>
      </ScrollTable>}
    <section id={`${id}-detail`} ref={panel} className="daily-record-panel" role="region"
      aria-labelledby={`${id}-title`} tabIndex={-1} hidden={!active}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="daily-record-panel-heading">
        <h3 id={`${id}-title`}>{active ? `Details for ${rowLabel(active, selectedIndex)}` : 'Record details'}</h3>
        {active && <button className="secondary-button" type="button" onClick={close}>Close details</button>}
      </div>
      {active && <>
        <RecordFields source={source} row={active} units={units} />
        {onOpenRecord && typeof active.id === 'string' && active.id.length > 0 &&
          <button className="secondary-button" type="button" onClick={() => onOpenRecord(active.id as string)}>{openLabel}</button>}
        <details><summary>Raw record</summary><pre>{JSON.stringify(active, null, 2)}</pre></details>
      </>}
    </section>
  </div>;
}
