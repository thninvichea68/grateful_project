import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { icons } from './icons';
import { AskAi } from './AskAi';
import { GlobalSearch } from './GlobalSearch';
import { LiveClock } from './LiveClock';
import { LiveMonthPill } from './LiveMonthPill';
import { NotificationBell } from './NotificationBell';
import { TeamChat } from './chat/TeamChat';

interface Props {
  title: string;
  onToggleMenu: () => void;
}

export function TopBar({ title, onToggleMenu }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can } = useAuth();

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
        {pathname.startsWith('/overview') && <LiveMonthPill />}
      </div>

      <div className="topbar-right">
        <GlobalSearch />

        <AskAi />

        <TeamChat />

        {can('followups:read') && <NotificationBell />}

        {can('shipments:write') && (
          <button
            type="button"
            className="new-shipment-btn"
            title="New Shipment"
            onClick={() => navigate('/plans/new')}
          >
            {icons.plus({})}
            New Shipment
          </button>
        )}

        <LiveClock />
      </div>
    </header>
  );
}
