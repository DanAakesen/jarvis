import { dailyQuerySources as sourceIds } from '@jarvis/contracts';
import { DailyPage } from '../../DailyPage';
import type { DailySectionProps } from '../types';
import './briefs.css';

export default function BriefsSection({ backendUrl, getAccessToken, sources }: DailySectionProps) {
  const knownSources = sources.filter(source => source === sourceIds.briefs || source === sourceIds.brief);
  return <DailyPage embedded backendUrl={backendUrl} getAccessToken={getAccessToken}
    embeddedClassName="daily-briefs-embedded" knownSources={knownSources} initialSource={sourceIds.briefs} />;
}
