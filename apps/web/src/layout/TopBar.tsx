import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { icons } from './icons';
import { AskAi } from './AskAi';
import { LiveClock } from './LiveClock';
import { useNavCounts } from './useNavCounts';

interface Props {
  title: string;
  onToggleMenu: () => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
}

export function TopBar({ title, onToggleMenu, onToggleTheme, theme }: Props) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const counts = useNavCounts();
  const [q, setQ] = useState('');
  const overdue = counts.data?.overdueFollowUps ?? 0;

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/plans?q=${encodeURIComponent(term)}`);
  }

  return (
    <header className="topbar">
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
          {title}
        </h1>
      </div>

      <div className="topbar-right">
        {can('shipments:read') && (
          <form className="search-box" role="search" onSubmit={onSearch}>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search shipments, containers…"
              aria-label="Search shipments and containers"
            />
            {icons.search({})}
          </form>
        )}

        <AskAi />

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          aria-pressed={theme === 'light'}
        >
          {icons.sun({})}
        </button>

        {can('followups:read') && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => navigate('/followup?filter=overdue')}
            aria-label={overdue ? `${overdue} overdue follow-ups` : 'No overdue follow-ups'}
          >
            {icons.bell({})}
            {overdue > 0 && <span className="badge">{overdue}</span>}
          </button>
        )}

        {can('shipments:write') && (
          <button type="button" className="new-shipment-btn" onClick={() => navigate('/plans/new')}>
            {icons.plus({})}
            New Shipment
          </button>
        )}

        <LiveClock />
      </div>
    </header>
  );
}
