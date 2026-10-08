import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { ROLE_LABEL } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { NAV } from './nav';
import { icons } from './icons';
import { useNavCounts } from './useNavCounts';

interface Props {
  open: boolean;
  onNavigate: () => void;
  onToggleCollapse: () => void;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Sidebar({ open, onNavigate, onToggleCollapse }: Props) {
  const { user, can, logout } = useAuth();
  const counts = useNavCounts();
  const [pwOpen, setPwOpen] = useState(false);
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
            <div className="subtitle">(Cambodia) Co., ltd</div>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
          >
            {icons.collapse({})}
          </button>
        </div>

        <button
          type="button"
          className="user-card"
          onClick={() => setPwOpen(true)}
          title="Change password"
          style={{
            width: 'auto',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <div className="avatar">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              <span
                aria-hidden="true"
                style={{ fontWeight: 800, fontSize: 13, color: 'var(--accent-primary)' }}
              >
                {initials(user.fullName)}
              </span>
            )}
          </div>
          <div>
            <div className="name">{user.fullName}</div>
            <div className="role">{user.jobTitle ?? ROLE_LABEL[user.role]}</div>
          </div>
        </button>

        <nav className="menu" id="menu">
          {NAV.map((group) => {
            const items = group.items.filter((i) => can(i.permission));
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
                          <span className="item-badge" aria-label={`${badge} open`}>
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

        <div className="sidebar-footer">
          <button type="button" className="signout" onClick={() => void logout()}>
            {icons.signout({})}
            Sign Out
          </button>
        </div>
      </aside>
      <div className="sidebar-scrim" onClick={onNavigate} aria-hidden="true" />
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </>
  );
}
