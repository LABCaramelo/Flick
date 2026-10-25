import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import { App } from './App';
import { LabGate } from './LabGate';
import '@caramelo/design-system/styles.css';
import './styles/caramelo/caramelo.css';
import './styles/global.css';

enableMapSet();

// Sincroniza o tema Caramelo com o LAB (localStorage e atributo data-caramelo-theme)
const THEME_KEY = 'caramelo-theme';
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-caramelo-theme', saved);
  }
} catch {
  // block
}

window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
    document.documentElement.setAttribute('data-caramelo-theme', e.newValue);
  }
});

// Spotlight listener para superfícies Caramelo Lumen
let frame = 0;
window.addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
    const surface = e.target.closest<HTMLElement>('.cm-surface--spotlight');
    if (!surface) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      surface.style.setProperty('--my', `${e.clientY - rect.top}px`);
    });
  },
  { passive: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabGate><App /></LabGate>
  </StrictMode>,
);
