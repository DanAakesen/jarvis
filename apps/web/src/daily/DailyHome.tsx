import { Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailySourceId } from '@jarvis/contracts';
import type { AreaProps } from '../areas';
import { Loader } from '../Loader';
import { DailyPeriodControl } from './DailyPeriodControl';
import { initialDailyPeriodForShell } from './period';
import { DailyRefreshContext } from './refresh';
import { DailySectionNavigationContext } from './section-navigation';
import { discoverDailySections, loadDailySectionModules } from './sections/discovery';
import type { DailyPeriod, DailySectionDefinition } from './sections/types';
import { useDailyCapabilities } from './useDailyCapabilities';
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
  const sectionNavigation = useRef<HTMLElement>(null);
  const [sectionTabsEdges, setSectionTabsEdges] = useState({ start: false, end: false });
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
  const tabStripPositioned = useRef(false);

  // Centre the selected tab by scrolling the strip only: the page's own scroll position must not move.
  // Until availability settles the tab set is still changing, so those moves are instant.
  useLayoutEffect(() => {
    const strip = sectionNavigation.current;
    const tab = activeSectionId ? document.getElementById(`daily-tab-${activeSectionId}`) : null;
    if (!strip || !tab || typeof strip.scrollTo !== 'function') return;
    const reduced = document.documentElement.dataset.motion === 'reduced'
      || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const left = Math.max(0, tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2);
    strip.scrollTo({ left, behavior: tabStripPositioned.current && !reduced ? 'smooth' : 'auto' });
    tabStripPositioned.current = !availabilityPending;
  }, [activeSectionId, availabilityPending]);

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

  useEffect(() => {
    const navigation = sectionNavigation.current;
    if (!navigation) return;
    const measure = () => {
      const offset = Math.abs(navigation.scrollLeft);
      const start = offset > 1;
      const end = navigation.scrollWidth - navigation.clientWidth - offset > 1;
      setSectionTabsEdges(previous => previous.start === start && previous.end === end ? previous : { start, end });
    };
    measure();
    navigation.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(navigation);
    if (navigation.firstElementChild) observer?.observe(navigation.firstElementChild);
    return () => {
      navigation.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [availableSections.length]);

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

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!activeSection || availableSections.length === 0) return;
    const current = availableSections.findIndex(item => item.id === activeSection.id);
    let index: number | undefined;
    if (event.key === 'ArrowRight') index = (current + 1) % availableSections.length;
    if (event.key === 'ArrowLeft') index = (current - 1 + availableSections.length) % availableSections.length;
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = availableSections.length - 1;
    if (index !== undefined) {
      event.preventDefault();
      const section = availableSections[index]!;
      selectSection(section.id);
      document.getElementById(`daily-tab-${section.id}`)?.focus();
    }
  }

  return <section className="daily-page daily-shell" aria-labelledby="daily-heading">
    <header className="daily-heading">
      <div>
        <h1 id="daily-heading" tabIndex={-1}>Daily</h1>
      </div>
    </header>
    <nav ref={sectionNavigation} className="daily-section-nav" aria-label="Daily sections"
      data-overflow-start={sectionTabsEdges.start || undefined} data-overflow-end={sectionTabsEdges.end || undefined}>
      <div className="daily-section-tabs" role="tablist" aria-label="Daily sections" onKeyDown={onTabKeyDown}>
        {availableSections.map(item => <button key={item.id} id={`daily-tab-${item.id}`} className="daily-section-tab" type="button" role="tab"
          aria-selected={item.id === activeSection?.id} aria-controls="daily-section-panel"
          tabIndex={item.id === activeSection?.id ? 0 : -1} onClick={() => selectSection(item.id)}>
          {item.label}
        </button>)}
      </div>
    </nav>
    {activeSection?.id !== 'body-sleep' && activeSection?.usesPeriod && <div ref={periodSlot} className="daily-period-slot" style={{ minHeight: periodSlotHeight }}>
      <DailyPeriodControl period={period} onPeriodChange={setPeriod} />
    </div>}
    <DailySectionNavigationContext.Provider value={navigation}>
      <div className="daily-section-panel" id="daily-section-panel" role="tabpanel"
        aria-labelledby={`daily-tab-${activeSection?.id ?? 'overview'}`} tabIndex={0} key={activeSection?.id}>
        {!activeSection && sectionLoadError && <div className="daily-notice" role="alert">
          <p>Sections unavailable.</p>
          <button className="secondary-button" type="button" onClick={() => setSectionLoadAttempt(attempt => attempt + 1)}>Retry sections</button>
        </div>}
        {!activeSection && !sectionLoadError && <Loader
          label={navigation.availabilityPending ? 'Checking Daily availability' : 'Loading Daily sections'} variant="rows" />}
        {activeSection && navigation.availabilityPending && <Loader label="Checking Daily availability" variant="rows" />}
        {activeSection && !navigation.availabilityPending && <Suspense fallback={<Loader label={`Loading ${activeSection.label}`} variant="rows" />}>
          <activeSection.Component backendUrl={backendUrl} getAccessToken={getAccessToken} sources={sources}
            period={period} onPeriodChange={setPeriod} refreshVersion={refreshVersion} />
        </Suspense>}
      </div>
    </DailySectionNavigationContext.Provider>
  </section>;
}
