import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { NotFoundPage } from '../pages';
import type { AreaProps } from '../areas';
import { ProjectSettingsPage, ProjectsPage } from './ProjectsPage';
import { TasksPage } from './TasksPage';
import { TaskDetailPage } from './TaskDetailPage';
import { ReleasePage, ReleaseRedirectPage } from './ReleasePage';

const idPattern = /^[1-9]\d{0,15}$/;

function TaskPage({ backendUrl, getAccessToken }: AreaProps) {
  const taskId = useParams().taskId;
  if (!taskId || !idPattern.test(taskId)) return <NotFoundPage />;
  return <TaskDetailPage backendUrl={backendUrl} getAccessToken={getAccessToken} taskId={taskId} />;
}

/** The Software Factory area owns its pages; the shell only mounts it under `/factory`. */
export function FactoryArea({ backendUrl, getAccessToken }: AreaProps) {
  return (
    <div className="area">
      <Routes>
        <Route index element={<Navigate to="tasks" replace />} />
        <Route path="tasks" element={<TasksPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="tasks/:taskId" element={<TaskPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="projects" element={<ProjectsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="projects/:projectId" element={
          <ProjectSettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="projects/:projectId/releases" element={
          <ReleasePage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="projects/:projectId/releases/:releaseId" element={
          <ReleasePage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="releases/:releaseId" element={
          <ReleaseRedirectPage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
