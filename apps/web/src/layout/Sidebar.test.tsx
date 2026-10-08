import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ROLE_DEFAULT_PERMISSIONS,
  hasPermission,
  type RoleCode,
  type SessionUser,
} from '@gs/shared';
import { Sidebar } from './Sidebar';

const authState: { user: SessionUser | null } = { user: null };
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: authState.user,
    can: (p: Parameters<typeof hasPermission>[1]) =>
      !!authState.user && hasPermission(authState.user.permissions, p),
    logout: vi.fn(),
  }),
}));
vi.mock('../lib/api', () => ({
  api: vi.fn(async () => ({ openFollowUps: 8, overdueFollowUps: 4, unreadNotifications: 0 })),
}));

function renderAs(role: RoleCode, path = '/overview') {
  authState.user = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'x@gs.local',
    fullName: 'Aden Whitfield',
    jobTitle: 'Customer Service Manager',
    avatarUrl: null,
    role,
    permissions: [...ROLE_DEFAULT_PERMISSIONS[role]],
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar open={false} onNavigate={() => {}} onToggleCollapse={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const links = () =>
  within(screen.getByRole('navigation'))
    .getAllByRole('link')
    .map((a) => a.textContent?.replace(/\d+$/, '').trim());

describe('Sidebar', () => {
  it('shows every section to an Admin, in prototype order', () => {
    renderAs('ADMIN');
    expect(links()).toEqual([
      'Overview',
      'Shipping Plans',
      'Clients',
      'Analytics',
      'Cut Stock',
      'Documents',
      'Follow Up',
      'Accounting',
      'Quotations',
      'Operations',
      'Staff Management',
      'Settings',
    ]);
  });

  it('hides finance from Operators and admin pages from Viewers', () => {
    renderAs('OPERATOR');
    expect(links()).not.toContain('Accounting');
    expect(links()).toContain('Shipping Plans');
  });

  it('hides staff management from Viewers', () => {
    renderAs('VIEWER');
    expect(links()).not.toContain('Staff Management');
    expect(screen.queryByText('Admin')).toBeInTheDocument(); // Settings still readable
  });

  it('marks the current route active and shows the user card', () => {
    renderAs('MANAGER', '/plans');
    expect(screen.getByRole('link', { name: 'Shipping Plans' })).toHaveClass('menu-item', 'active');
    expect(screen.getByText('Customer Service Manager')).toBeInTheDocument();
    expect(screen.getByText('AW')).toBeInTheDocument(); // initials when no avatar
  });

  it('renders the follow-up badge from the API', async () => {
    renderAs('MANAGER');
    expect(await screen.findByLabelText('8 open')).toHaveTextContent('8');
  });
});
