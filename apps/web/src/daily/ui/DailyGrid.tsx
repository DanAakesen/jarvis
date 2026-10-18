import type { ReactNode } from 'react';

export function DailyGrid({ children, columns = 'two', className = '' }: {
  children: ReactNode;
  columns?: 'two' | 'twelve';
  className?: string;
}) {
  return <div className={`daily-grid daily-grid--${columns}${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function DailyGridItem({ children, span = 1, className = '' }: {
  children: ReactNode;
  span?: number;
  className?: string;
}) {
  return <div className={`daily-grid-item daily-grid-item--${span}${className ? ` ${className}` : ''}`}>{children}</div>;
}
