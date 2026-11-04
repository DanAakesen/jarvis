import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');
const router = createBrowserRouter([{ path: '*', element: <App healthEnabled={__JARVIS_HEALTH_ENABLED__} /> }]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
