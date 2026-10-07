import { useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useTaskWindows } from '../task-windows';
import { NotFoundPage } from '../pages';
import type { AreaProps } from '../areas';
import { ProjectSettingsPage } from './ProjectsPage';
import { TasksPage } from './TasksPage';
import { TaskDetailPage } from './TaskDetailPage';
import { ReleasePage, ReleaseRedirectPage } from './ReleasePage';

const idPattern = /^[1-9]\d{0,15}$/;

/** A task address opens the task as a window over Kanban; without the shell's window layer it renders in place. */
function TaskPage({ backendUrl, getAccessToken }: AreaProps) {
  const taskId = useParams().taskId;
  const windows = useTaskWindows();
  const valid = Boolean(taskId && idPattern.test(taskId));
  useEffect(() => {
    if (valid && taskId) windows?.open(taskId);
  }, [taskId, valid, windows]);
  if (!taskId || !valid) return <NotFoundPage />;
  if (windows) return <Navigate to="/factory/kanban" replace />;
  return <TaskDetailPage backendUrl={backendUrl} getAccessToken={getAccessToken} taskId={taskId} />;
}

/** The Software Factory area owns its pages; the shell only mounts it under `/factory`. */
export function FactoryArea({ backendUrl, getAccessToken }: AreaProps) {
  return (
    <div className="area">
      <Routes>
        <Route index element={<Navigate to="kanban" replace />} />
        <Route path="kanban" element={<TasksPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        {/* The task and project lists now live on Kanban and in Settings; old addresses keep working. */}
        <Route path="tasks" element={<Navigate to="/factory/kanban" replace />} />
        <Route path="tasks/:taskId" element={<TaskPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="projects" element={<Navigate to="/settings#projects" replace />} />
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
