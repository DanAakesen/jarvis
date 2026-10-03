import { Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { NotFoundPage, PendingPage } from '../pages';
import type { AreaProps } from '../areas';
import { ProjectSettingsPage, ProjectsPage } from './ProjectsPage';

const idPattern = /^[1-9]\d{0,15}$/;

function RecordPage({ param, title, children, back }: {
  param: string;
  title: string;
  children: string;
  back: { to: string; label: string };
}) {
  const id = useParams()[param];
  if (!id || !idPattern.test(id)) return <NotFoundPage />;
  return <PendingPage title={`${title} ${id}`} back={back}>{children}</PendingPage>;
}

const tasksLink = { to: '/factory/tasks', label: 'Back to tasks' };
const projectsLink = { to: '/factory/projects', label: 'Back to projects' };

/** The Software Factory area owns its pages; the shell only mounts it under `/factory`. */
export function FactoryArea({ backendUrl, getAccessToken }: AreaProps) {
  return (
    <div className="area">
      <nav className="area-nav" aria-label="Software Factory">
        <NavLink className="nav-link" to="/factory/tasks">Tasks</NavLink>
        <NavLink className="nav-link" to="/factory/projects">Projects</NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="tasks" replace />} />
        <Route path="tasks" element={
          <PendingPage title="Tasks">
            The task board isn&apos;t available yet. It will show tasks in columns by state, with filters
            and a way to create a task.
          </PendingPage>
        } />
        <Route path="tasks/:taskId" element={
          <RecordPage param="taskId" title="Task" back={tasksLink}>Details for this task aren&apos;t available yet.</RecordPage>
        } />
        <Route path="projects" element={<ProjectsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="projects/new" element={
          <ProjectSettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="projects/:projectId" element={
          <ProjectSettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="releases/:releaseId" element={
          <RecordPage param="releaseId" title="Release" back={projectsLink}>Details for this release aren&apos;t available yet.</RecordPage>
        } />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
