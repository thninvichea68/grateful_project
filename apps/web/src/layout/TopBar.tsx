import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { icons } from './icons';
import { AskAi } from './AskAi';
import { GlobalSearch } from './GlobalSearch';
import { CustomizeOverviewButton, LiveMonthPill } from './LiveMonthPill';
import { ProfileMenu } from './ProfileMenu';
import { useNavCounts } from './useNavCounts';
import { TeamChat } from './chat/TeamChat';

interface Props {
  /** Breadcrumb from the sidebar (section › page › tab); the last one is the page itself. */
  crumbs: string[];
  onToggleMenu: () => void;
}

export function TopBar({ crumbs, onToggleMenu }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can } = useAuth();
  const counts = useNavCounts();
  const overdue = counts.data?.overdueFollowUps ?? 0;
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);

  // Ctrl+K (⌘K on a Mac) opens the search from any page, or puts the cursor back in it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        searchBox.current?.querySelector('input')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Search opens from its button (or Ctrl+K): focus the field; close on Escape, a click
  // outside, or a new page.
  useEffect(() => {
    if (!searchOpen) return;
    searchBox.current?.querySelector('input')?.focus();
    const away = (e: Event) => {
      const t = e.target as Element;
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !searchBox.current?.contains(t) && !t.closest?.('.search-toggle')
      )
        setSearchOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', away);
    };
  }, [searchOpen]);
  useEffect(() => setSearchOpen(false), [pathname]);

  return (
    <header className={`topbar${searchOpen ? ' search-open' : ''}`}>
      <div className="topbar-left">
        <button
          type="button"
          className="menu-toggle"
          onClick={onToggleMenu}
          aria-label="Toggle menu"
          aria-controls="sidebar"
        >
          {icons.menu({})}
        </button>
        <h1 className="page-title" id="pageTitle">
          {crumbs.map((c, i) =>
            i < crumbs.length - 1 ? (
              <span key={i} className="page-crumb">
                {c}
                <span className="page-crumb-sep" aria-hidden="true">
                  {icons.chevronRight({ width: 16, height: 16 })}
                </span>
              </span>
            ) : (
              <span key={i}>{c}</span>
            ),
          )}
        </h1>
        {pathname.startsWith('/overview') && <LiveMonthPill />}
      </div>

      <div className="topbar-right">
        {/* Search opens with Ctrl+K; phones and tablets (no Ctrl key) get this icon instead. */}
        <button
          type="button"
          className="icon-btn search-toggle"
          onClick={() => setSearchOpen((o) => !o)}
          aria-label="Search"
          aria-keyshortcuts="Control+K"
          aria-expanded={searchOpen}
        >
          {icons.search({})}
        </button>
        <div className="topbar-search" ref={searchBox}>
          <GlobalSearch />
        </div>

        {pathname.startsWith('/overview') && <CustomizeOverviewButton />}

        <AskAi />

        <TeamChat />

        {can('followups:read') && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => navigate('/followup?filter=overdue')}
            aria-label={overdue ? `${overdue} overdue follow-ups` : 'No overdue follow-ups'}
          >
            {icons.bell({})}
            {overdue > 0 && (
              <span key={overdue} className="badge" aria-hidden="true">
                {overdue > 99 ? '99+' : overdue}
              </span>
            )}
          </button>
        )}

        {can('shipments:write') && (
          <button
            type="button"
            className="new-shipment-btn"
            onClick={() => navigate('/plans/new')}
            aria-label="New Shipment"
            title="New Shipment"
          >
            {icons.plus({})}
            <span className="topbar-btn-label">New Shipment</span>
          </button>
        )}

        <ProfileMenu />
      </div>
    </header>
  );
}
