import { Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dailyQuerySources, type DailySourceId } from '@jarvis/contracts';
import { usePublishAreaSections, type AreaSections } from '../area-sections';
import type { AreaProps } from '../areas';
import { Loader } from '../Loader';
import { DailyFreshnessPill } from './DailyFreshnessPill';
import { DailyPeriodControl } from './DailyPeriodControl';
import { initialDailyPeriodForShell } from './period';
import { DailyRefreshContext } from './refresh';
import { DailySectionNavigationContext } from './section-navigation';
import { discoverDailySections, loadDailySectionModules } from './sections/discovery';
import type { DailyPeriod, DailySectionDefinition } from './sections/types';
import { TrainingTargetsProvider } from './TrainingTargetsProvider';
import { useDailyCapabilities } from './useDailyCapabilities';
import './health-look.css';
import './health-look-sections.css';
import './daily.css';
import './ui/daily-ui.css';

const sectionModules = import.meta.glob<{ section: DailySectionDefinition }>('./sections/*/index.tsx');
const noSources: readonly DailySourceId[] = [];

export function DailyHome({ backendUrl, getAccessToken }: AreaProps) {
  const capabilities = useDailyCapabilities(backendUrl, getAccessToken);
  const refreshVersion = useContext(DailyRefreshContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('section') ?? 'overview';
  const [period, setPeriod] = useState<DailyPeriod>(initialDailyPeriodForShell);
  const [initialSource, setInitialSource] = useState<DailySourceId>();
  const [periodSlotHeight, setPeriodSlotHeight] = useState(70);
  const periodSlot = useRef<HTMLDivElement>(null);
  const [sectionLoadAttempt, setSectionLoadAttempt] = useState(0);
  const [loadedSections, setLoadedSections] = useState<{
    attempt: number;
    modules?: Record<string, { section: DailySectionDefinition }>;
    error?: boolean;
  }>({ attempt: -1 });
  const sources = capabilities.sources ?? noSources;
  const modules = loadedSections.attempt === sectionLoadAttempt ? loadedSections.modules : undefined;
  const sectionLoadError = loadedSections.attempt === sectionLoadAttempt && loadedSections.error === true;
  const availableSections = useMemo(() => modules ? discoverDailySections(modules, sources) : [], [modules, sources]);
  const activeSection = availableSections.find(item => item.id === activeId) ?? availableSections[0];
  const activeSectionId = activeSection?.id;
  const availabilityPending = capabilities.sources === undefined && capabilities.error === undefined;

  // The pages are listed in the shell's navigation panel. Until availability and the section modules are known the
  // list is not final, so nothing is published and the panel shows a loader instead of a list that then changes.
  const published = useMemo<AreaSections | null>(() => {
    if (sectionLoadError) return { areaId: 'daily', items: [], activeId: undefined };
    if (!modules || availabilityPending) return null;
    return { areaId: 'daily', items: availableSections.map(({ id, label }) => ({ id, label })), activeId: activeSectionId };
  }, [sectionLoadError, modules, availabilityPending, availableSections, activeSectionId]);
  usePublishAreaSections(published);

  useEffect(() => {
    let active = true;
    void loadDailySectionModules(sectionModules).then(
      loaded => { if (active) setLoadedSections({ attempt: sectionLoadAttempt, modules: loaded }); },
      () => { if (active) setLoadedSections({ attempt: sectionLoadAttempt, error: true }); },
    );
    return () => { active = false; };
  }, [sectionLoadAttempt]);

  useEffect(() => {
    const element = periodSlot.current;
    if (!activeSection?.usesPeriod || !element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPeriodSlotHeight(height => Math.max(height, Math.ceil(entry.contentRect.height)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeSection?.id, activeSection?.usesPeriod]);

  const setSection = (id: string, replace = false) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('section', id);
      return next;
    }, { replace });
  };

  const selectSection = (id: string) => {
    setSection(id);
  };

  const openSource = (source: DailySourceId) => {
    setInitialSource(source);
    setSection('data');
    document.getElementById('daily-heading')?.focus({ preventScroll: true });
  };

  const backToOverview = () => {
    selectSection('overview');
  };

  const navigation = {
    openSource,
    backToOverview,
    initialSource,
    onSourceChange: setInitialSource,
    availabilityError: capabilities.error,
    availabilityPending,
    retryAvailability: capabilities.reload,
  };

  return <section className="daily-page daily-shell" aria-label="Health">
    <header className="daily-heading">
      <h1 id="daily-heading" tabIndex={-1}>{activeSection?.label ?? 'Health'}</h1>
      <DailyFreshnessPill backendUrl={backendUrl} getAccessToken={getAccessToken} refreshVersion={refreshVersion}
        enabled={sources.includes(dailyQuerySources.sync)} />
    </header>
    {activeSection?.id !== 'body-sleep' && activeSection?.usesPeriod && <div ref={periodSlot} className="daily-period-slot" style={{ minHeight: periodSlotHeight }}>
      <DailyPeriodControl period={period} onPeriodChange={setPeriod} />
    </div>}
    <DailySectionNavigationContext.Provider value={navigation}>
      <TrainingTargetsProvider backendUrl={backendUrl} getAccessToken={getAccessToken}>
        <div className="daily-section-panel" key={activeSection?.id}>
          {!activeSection && sectionLoadError && <div className="daily-notice" role="alert">
            <p>Sections unavailable.</p>
            <button className="secondary-button" type="button" onClick={() => setSectionLoadAttempt(attempt => attempt + 1)}>Retry sections</button>
          </div>}
          {!activeSection && !sectionLoadError && <Loader
            label={navigation.availabilityPending ? 'Checking Health availability' : 'Loading Health sections'} variant="rows" />}
          {activeSection && navigation.availabilityPending && <Loader label="Checking Health availability" variant="rows" />}
          {activeSection && !navigation.availabilityPending && <Suspense fallback={<Loader label={`Loading ${activeSection.label}`} variant="rows" />}>
            <activeSection.Component backendUrl={backendUrl} getAccessToken={getAccessToken} sources={sources}
              period={period} onPeriodChange={setPeriod} refreshVersion={refreshVersion} />
          </Suspense>}
        </div>
      </TrainingTargetsProvider>
    </DailySectionNavigationContext.Provider>
  </section>;
}
