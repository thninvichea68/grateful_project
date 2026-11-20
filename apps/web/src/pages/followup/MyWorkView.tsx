import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { FollowUpRow, MyWork } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useFollowUps, useMyWork } from '../../features/admin';
import { ErrorBanner } from '../../components/ui';
import s from './MyWorkView.module.css';

const PP = 'Asia/Phnom_Penh';
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PP }).format(new Date(iso));
const short = (ymd: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
const daysLate = (iso: string) =>
  Math.max(
    1,
    Math.round((Date.parse(day(new Date().toISOString())) - Date.parse(day(iso))) / 864e5),
  );

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width={18}
    height={18}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const ICON = {
  inbox: svg(
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>,
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  ship: svg(
    <>
      <path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6M12 10v4M12 2v3" />
    </>,
  ),
  invoice: svg(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </>,
  ),
  alert: svg(
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4M12 17h.01" />
    </>,
  ),
  chevron: svg(<path d="m9 6 6 6-6 6" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  building: svg(
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </>,
  ),
};

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: PP }).format(
      new Date(),
    ),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * One line of the table: a shipping plan at its current milestone, or a follow-up added by hand
 * (a call, an email to chase…). Both are sorted together by when they are due.
 */
interface Row {
  key: string;
  kind: 'plan' | 'task';
  direction: 'IMPORT' | 'EXPORT' | null;
  clientId: string | null;
  ref: string;
  client: string;
  detail: string;
  stage: string;
  stageSub: string;
  dueAt: string | null;
  late: boolean;
  today: boolean;
  /** Above the due chip: the plan's ETA / ETD, or a task's priority. */
  keyLine: string;
  open: () => void;
}

/** The due chip: Overdue 2d (red), Due today (amber), Due 9 Nov (grey), No date yet. */
function Due({ row }: { row: Row }) {
  if (!row.dueAt) return <span className={`${s.due} ${s.dueNone}`}>No date yet</span>;
  if (row.late)
    return <span className={`${s.due} ${s.dueLate}`}>Overdue {daysLate(row.dueAt)}d</span>;
  if (row.today) return <span className={`${s.due} ${s.dueToday}`}>Due today</span>;
  return <span className={s.due}>Due {short(day(row.dueAt))}</span>;
}

const PRIORITY: Record<FollowUpRow['priority'], string> = {
  HIGH: 'High priority',
  MEDIUM: 'Medium priority',
  LOW: 'Low priority',
};

const Kpi = ({
  tone,
  icon,
  label,
  value,
  sub,
  to,
  onClick,
  active,
}: {
  tone: 'indigo' | 'rose' | 'blue' | 'amber';
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  to?: string | undefined;
  /** The card filters the table below; `active` while that filter is on. */
  onClick?: () => void;
  active?: boolean;
}) => {
  const body = (
    <>
      <span className={s.kpiTop}>
        <span className={s.kpiIcon}>{icon}</span>
        {label}
      </span>
      <span className={s.kpiValue}>{value}</span>
      <span className={s.kpiSub}>{sub}</span>
    </>
  );
  if (onClick)
    return (
      <button
        type="button"
        className={`${s.kpi} ${s.kpiLink} ${active ? s.kpiOn : ''}`}
        data-tone={tone}
        aria-pressed={!!active}
        onClick={onClick}
      >
        {body}
      </button>
    );
  return to ? (
    <Link to={to} className={`${s.kpi} ${s.kpiLink}`} data-tone={tone}>
      {body}
    </Link>
  ) : (
    <div className={s.kpi} data-tone={tone}>
      {body}
    </div>
  );
};

/**
 * Follow Up: one page for everything waiting on operations. Each live shipping plan shows its
 * current milestone (stage) and when it is due, together with the follow-ups added by hand;
 * alerts flag plan dates without actuals and completed jobs not yet invoiced to the client.
 */
export function MyWorkView({
  onOpenTask,
  onAddTask,
}: {
  /** Open a hand-added follow-up to read, edit or complete it. */
  onOpenTask: (row: FollowUpRow) => void;
  /** + Add follow-up; omitted without followups:write. */
  onAddTask?: (() => void) | undefined;
}) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const work = useMyWork();
  // Follow-ups added by hand (shipping-plan milestones are already the plans' stages).
  const tasks = useFollowUps({ status: 'ACTIVE', pageSize: 200 });
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<'' | 'IMPORT' | 'EXPORT' | 'TASK'>('');
  const [clientId, setClientId] = useState('');
  const [all, setAll] = useState(false);
  // ?filter=overdue (the sidebar badge) or today: which rows the table keeps.
  const when = (['overdue', 'today'] as const).find((w) => w === params.get('filter')) ?? '';
  const setWhen = (w: '' | 'overdue' | 'today') =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (w) n.set('filter', w);
        else n.delete('filter');
        return n;
      },
      { replace: true },
    );
  const d: MyWork | undefined = work.data;
  const todayYmd = day(new Date().toISOString());

  const planRows: Row[] = (d?.jobs ?? []).map((j) => ({
    key: j.shipmentId,
    kind: 'plan',
    direction: j.direction,
    clientId: j.clientId,
    ref: j.reference,
    client: j.clientName,
    detail: [j.quantity, j.equipment].filter(Boolean).join(' · ') || '—',
    stage: j.stage,
    stageSub: `${j.stageOwner ?? 'Operator'} · step ${j.stepsDone + 1} of ${j.stepsTotal}`,
    dueAt: j.dueAt,
    late: j.overdue && !j.dueToday,
    today: j.dueToday,
    keyLine: `${j.keyDateLabel} ${j.keyDate ? short(j.keyDate) : '—'}`,
    open: () => navigate(`/plans/${j.shipmentId}`),
  }));
  const taskRows: Row[] = (tasks.data?.data ?? [])
    .filter((f) => !f.milestoneRuleId)
    .map((f) => {
      const today = !!f.dueAt && day(f.dueAt) === todayYmd;
      return {
        key: f.id,
        kind: 'task',
        direction: null,
        clientId: f.clientId,
        ref: f.reference,
        client: f.clientName ?? 'No client',
        detail: f.shipmentReference ?? 'Not linked to a shipment',
        stage: f.subject,
        stageSub: f.assigneeName ?? f.ownerRole ?? 'Unassigned',
        dueAt: f.dueAt,
        late: f.overdue && !today,
        today,
        keyLine: PRIORITY[f.priority],
        open: () => onOpenTask(f),
      };
    });
  const rowsAll = [...planRows, ...taskRows].sort((a, b) =>
    a.dueAt === b.dueAt
      ? a.ref.localeCompare(b.ref)
      : !a.dueAt
        ? 1
        : !b.dueAt
          ? -1
          : a.dueAt.localeCompare(b.dueAt),
  );
  const shown = rowsAll.filter(
    (r) =>
      (!kind || (kind === 'TASK' ? r.kind === 'task' : r.direction === kind)) &&
      (!clientId || r.clientId === clientId) &&
      (when === 'overdue' ? r.late : when === 'today' ? r.today : true),
  );
  const LIMIT = 10;
  const rows = all ? shown : shown.slice(0, LIMIT);
  const overdue = rowsAll.filter((r) => r.late);
  const dueToday = rowsAll.filter((r) => r.today).length;
  const count = (k: typeof kind) =>
    rowsAll.filter((r) => (k === 'TASK' ? r.kind === 'task' : r.direction === k)).length;
  const unbilled = (d?.notInvoiced.import ?? 0) + (d?.notInvoiced.export ?? 0);
  const unbilledDir =
    (d?.notInvoiced.export ?? 0) > (d?.notInvoiced.import ?? 0) ? 'export' : 'import';
  const first = user?.fullName.trim().split(/\s+/).at(-1) ?? '';
  const ready = !!d;
  const fig = (n: number) => (ready ? n.toLocaleString() : '–');
  const arriving = d?.arriving;

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1>
            {greeting()}
            {first ? `, ${first}` : ''}
          </h1>
          <p>
            {d
              ? `${planRows.length} shipping plan${planRows.length === 1 ? '' : 's'} and ${taskRows.length} follow-up${taskRows.length === 1 ? '' : 's'} are waiting on you across ${d.clients.length} client${d.clients.length === 1 ? '' : 's'}.`
              : 'Loading your work…'}
          </p>
        </div>
        <div className={s.headActions}>
          {can('clients:read') && (
            <Link to="/clients" className={s.btnGhost}>
              {ICON.building}
              My clients
            </Link>
          )}
          {onAddTask && (
            <button type="button" className={s.btnAccent} onClick={onAddTask}>
              {ICON.plus}
              Add follow-up
            </button>
          )}
        </div>
      </header>

      <ErrorBanner error={work.error ?? tasks.error} />

      <div className={s.kpis}>
        <Kpi
          tone="indigo"
          icon={ICON.inbox}
          label="Waiting on me"
          value={fig(rowsAll.length)}
          sub={ready ? `${dueToday} due today` : ''}
          onClick={() => {
            setWhen(when === 'today' ? '' : 'today');
            setClientId('');
          }}
          active={when === 'today'}
        />
        <Kpi
          tone="rose"
          icon={ICON.clock}
          label="Overdue"
          value={fig(overdue.length)}
          sub={
            !ready
              ? ''
              : overdue[0]
                ? `${overdue[0].ref} · ${overdue[0].stage}${overdue.length > 1 ? ` +${overdue.length - 1}` : ''}`
                : 'Nothing overdue'
          }
          onClick={() => {
            setWhen(when === 'overdue' ? '' : 'overdue');
            setClientId('');
          }}
          active={when === 'overdue'}
        />
        <Kpi
          tone="blue"
          icon={ICON.ship}
          label="Arriving in 3 days"
          value={fig(arriving?.shipments ?? 0)}
          sub={
            !arriving
              ? ''
              : arriving.shipments
                ? [
                    arriving.containers &&
                      `${arriving.containers} container${arriving.containers === 1 ? '' : 's'}`,
                    arriving.lcl && `${arriving.lcl} LCL`,
                    arriving.air && `${arriving.air} air`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Imports due at port'
                : 'No imports due at port'
          }
        />
        <Kpi
          tone="amber"
          icon={ICON.invoice}
          label="Not invoiced to client"
          value={fig(unbilled)}
          sub={
            d
              ? unbilled
                ? `${d.notInvoiced.import} import · ${d.notInvoiced.export} export · completed`
                : 'Every completed job invoiced'
              : ''
          }
          to={unbilled ? `/plans/${unbilledDir}?billing=UNBILLED&month=all` : undefined}
        />
      </div>

      <div className={s.grid}>
        <section className={s.panel} aria-labelledby="mw-jobs">
          <header className={s.panelHead}>
            <div>
              <h2 id="mw-jobs">
                {when === 'overdue' ? 'Overdue' : when === 'today' ? 'Due today' : 'Waiting on me'}
                {clientId && ` · ${d?.clients.find((c) => c.id === clientId)?.code ?? ''}`}
              </h2>
              <p>
                {shown.length} of {rowsAll.length} · plans at their current stage and follow-ups ·
                by due date
                {(when || clientId) && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className={s.linkBtn}
                      onClick={() => {
                        setWhen('');
                        setClientId('');
                      }}
                    >
                      Show all
                    </button>
                  </>
                )}
              </p>
            </div>
            <div className={s.chips} role="group" aria-label="Show">
              {(
                [
                  ['', 'All', rowsAll.length],
                  ['IMPORT', 'Import', count('IMPORT')],
                  ['EXPORT', 'Export', count('EXPORT')],
                  ['TASK', 'Follow-ups', count('TASK')],
                ] as const
              ).map(([v, label, n]) => (
                <button
                  key={label}
                  type="button"
                  className={kind === v ? s.chipOn : s.chip}
                  aria-pressed={kind === v}
                  onClick={() => setKind(v)}
                >
                  {label} {ready ? n : ''}
                </button>
              ))}
            </div>
          </header>
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Client / cargo</th>
                  <th>Stage / task</th>
                  <th>Due</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {work.isLoading && (
                  <tr>
                    <td colSpan={5} className={s.empty}>
                      Loading your work…
                    </td>
                  </tr>
                )}
                {ready && shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className={s.empty}>
                      {when === 'overdue'
                        ? 'Nothing overdue. Everything is on time.'
                        : when === 'today'
                          ? 'Nothing due today.'
                          : 'Nothing waiting on you.'}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    tabIndex={0}
                    onClick={r.open}
                    onKeyDown={(e) => e.key === 'Enter' && r.open()}
                  >
                    <td>
                      <div className={s.ref}>{r.ref}</div>
                      <span
                        className={
                          r.kind === 'task'
                            ? s.tagTask
                            : r.direction === 'IMPORT'
                              ? s.tagImport
                              : s.tagExport
                        }
                      >
                        {r.kind === 'task'
                          ? 'Follow-up'
                          : r.direction === 'IMPORT'
                            ? 'Import'
                            : 'Export'}
                      </span>
                    </td>
                    <td>
                      <div className={s.main}>{r.client}</div>
                      <div className={s.sub}>{r.detail}</div>
                    </td>
                    <td>
                      <div className={s.main}>{r.stage}</div>
                      <div className={`${s.sub} ${r.late ? s.subLate : r.today ? s.subToday : ''}`}>
                        {r.stageSub}
                      </div>
                    </td>
                    <td>
                      <div className={s.sub}>{r.keyLine}</div>
                      <Due row={r} />
                    </td>
                    <td className={s.chev}>{ICON.chevron}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > LIMIT && (
            <button type="button" className={s.more} onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${shown.length}`}
            </button>
          )}
        </section>

        <aside className={s.side}>
          <section className={s.panel} aria-labelledby="mw-alerts">
            <header className={s.panelHead}>
              <div>
                <h2 id="mw-alerts">Alerts</h2>
                <p>Checks the system found on your shipping plans</p>
              </div>
              {d && d.alerts.length > 0 && <span className={s.count}>{d.alerts.length}</span>}
            </header>
            <ul className={s.alerts}>
              {d && d.alerts.length === 0 && <li className={s.empty}>No alerts. All clear.</li>}
              {d?.alerts.map((a, i) => {
                const to = a.shipmentId
                  ? `/plans/${a.shipmentId}`
                  : `/plans/${unbilledDir}?billing=UNBILLED&month=all`;
                return (
                  <li key={i}>
                    <Link to={to} className={s.alert} data-severity={a.severity}>
                      <span className={s.alertIcon}>{ICON.alert}</span>
                      <span>
                        <span className={s.main}>{a.title}</span>
                        <span className={s.sub}>{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={s.panel} aria-labelledby="mw-clients">
            <header className={s.panelHead}>
              <div>
                <h2 id="mw-clients">My clients</h2>
                <p>
                  {d
                    ? `${d.clients.length} with live jobs · ${d.clients.filter((c) => c.overdue).length} need attention`
                    : ''}
                </p>
              </div>
            </header>
            <ul className={s.clients}>
              {d && d.clients.length === 0 && (
                <li className={s.empty}>No clients with live jobs.</li>
              )}
              {d?.clients.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`${s.client} ${clientId === c.id ? s.clientOn : ''}`}
                    aria-pressed={clientId === c.id}
                    title={`Show ${c.code}'s jobs`}
                    onClick={() => setClientId(clientId === c.id ? '' : c.id)}
                  >
                    <span className={s.avatar}>{c.code.slice(0, 3)}</span>
                    <span className={s.clientText}>
                      <span className={s.main}>{c.name}</span>
                      <span className={s.sub}>
                        {c.activeJobs} active job{c.activeJobs === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className={c.overdue ? s.tagLate : s.tagOk}>
                      {c.overdue ? `${c.overdue} overdue` : 'On track'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
