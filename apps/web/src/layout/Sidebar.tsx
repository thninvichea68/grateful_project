import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { NAV } from './nav';
import { icons } from './icons';
import { useNavCounts } from './useNavCounts';

interface Props {
  open: boolean;
  onNavigate: () => void;
  onToggleCollapse: () => void;
}

export function Sidebar({ open, onNavigate, onToggleCollapse }: Props) {
  const { user, can } = useAuth();
  const counts = useNavCounts();
  if (!user) return null;

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} id="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">
            <img src="/logo.png" alt="Grateful Solutions logo" />
            <button
              type="button"
              className="brand-expand-btn"
              onClick={onToggleCollapse}
              aria-label="Open sidebar"
              data-tooltip="Open sidebar"
            >
              {icons.collapse({})}
            </button>
          </div>
          <div className="brand-text">
            <div className="title">Grateful Solutions</div>
            <div className="subtitle">(Cambodia) Co., Ltd.</div>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            {icons.collapse({})}
          </button>
        </div>

        <nav className="menu" id="menu">
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => can(i.permission) && !i.hideFor?.includes(user.role),
            );
            if (!items.length) return null;
            return (
              <div className="menu-group" key={group.heading}>
                <div className="menu-heading">{group.heading}</div>
                {items.map((item) => {
                  const badge = item.badge && counts.data ? counts.data[item.badge] : 0;
                  return (
                    <div className="menu-item-wrap" key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        title={item.sub ? item.title : undefined}
                        className={({ isActive }) =>
                          `menu-item${item.sub ? ' submenu-item has-icon' : ''}${isActive ? ' active' : ''}`
                        }
                      >
                        {icons[item.icon]({})}
                        {item.label}
                        {badge > 0 && (
                          <span
                            className="item-badge"
                            aria-label={`${badge} ${item.badge === 'openFollowUps' ? 'open' : 'unread'}`}
                          >
                            {badge}
                          </span>
                        )}
                      </NavLink>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="sidebar-scrim" onClick={onNavigate} aria-hidden="true" />
    </>
  );
}
