import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@gs/shared';
import { useAuth } from './AuthProvider';
import { FullPageLoader } from '../components/FullPageLoader';

/** Redirects to /login (remembering where the user was going) when signed out. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous')
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Shows a "no access" card instead of the page when the role lacks the permission. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <section className="view active">
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-header-row">
            <h3>You don’t have access to this page</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Your role doesn’t include this area. Ask an Admin to change your role in Staff &amp;
            Roles.
          </p>
        </div>
      </section>
    );
  }
  return <>{children}</>;
}
