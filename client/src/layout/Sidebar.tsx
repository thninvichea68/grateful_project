import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ROLE_LABEL } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { NAV, type NavChild, type NavItem } from './nav';
import { icons } from './icons';
import { useNavCounts } from './useNavCounts';
import { initials } from '../components/Avatar';

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

        <Link
          to="/settings?tab=profile"
          className="user-card"
          onClick={onNavigate}
          title="My profile"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="avatar">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              <span
                aria-hidden="true"
                style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-primary)' }}
              >
                {initials(user.fullName)}
              </span>
            )}
          </div>
          <div>
            <div className="name">{user.fullName}</div>
            <div className="role">{user.jobTitle ?? ROLE_LABEL[user.role]}</div>
          </div>
        </Link>

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
                  if (item.children)
                    return <NavGroupItem key={item.to} item={item} onNavigate={onNavigate} />;
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

const under = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);
const childActive = (pathname: string, c: NavChild) =>
  c.end ? pathname === c.to : [c.to, ...(c.also ?? [])].some((to) => under(pathname, to));

/**
 * An item with sections (Accounting): the item opens its first section and the list; the
 * chevron folds the list away. It opens by itself whenever one of its sections is shown.
 */
function NavGroupItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const inside = under(pathname, item.to);
  const [open, setOpen] = useState(inside);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  return (
    <div className={`menu-item-wrap${open ? ' open' : ''}`}>
      <div className="menu-item-row">
        <NavLink
          to={item.to}
          onClick={() => {
            setOpen(true);
            onNavigate();
          }}
          className={`menu-item${inside ? ' active' : ''}`}
        >
          {icons[item.icon]({})}
          {item.label}
        </NavLink>
        <button
          type="button"
          className="submenu-toggle menu-item-toggle"
          aria-label={open ? `Hide ${item.label} sections` : `Show ${item.label} sections`}
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      <div className="submenu" role="group" aria-label={`${item.label} sections`}>
        {item.children!.map((c) => (
          <NavLink
            key={c.to}
            to={c.to}
            end={c.end}
            onClick={onNavigate}
            tabIndex={open ? undefined : -1}
            className={`submenu-item${childActive(pathname, c) ? ' active' : ''}`}
          >
            {c.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
