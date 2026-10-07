import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTaskWindows } from './task-windows';

/**
 * A link to a task that opens it as a window over the current page. Modified clicks (new tab, new window) and
 * shells without the window layer keep the plain route, which opens the window over Kanban.
 */
export function TaskWindowLink({ taskId, title, className, children, 'aria-label': ariaLabel }: {
  taskId: string;
  title?: string;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const windows = useTaskWindows();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!windows || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    windows.open(taskId, title);
  };
  return (
    <Link className={className} to={`/factory/tasks/${taskId}`} onClick={open} {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
      {children}
    </Link>
  );
}
