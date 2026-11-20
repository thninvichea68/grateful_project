import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_STATUSES,
  followUpInputSchema,
  type FollowUpRow,
  type FollowUpStatus,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useStaff } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../components/ui';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { formResolver } from '../lib/zodForm';
import { MyWorkView } from './followup/MyWorkView';
import s from './FollowUpPage.module.css';

const STATUS: Record<
  FollowUpStatus,
  { tone: 'pending' | 'progress' | 'completed' | 'exception'; label: string }
> = {
  OPEN: { tone: 'exception', label: 'Open' },
  AWAITING_REPLY: { tone: 'pending', label: 'Awaiting reply' },
  IN_REVIEW: { tone: 'progress', label: 'In review' },
  DONE: { tone: 'completed', label: 'Done' },
};
const PP = 'Asia/Phnom_Penh';
/** "Today, 17:00" / "Sep 01, 09:30" in Phnom Penh time, like the prototype. */
function dueLabel(iso: string | null): string {
  if (!iso) return 'Waiting for anchor date';
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PP }).format(d);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: PP }).format(new Date());
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: PP,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  if (day === today) return `Today, ${time}`;
  return `${new Intl.DateTimeFormat('en-US', { timeZone: PP, month: 'short', day: '2-digit' }).format(d)}, ${time}`;
}
/** ISO → value for <input type="datetime-local"> in Phnom Penh time. */
const toLocalInput = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: PP,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(' ', 'T');

/**
 * Follow Up: one page. The shipping plans at their current stage and the follow-ups added by
 * hand, in one list (MyWorkView); a hand-added one opens here to edit or complete it.
 */
export function FollowUpPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState<FollowUpRow | 'new' | null>(null);
  return (
    <section className={`view active ${s.page}`}>
      <MyWorkView
        onOpenTask={setOpen}
        onAddTask={can('followups:write') ? () => setOpen('new') : undefined}
      />
      {open && <FollowUpModal row={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function FollowUpModal({ row, onClose }: { row: FollowUpRow | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const staff = useStaff();
  const editable = can('followups:write');
  const save = useApiMutation(
    (v: Record<string, unknown>) =>
      row
        ? api(`/follow-ups/${row.id}`, { method: 'PATCH', json: v })
        : api('/follow-ups', { method: 'POST', json: v }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const del = useApiMutation(
    () => api(`/follow-ups/${row!.id}`, { method: 'DELETE' }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, string>>({
    resolver: formResolver(followUpInputSchema) as never,
    defaultValues: row
      ? {
          subject: row.subject,
          notes: row.notes ?? '',
          clientId: row.clientId ?? '',
          shipmentId: row.shipmentId ?? '',
          assigneeId: row.assigneeId ?? '',
          dueAt: row.dueAt ? toLocalInput(row.dueAt) : '',
          actualAt: row.actualAt ? toLocalInput(row.actualAt) : '',
          priority: row.priority,
          status: row.status,
        }
      : {
          priority: 'MEDIUM',
          status: 'OPEN',
          dueAt: toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '17:00',
          actualAt: '',
        },
  });
  const submit = handleSubmit(async (v) => {
    const payload: Record<string, unknown> = { ...v };
    if (row?.completionField) delete payload.actualAt;
    await save.mutateAsync(payload);
    toast(row ? 'Follow-up saved.' : 'Follow-up added.');
    onClose();
  });
  return (
    <Modal
      title={row ? `${row.reference} · ${row.subject}` : 'Add follow-up'}
      sub="Due times are Phnom Penh time."
      onClose={onClose}
      width={720}
    >
      <ErrorBanner error={save.error ?? del.error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset disabled={!editable} style={{ border: 'none' }}>
          <div className="form-fields-grid">
            <div className="form-field-group" style={{ gridColumn: 'span 4' }}>
              <label htmlFor="fu-subject">Subject</label>
              <input
                id="fu-subject"
                className="form-field-box"
                {...register('subject')}
                aria-invalid={!!errors.subject}
              />
              <FieldError message={errors.subject?.message} />
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="fu-client">Client</label>
              <select id="fu-client" className="form-select-box" {...register('clientId')}>
                <option value="">—</option>
                {lookups.data?.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="fu-assignee">Assignee</label>
              <select id="fu-assignee" className="form-select-box" {...register('assigneeId')}>
                <option value="">—</option>
                {staff.data
                  ?.filter((m) => m.isActive)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              {row?.milestoneRuleId ? (
                <>
                  <label>Planned date</label>
                  <div className="form-field-box" aria-live="polite">
                    {dueLabel(row.dueAt)}
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="fu-due">Due</label>
                  <input
                    id="fu-due"
                    type="datetime-local"
                    className="form-field-box"
                    {...register('dueAt')}
                    aria-invalid={!!errors.dueAt}
                    required
                  />
                  <FieldError message={errors.dueAt?.message} />
                </>
              )}
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              {row?.completionField ? (
                <>
                  <label>Actual date</label>
                  <div className="form-field-box">
                    {row.actualAt
                      ? dueLabel(row.actualAt)
                      : 'Enter this actual date on the linked shipment plan.'}
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="fu-actual">Actual date</label>
                  <input
                    id="fu-actual"
                    type="datetime-local"
                    className="form-field-box"
                    {...register('actualAt')}
                    aria-invalid={!!errors.actualAt}
                  />
                  <small>Recording an actual date completes this follow-up automatically.</small>
                  <FieldError message={errors.actualAt?.message} />
                </>
              )}
            </div>
            <div className="form-field-group">
              <label htmlFor="fu-priority">Priority</label>
              <select id="fu-priority" className="form-select-box" {...register('priority')}>
                {FOLLOW_UP_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0]}
                    {p.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            {row?.actualAt ? (
              <div className="form-field-group">
                <label>Status</label>
                <div className="form-field-box">Completed from actual date</div>
              </div>
            ) : (
              <div className="form-field-group">
                <label htmlFor="fu-status">Status</label>
                <select id="fu-status" className="form-select-box" {...register('status')}>
                  {FOLLOW_UP_STATUSES.filter((status) => status !== 'DONE').map((status) => (
                    <option key={status} value={status}>
                      {STATUS[status].label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-field-group" style={{ gridColumn: 'span 4' }}>
              <label htmlFor="fu-notes">Notes</label>
              <textarea id="fu-notes" className="form-field-box" rows={4} {...register('notes')} />
            </div>
          </div>
        </fieldset>
        {editable && (
          <div className={ui.actions}>
            {row && (
              <button
                type="button"
                className="btn-delete-shipment"
                onClick={() =>
                  window.confirm('Delete this follow-up?') &&
                  void del.mutateAsync(undefined).then(() => {
                    toast('Deleted.');
                    onClose();
                  })
                }
              >
                Delete
              </button>
            )}
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-create-submit" disabled={save.isPending}>
              {row ? 'Save' : 'Add follow-up'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
