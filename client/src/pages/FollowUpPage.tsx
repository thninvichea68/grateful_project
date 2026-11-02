import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FOLLOW_UP_AREA_LABEL,
  FOLLOW_UP_AREAS,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_RULES,
  FOLLOW_UP_STATUSES,
  followUpInputSchema,
  followUpRuleLabel,
  type FollowUpRow,
  type FollowUpRuleRun,
  type FollowUpRuleStatus,
  type FollowUpStatus,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useFollowUps, useStaff } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, Modal, Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { Pill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { formResolver } from '../lib/zodForm';
import fu from './FollowUp.module.css';
import t from './plans/PlansTable.module.css';

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
function dueLabel(iso: string): string {
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
/**
 * What an automatic follow-up's subject adds beyond its check, shipment and client:
 * "Customs not cleared: SHP-26-0205 (JR) arrived 03-Nov" → "arrived 03-Nov".
 */
function detailOf(r: FollowUpRow): string {
  const rest = r.subject.includes(': ') ? r.subject.slice(r.subject.indexOf(': ') + 2) : '';
  if (!r.shipmentReference) return rest;
  return rest
    .replace(r.shipmentReference, '')
    .replace(/^\s*\([A-Z0-9]{1,8}\)/, '')
    .trim();
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

export function FollowUpPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<FollowUpRow | 'new' | null>(null);
  const filter = params.get('filter') ?? 'active';
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: 50,
    q: params.get('q') || undefined,
    status: filter === 'active' ? 'ACTIVE' : filter === 'done' ? 'DONE' : undefined,
    overdue: filter === 'overdue' ? 'true' : undefined,
    source: params.get('source') || undefined,
    rule: params.get('rule') || undefined,
  };
  const setParam = (k: string, v: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v) next.set(k, v);
        else next.delete(k);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  const list = useFollowUps(q);
  const summary = list.data?.summary;
  const toast = useToast();
  const done = useApiMutation(
    (id: string) => api(`/follow-ups/${id}`, { method: 'PATCH', json: { status: 'DONE' } }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const tabs = [
    { v: 'active', label: 'Open', n: summary?.open },
    { v: 'overdue', label: 'Overdue', n: summary?.overdue, danger: true },
    { v: 'done', label: 'Done', n: summary?.done },
    { v: 'all', label: 'All', n: summary?.all },
  ];
  const writable = can('followups:write');

  return (
    <section className="view active">
      <div className="card">
        <div className={t.top}>
          <div className={ui.toolbar} style={{ flex: '1 1 auto' }}>
            <SearchBox
              placeholder="Search reference, subject, client, shipment…"
              defaultValue={q.q}
              aria-label="Search follow-ups"
              onChange={(e) => setParam('q', e.target.value.trim())}
            />
            <select
              className={ui.input}
              value={q.source ?? ''}
              onChange={(e) => setParam('source', e.target.value)}
              aria-label="Raised by"
            >
              <option value="">All sources</option>
              <option value="AUTO">Automatic checks</option>
              <option value="MANUAL">Added by hand</option>
            </select>
          </div>
          {writable && (
            <button type="button" className="new-shipment-btn" onClick={() => setOpen('new')}>
              + Add Follow-Up
            </button>
          )}
        </div>

        <div className={t.bar}>
          <div className={t.tabs} role="group" aria-label="Status">
            {tabs.map((x) => (
              <button
                key={x.v}
                type="button"
                className={t.tab}
                aria-pressed={filter === x.v}
                data-danger={!!x.danger && !!x.n}
                onClick={() => setParam('filter', x.v === 'active' ? '' : x.v)}
              >
                {x.label}
                <span className={t.count}>{x.n === undefined ? '…' : x.n}</span>
              </button>
            ))}
          </div>
          <RuleChecks active={q.rule} onPick={(code) => setParam('rule', code)} />
        </div>

        <div className={fu.tableWrap}>
          <table className={fu.table}>
            <thead>
              <tr>
                <th style={{ width: 96 }}>Reference</th>
                <th>Follow-up</th>
                <th style={{ width: 120 }}>Shipment</th>
                <th style={{ width: 140 }}>Client</th>
                <th style={{ width: 150 }}>Due</th>
                <th style={{ width: 90 }}>Priority</th>
                <th style={{ width: 140 }}>Assignee</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={9}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={filter === 'overdue' ? 'Nothing overdue.' : 'No follow-ups here.'}
              />
              {list.data?.data.map((r) => {
                const rule = FOLLOW_UP_RULES.find((x) => x.code === r.rule);
                return (
                  <tr
                    key={r.id}
                    className={fu.row}
                    data-overdue={r.overdue}
                    tabIndex={0}
                    onClick={() => setOpen(r)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                  >
                    <td className={fu.ref}>{r.reference}</td>
                    <td className={fu.subjectCell} title={r.subject}>
                      {rule ? (
                        <span className={fu.tag} data-area={rule.area} title={rule.description}>
                          {FOLLOW_UP_AREA_LABEL[rule.area]}
                        </span>
                      ) : (
                        <span className={fu.tag} data-area="MANUAL">
                          Manual
                        </span>
                      )}
                      <span className={fu.subject}>
                        {rule ? (
                          <>
                            <b>{rule.label}</b>
                            {detailOf(r) && <span className={fu.detail}>{detailOf(r)}</span>}
                          </>
                        ) : (
                          r.subject
                        )}
                      </span>
                    </td>
                    <td>
                      {r.shipmentReference ? (
                        <Link
                          to={`/plans/${r.shipmentId}`}
                          className={fu.link}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.shipmentReference}
                        </Link>
                      ) : (
                        <span className={fu.muted}>—</span>
                      )}
                    </td>
                    <td className={fu.clip} title={r.clientName ?? undefined}>
                      {r.clientName ?? <span className={fu.muted}>—</span>}
                    </td>
                    <td className={r.overdue ? fu.overdue : undefined}>{dueLabel(r.dueAt)}</td>
                    <td>
                      <span className={fu.priority} data-priority={r.priority}>
                        {r.priority[0]}
                        {r.priority.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className={fu.clip}>
                      {r.assigneeName ?? <span className={fu.muted}>—</span>}
                    </td>
                    <td>
                      {r.autoResolvedAt && r.status === 'DONE' ? (
                        <Pill tone="completed">Fixed</Pill>
                      ) : r.overdue ? (
                        <Pill tone="exception">Overdue</Pill>
                      ) : (
                        <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {writable && r.status !== 'DONE' && (
                        <button
                          type="button"
                          className={fu.doneBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            void done.mutateAsync(r.id).then(() => toast(`${r.reference} done.`));
                          }}
                        >
                          ✓ Done
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) =>
              setParams((x) => {
                const n = new URLSearchParams(x);
                n.set('page', String(p));
                return n;
              })
            }
          />
        )}
      </div>
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
          dueAt: toLocalInput(row.dueAt),
          priority: row.priority,
          status: row.status,
        }
      : {
          priority: 'MEDIUM',
          status: 'OPEN',
          dueAt: toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '17:00',
        },
  });
  const submit = handleSubmit(async (v) => {
    await save.mutateAsync(v);
    toast(row ? 'Follow-up saved.' : 'Follow-up added.');
    onClose();
  });
  return (
    <Modal
      title={row ? `${row.reference} · ${row.subject}` : 'Add follow-up'}
      onClose={onClose}
      width={720}
    >
      <ErrorBanner error={save.error ?? del.error} />
      {row?.rule && (
        <p
          className={fu.ruleNote}
          title="Closes itself once the problem is fixed; marking it done dismisses it while the problem remains."
        >
          <span
            className={fu.tag}
            data-area={FOLLOW_UP_RULES.find((x) => x.code === row.rule)?.area}
          >
            Auto
          </span>
          {followUpRuleLabel(row.rule)} — closes itself when fixed.
        </p>
      )}
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
              <label htmlFor="fu-due">Due</label>
              <input
                id="fu-due"
                type="datetime-local"
                className="form-field-box"
                {...register('dueAt')}
                aria-invalid={!!errors.dueAt}
              />
              <FieldError message={errors.dueAt?.message} />
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
            <div className="form-field-group">
              <label htmlFor="fu-status">Status</label>
              <select id="fu-status" className="form-select-box" {...register('status')}>
                {FOLLOW_UP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
            </div>
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

/**
 * The automatic checks as a dropdown on the tab bar: grouped by area (Import, Export,
 * Containers, CDC), those with open follow-ups first. Picking one shows only its follow-ups;
 * what it looks for is in its tooltip. "Run checks now" runs them without waiting for the schedule.
 */
function RuleChecks({
  active,
  onPick,
}: {
  active: string | undefined;
  onPick: (code: string) => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rules = useQuery({
    queryKey: ['follow-ups', 'rules'],
    queryFn: () => api<FollowUpRuleStatus[]>('/follow-ups/rules'),
  });
  const run = useApiMutation(
    () => api<FollowUpRuleRun>('/follow-ups/rules/run', { method: 'POST' }),
    [['follow-ups'], queryKeys.navCounts, ['meta', 'notifications']],
  );
  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const all = rules.data ?? [];
  const totalOpen = all.reduce((n, r) => n + r.open, 0);
  const pick = (code: string) => {
    onPick(code);
    setOpen(false);
  };
  return (
    <div className={fu.checks}>
      <div className={fu.dropWrap} ref={box}>
        <button
          type="button"
          className={fu.dropBtn}
          aria-expanded={open}
          aria-haspopup="true"
          data-active={!!active}
          onClick={() => setOpen(!open)}
        >
          {active ? followUpRuleLabel(active) : 'Automatic checks'}
          <span className={fu.badge} data-on={totalOpen > 0}>
            {totalOpen}
          </span>
          <span className={fu.caret} aria-hidden="true">
            ▾
          </span>
        </button>
        {active && (
          <button
            type="button"
            className={fu.clearX}
            aria-label="Show all checks"
            title="Show all checks"
            onClick={() => onPick('')}
          >
            ×
          </button>
        )}
        {open && (
          <div className={fu.menu} role="menu" aria-label="Automatic checks">
            {FOLLOW_UP_AREAS.map((area) => {
              const list = all
                .filter((r) => r.area === area)
                .sort((x, y) => Number(y.open > 0) - Number(x.open > 0));
              const n = list.reduce((s, r) => s + r.open, 0);
              return (
                <div key={area} className={fu.area} data-area={area}>
                  <div className={fu.areaHead}>
                    <b>{FOLLOW_UP_AREA_LABEL[area]}</b>
                    <span className={fu.areaCount} data-on={n > 0}>
                      {n}
                    </span>
                  </div>
                  <ul>
                    {list.map((r) => (
                      <li key={r.code}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={active === r.code}
                          className={fu.rule}
                          data-zero={r.open === 0}
                          title={`${r.description} (${r.priority.toLowerCase()} priority)`}
                          onClick={() => pick(active === r.code ? '' : r.code)}
                        >
                          <span className={fu.dot} data-priority={r.priority} aria-hidden="true" />
                          <span className={fu.ruleName}>{r.label}</span>
                          <span className={fu.ruleCount}>{r.open}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {can('followups:write') && (
        <button
          type="button"
          className={fu.runBtn}
          disabled={run.isPending}
          title="The checks also run every 15 minutes and after each shipment or CDC save"
          onClick={() =>
            void run.mutateAsync(undefined).then((r) => {
              const made = r.rules.reduce((n, x) => n + x.created, 0);
              const fixed = r.rules.reduce((n, x) => n + x.resolved, 0);
              toast(
                made || fixed
                  ? `Checks done: ${made} new, ${fixed} closed as fixed.`
                  : 'Checks done: nothing new.',
              );
            })
          }
        >
          {run.isPending ? 'Checking…' : '↻ Run checks now'}
        </button>
      )}
    </div>
  );
}
