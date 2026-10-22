import { createContext } from 'react';

/**
 * Where a Health section may put a control that belongs to the page title, at the end of the title row. `undefined` means
 * there is no title row (the section is rendered on its own), `null` that the row is not mounted yet.
 */
export const DailyHeadingSlotContext = createContext<HTMLElement | null | undefined>(undefined);
