import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import {registerPhase6fPreviewPwa} from './utils/phase6fPreviewPwa';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Default OFF; only explicit pinned HTTPS Preview may install the DEMO PWA.
void registerPhase6fPreviewPwa(import.meta.env.VITE_PHASE6F_PWA_PREVIEW_UI);
