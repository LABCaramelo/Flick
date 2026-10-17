import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { ProjectPage } from './pages/ProjectPage';
import { Toasts } from './components/ui/Toasts';
import { SettingsModal } from './components/settings/SettingsModal';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Home />} />
        <Route path="/canvas/:projectId" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <SettingsModal />
      <Toasts />
    </BrowserRouter>
  );
}
