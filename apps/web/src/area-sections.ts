import { createContext, useContext, useEffect } from 'react';

export interface AreaSection {
  id: string;
  label: string;
}

/** The pages inside one area, published by the area so the shell can list them in its navigation panel. */
export interface AreaSections {
  areaId: string;
  items: readonly AreaSection[];
  activeId: string | undefined;
}

export interface AreaSectionLink extends AreaSection {
  to: string;
  current: boolean;
}

export type PublishAreaSections = (sections: AreaSections | null) => void;

export const AreaSectionsContext = createContext<PublishAreaSections>(() => {});

/** Sections are addressed as `?section=<id>` on the area's own path. */
export function areaSectionLinks(areaPath: string, sections: AreaSections): AreaSectionLink[] {
  return sections.items.map(item => ({
    ...item,
    to: `/${areaPath}?section=${encodeURIComponent(item.id)}`,
    current: item.id === sections.activeId,
  }));
}

/** Lists an area's sections in the shell while it is mounted. Pass null while they are not known yet. */
export function usePublishAreaSections(sections: AreaSections | null) {
  const publish = useContext(AreaSectionsContext);
  useEffect(() => {
    publish(sections);
    return () => publish(null);
  }, [publish, sections]);
}
