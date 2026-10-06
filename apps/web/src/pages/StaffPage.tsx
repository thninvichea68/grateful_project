import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  PERMISSIONS,
  ROLE_CODES,
  ROLE_LABEL,
  STAFF_STATUSES,
  staffInputSchema,
  staffUpdateSchema,
  type Permission,
  type RoleCode,
  type StaffMember,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useRoles, useStaff } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, Modal, TableState, ui } from '../components/ui';
import { Pill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { formResolver } from '../lib/zodForm';

const STATUS = {
  ACTIVE: { tone: 'completed', label: 'Active' },
  ON_LEAVE: { tone: 'pending', label: 'On leave' },
  INACTIVE: { tone: 'exception', label: 'Inactive' },
} as const;
const PERM_GROUPS = [...new Set(PERMISSIONS.map((p) => p.split(':')[0]!))];

export function StaffPage() {
  const { can, user } = useAuth();
  const staff = useStaff();
  const [tab, setTab] = useState<'members' | 'roles'>('members');
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const manage = can('staff:manage');
  return (
    <section className="view active">
      <nav style={{ display: 'flex', gap: 8, marginBottom: 18 }} aria-label="Staff sections">
        <button
          type="button"
          className={`filter-btn${tab === 'members' ? ' active' : ''}`}
          onClick={() => setTab('members')}
        >
          Team members
        </button>
        <button
          type="button"
          className={`filter-btn${tab === 'roles' ? ' active' : ''}`}
          onClick={() => setTab('roles')}
        >
          Roles &amp; permissions
        </button>
      </nav>
      {tab === 'members' ? (
        <div className="card">
          <div className="card-header-row">
            <h3>Staff &amp; Role Management</h3>
            {manage && (
              <button type="button" className="new-shipment-btn" onClick={() => setEditing('new')}>
                + Add Staff
              </button>
            )}
          </div>
          <div className="plans-table-scroll">
            <table className="data-table-clean">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  cols={5}
                  loading={staff.isLoading}
                  error={staff.error}
                  empty={staff.data?.length === 0}
                  emptyText="No staff yet."
                />
                {staff.data?.map((m) => (
                  <tr
                    key={m.id}
                    className={manage ? 'plans-row-clickable' : undefined}
                    tabIndex={manage ? 0 : undefined}
                    onClick={() => manage && setEditing(m)}
                    onKeyDown={(e) => manage && e.key === 'Enter' && setEditing(m)}
                  >
                    <td>
                      <div className="val-bold">
                        {m.fullName}
                        {m.id === user?.id ? ' (you)' : ''}
                      </div>
                      <div
                        style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontWeight: 700 }}
                      >
                        {m.email}
                        {m.jobTitle ? ` · ${m.jobTitle}` : ''}
                      </div>
                    </td>
                    <td>{ROLE_LABEL[m.role]}</td>
                    <td>{m.department ?? '-'}</td>
                    <td>{m.lastLoginAt ? fmtDate(m.lastLoginAt) : 'Never'}</td>
                    <td>
                      <Pill tone={STATUS[m.isActive ? m.status : 'INACTIVE'].tone}>
                        {STATUS[m.isActive ? m.status : 'INACTIVE'].label}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <RolesMatrix editable={manage} />
      )}
      {editing && (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function StaffModal({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const lookups = useLookups();
  const save = useApiMutation(
    (v: Record<string, unknown>) =>
      member
        ? api(`/staff/${member.id}`, { method: 'PATCH', json: v })
        : api('/staff', { method: 'POST', json: v }),
    [['staff']],
  );
  const reset = useApiMutation(
    (password: string) =>
      api(`/staff/${member!.id}/reset-password`, { method: 'POST', json: { password } }),
    [['staff']],
  );
  const remove = useApiMutation(
    () => api(`/staff/${member!.id}`, { method: 'DELETE' }),
    [['staff']],
  );
  const schema = member ? staffUpdateSchema : staffInputSchema;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, string>>({
    resolver: formResolver(schema) as never,
    defaultValues: member
      ? {
          fullName: member.fullName,
          role: member.role,
          jobTitle: member.jobTitle ?? '',
          department: member.department ?? '',
          phone: member.phone ?? '',
          status: member.isActive ? member.status : 'INACTIVE',
        }
      : { role: 'OPERATOR', status: 'ACTIVE' },
  });
  const self = member?.id === user?.id;
  const submit = handleSubmit(async (v) => {
    await save.mutateAsync(v);
    toast(
      member ? 'Staff member updated.' : 'Staff member added. Give them their temporary password.',
    );
    onClose();
  });
  const doReset = async () => {
    const pw = window.prompt(
      'New temporary password (at least 10 characters with a number). They should change it after signing in.',
    );
    if (!pw) return;
    await reset.mutateAsync(pw);
    toast('Password reset. Their other sessions were signed out.');
  };
  const doRemove = async () => {
    if (
      !window.confirm(
        `Remove ${member!.fullName}? They can no longer sign in. Their past work stays in the records.`,
      )
    )
      return;
    await remove.mutateAsync(undefined);
    toast('Staff member removed.');
    onClose();
  };
  const f = (name: string, label: string, type = 'text', span?: number) => (
    <div className="form-field-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label htmlFor={`st-${name}`}>{label}</label>
      <input
        id={`st-${name}`}
        type={type}
        className="form-field-box"
        {...register(name)}
        aria-invalid={!!errors[name]}
        autoComplete="off"
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );
  return (
    <Modal
      title={member ? member.fullName : 'Add staff member'}
      sub={
        member ? member.email : 'They sign in with this email and the temporary password you set.'
      }
      onClose={onClose}
      width={720}
    >
      <ErrorBanner error={save.error ?? reset.error ?? remove.error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="form-fields-grid">
          {!member && f('email', 'Work email', 'email', 2)}
          {f('fullName', 'Full name', 'text', 2)}
          <div className="form-field-group">
            <label htmlFor="st-role">Role</label>
            <select id="st-role" className="form-select-box" {...register('role')} disabled={self}>
              {ROLE_CODES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field-group">
            <label htmlFor="st-status">Status</label>
            <select
              id="st-status"
              className="form-select-box"
              {...register('status')}
              disabled={self}
            >
              {STAFF_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
          </div>
          {f('jobTitle', 'Job title')}
          <div className="form-field-group">
            <label htmlFor="st-department">Department</label>
            <select id="st-department" className="form-select-box" {...register('department')}>
              <option value="">—</option>
              {lookups.data?.values.DEPARTMENT.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          {f('phone', 'Phone')}
          {!member && f('password', 'Temporary password', 'text', 2)}
        </div>
        {self && (
          <p className={ui.dialogSub} style={{ marginTop: 10 }}>
            You can't change your own role or status. Ask another Admin.
          </p>
        )}
        <div className={ui.actions}>
          {member && !self && (
            <button type="button" className="btn-delete-shipment" onClick={() => void doRemove()}>
              Remove
            </button>
          )}
          {member && (
            <button type="button" className="btn-cancel-shipment" onClick={() => void doReset()}>
              Reset password
            </button>
          )}
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : member ? 'Save' : 'Add staff'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RolesMatrix({ editable }: { editable: boolean }) {
  const roles = useRoles();
  const toast = useToast();
  const save = useApiMutation(
    ({ code, permissions }: { code: RoleCode; permissions: Permission[] }) =>
      api(`/staff/roles/${code}`, { method: 'PUT', json: { permissions } }),
    [['staff', 'roles']],
  );
  const toggle = async (code: RoleCode, perm: Permission, on: boolean) => {
    const role = roles.data?.find((r) => r.code === code);
    if (!role) return;
    await save.mutateAsync({
      code,
      permissions: on ? [...role.permissions, perm] : role.permissions.filter((p) => p !== perm),
    });
    toast(
      `${ROLE_LABEL[code]} updated. Members get the change at their next sign-in or within 15 minutes.`,
    );
  };
  return (
    <div className="card">
      <div className="card-header-row">
        <h3>Roles &amp; permissions</h3>
      </div>
      <ErrorBanner error={save.error} />
      <div className="plans-table-scroll">
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Permission</th>
              {roles.data?.map((r) => (
                <th key={r.code} style={{ textAlign: 'center' }}>
                  {r.name}
                  <div style={{ fontWeight: 600, fontSize: 11 }}>{r.members} people</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_GROUPS.map((g) =>
              PERMISSIONS.filter((p) => p.startsWith(`${g}:`)).map((p, i) => (
                <tr key={p}>
                  <td style={{ fontWeight: i === 0 ? 800 : 600 }}>{p.replace(':', ' · ')}</td>
                  {roles.data?.map((r) => (
                    <td key={r.code} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label={`${r.name}: ${p}`}
                        checked={r.permissions.includes(p)}
                        disabled={!editable || r.code === 'ADMIN' || save.isPending}
                        onChange={(e) => void toggle(r.code, p, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className={ui.dialogSub} style={{ marginTop: 10 }}>
        Admin always has every permission. The server enforces these on every request.
      </p>
    </div>
  );
}
