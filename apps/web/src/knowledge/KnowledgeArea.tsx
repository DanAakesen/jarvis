import type { AreaProps } from '../areas';
import { KnowledgeGraphView } from './KnowledgeGraphView';

/** The Knowledge page: Dan's vault as a 3D star cloud filling the room. */
export function KnowledgeArea({ backendUrl, getAccessToken }: AreaProps) {
  return (
    <div className="area knowledge-page">
      <h1 className="visually-hidden">Knowledge</h1>
      <KnowledgeGraphView backendUrl={backendUrl} getAccessToken={getAccessToken} />
    </div>
  );
}
