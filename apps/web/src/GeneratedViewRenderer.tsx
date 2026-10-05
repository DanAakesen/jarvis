import { isGeneratedView, type GeneratedView } from '@jarvis/contracts';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

type ListView = Extract<GeneratedView, { renderer: 'list' }>;

export function GeneratedViewRenderer({ view, className }: { view: ListView; className?: string }) {
  if (!isGeneratedView(view)) return <p role="alert">This generated view is invalid.</p>;

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
              {item.details.map(({ label, value }) => (
                <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
