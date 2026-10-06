import { isGeneratedView, type GeneratedView } from '@jarvis/contracts';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

function ViewAction({ view, title }: { view: GeneratedView; title: string }) {
  const action = view.actions?.find((candidate) => candidate.type === 'open-route' || candidate.type === 'open-link');
  if (!action) return <span>{title}</span>;
  if (action.type === 'open-route') return <Link className="activity-title" to={action.route}>{title}</Link>;
  return <a className="activity-title" href={action.url} rel="noreferrer" target="_blank">{title}</a>;
}

export function GeneratedViewRenderer({
  view,
  className,
  trustedBlobHost,
}: {
  view: GeneratedView;
  className?: string;
  trustedBlobHost?: string;
}) {
  if (!isGeneratedView(view, trustedBlobHost ? { trustedBlobHost } : undefined)) {
    return <p role="alert">This generated view is invalid.</p>;
  }

  switch (view.renderer) {
    case 'table':
      return (
        <div className="generated-view-table">
          <table aria-label={view.title}>
            <thead><tr>{view.data.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>
              {view.data.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell === null ? '—' : String(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'list':
      return (
        <ul className={className}>
          {view.data.items.map((item, index) => (
            <li key={`${item.title}-${index}`}>
              {item.action?.type === 'open-route'
                ? <Link className="activity-title" to={item.action.route}>{item.title}</Link>
                : item.action?.type === 'open-link'
                  ? <a className="activity-title" href={item.action.url} rel="noreferrer" target="_blank">{item.title}</a>
                  : <span className="activity-title">{item.title}</span>}
              {item.description && <p>{item.description}</p>}
              {item.details && (
                <dl className="activity-meta">
                  {item.details.map(({ label, value }, detailIndex) => (
                    <Fragment key={`${label}-${detailIndex}`}><dt>{label}</dt><dd>{value}</dd></Fragment>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      );
    case 'detail':
      return (
        <dl className="generated-view-details">
          {view.data.fields.map(({ label, value }, index) => (
            <Fragment key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></Fragment>
          ))}
        </dl>
      );
    case 'text':
      return <p className="generated-view-text">{view.data.content}</p>;
    case 'timeline':
      return (
        <ol className="generated-view-timeline">
          {view.data.events.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <time dateTime={event.at}>{event.at}</time>
              <strong>{event.title}</strong>
              {event.description && <p>{event.description}</p>}
            </li>
          ))}
        </ol>
      );
    case 'chart':
      return (
        <div className="generated-view-table">
          <table aria-label={`${view.title} ${view.data.kind} chart data`}>
            <thead><tr><th scope="col">Series</th><th scope="col">Point</th><th scope="col">X</th><th scope="col">Y</th></tr></thead>
            <tbody>
              {view.data.series.flatMap((series) => series.points.map((point, index) => (
                <tr key={`${series.name}-${index}`}>
                  <th scope="row">{series.name}</th><td>{index + 1}</td><td>{point.x}</td><td>{point.y}</td>
                </tr>
              )))}
            </tbody>
          </table>
          <p>Chart: {view.data.kind}. Values are shown as a table.</p>
        </div>
      );
    case 'task-card':
      return (
        <dl className="generated-view-details">
          <dt>Task</dt><dd><ViewAction view={view} title={view.data.title} /></dd>
          <dt>ID</dt><dd>{view.data.id}</dd>
          <dt>State</dt><dd>{view.data.state}</dd>
          {view.data.summary && <><dt>Summary</dt><dd>{view.data.summary}</dd></>}
        </dl>
      );
    case 'status':
      return <p>{view.data.label}: {view.data.value ?? 'No value'} ({view.data.state})</p>;
    case 'image':
      return (
        <div className="generated-view-images">
          {view.data.images.map((image, index) => (
            <figure key={`${image.url}-${index}`}>
              <img src={image.url} alt={image.alt} referrerPolicy="no-referrer" loading="lazy" />
              <figcaption>{image.alt}</figcaption>
            </figure>
          ))}
        </div>
      );
  }
}
