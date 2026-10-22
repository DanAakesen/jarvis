import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DailyHeadingSlotContext } from './heading-slot-context';

/** Renders its children in the title row of the Health page, or in place when the section is rendered without one. */
export function DailyHeadingControl({ children }: { children: ReactNode }) {
  const slot = useContext(DailyHeadingSlotContext);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
