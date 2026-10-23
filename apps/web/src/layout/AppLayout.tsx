import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RememberedOutlet } from './RememberedOutlet';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { titleFor } from './nav';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { applyTheme } from './theme';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Shared shell: sidebar + top bar (page title, search, chat, live clock) + routed page. */
export function AppLayout() {
  const location = useLocation();
  const title = titleFor(location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.title = `${title} | Grateful Solutions`;
  }, [title]);

  useEffect(() => applyTheme(), []);

  useEffect(() => {
    if (readPref('gs:sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');
    return () => document.body.classList.remove('sidebar-collapsed');
  }, []);

  const toggleCollapse = useCallback(() => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    writePref('gs:sidebar', collapsed ? 'collapsed' : 'expanded');
  }, []);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        open={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
        onToggleCollapse={toggleCollapse}
      />
      <div className="main">
        <TopBar title={title} onToggleMenu={() => setMobileOpen((o) => !o)} />
        <main className="content" id="main-content" tabIndex={-1}>
          <ErrorBoundary resetKey={location.pathname}>
            <RememberedOutlet />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}
