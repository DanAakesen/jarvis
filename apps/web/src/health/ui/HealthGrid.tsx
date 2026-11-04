import type { ReactNode } from 'react';

export function HealthGrid({ children, columns = 'two', className = '' }: {
  children: ReactNode;
  columns?: 'two' | 'twelve';
  className?: string;
}) {
  return <div className={`health-grid health-grid--${columns}${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function HealthGridItem({ children, span = 1, className = '' }: {
  children: ReactNode;
  span?: number;
  className?: string;
}) {
  return <div className={`health-grid-item health-grid-item--${span}${className ? ` ${className}` : ''}`}>{children}</div>;
}
