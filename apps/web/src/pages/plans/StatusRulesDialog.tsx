import { useState } from 'react';
import {
  COMPLETION_MILESTONE_LABEL,
  COMPLETION_MILESTONES,
  DEFAULT_COMPLETION,
  type ClientStatusRule,
  type CompletionMilestone,
  type Direction,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorBanner, Modal } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useSaveStatusRule, useStatusRules } from '../../features/hooks';
import m from './StatusRulesDialog.module.css';

const HINT: Record<CompletionMilestone, string> = {
  ATD: 'The ship or flight has actually left',
  ATA: 'It has actually arrived at the port',
  ARRIVE_FTY: 'It has reached the factory',
  DO_DATE: 'The delivery order (DO / EDO) is dated',
  DOCS_RECEIVED: 'The shipping documents were received',
  CLEARED: 'A declaration has its number and date',
};

const DIRS: { key: Direction; field: 'importCompleteOn' | 'exportCompleteOn'; label: string }[] = [
  { key: 'IMPORT', field: 'importCompleteOn', label: 'Import' },
  { key: 'EXPORT', field: 'exportCompleteOn', label: 'Export' },
];

/** The milestones in effect: the client's own, or the default for that direction. */
const effective = (r: ClientStatusRule, d: (typeof DIRS)[number]) =>
  r[d.field]?.length ? r[d.field]! : [...DEFAULT_COMPLETION[d.key]];

/**
 * Shipping Plans → ⋯ → Status rules: for each client, what has to be in before its imports and
 * exports count as Completed (e.g. JR's exports on their ATD, another client's once cleared too).
 */
export function StatusRulesDialog({ onClose }: { onClose: () => void }) {
  const rules = useStatusRules();
  const { can } = useAuth();
  const editable = can('clients:write');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Modal
      title="Shipment status rules"
      sub="Choose, for each client, what has to be filled in before a shipment counts as Completed. When several are ticked, all of them are needed. Before that it is In Progress once a declaration is recorded, otherwise Pending."
      onClose={onClose}
      width={880}
    >
      {rules.error && <ErrorBanner error={rules.error} />}
      {rules.isLoading ? (
        <p className={m.note}>Loading…</p>
      ) : (
        <div className={m.tableWrap}>
          <table className={m.table}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Import completed when</th>
                <th>Export completed when</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rules.data?.map((r) =>
                editing === r.clientId ? (
                  <RuleEditor key={r.clientId} rule={r} onDone={() => setEditing(null)} />
                ) : (
                  <tr key={r.clientId} className={r.status === 'INACTIVE' ? m.inactive : undefined}>
                    <td>
                      <b className={m.code}>{r.code}</b>
                      <span className={m.name}>{r.name}</span>
                    </td>
                    {DIRS.map((d) => (
                      <td key={d.key}>
                        <Summary rule={r} dir={d} />
                      </td>
                    ))}
                    <td className={m.actionCell}>
                      {editable && (
                        <button
                          type="button"
                          className="filter-btn"
                          disabled={!!editing}
                          onClick={() => setEditing(r.clientId)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {!editable && (
        <p className={m.note}>Only users who can edit clients can change these rules.</p>
      )}
      <div className={m.actions}>
        <button type="button" className="filter-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function Summary({ rule, dir }: { rule: ClientStatusRule; dir: (typeof DIRS)[number] }) {
  const own = !!rule[dir.field]?.length;
  return (
    <div className={m.pills}>
      {effective(rule, dir).map((k) => (
        <span key={k} className={own ? m.pillOn : m.pill} title={HINT[k]}>
          {COMPLETION_MILESTONE_LABEL[k]}
        </span>
      ))}
      {!own && <small className={m.default}>default</small>}
    </div>
  );
}

function RuleEditor({ rule, onDone }: { rule: ClientStatusRule; onDone: () => void }) {
  const toast = useToast();
  const save = useSaveStatusRule();
  const [draft, setDraft] = useState<Record<Direction, CompletionMilestone[]>>({
    IMPORT: effective(rule, DIRS[0]!),
    EXPORT: effective(rule, DIRS[1]!),
  });
  const toggle = (d: Direction, k: CompletionMilestone) =>
    setDraft((v) => ({
      ...v,
      [d]: v[d].includes(k) ? v[d].filter((x) => x !== k) : [...v[d], k],
    }));
  // A rule that matches the default is stored as "use the default", so it follows any change to it.
  const asStored = (d: Direction) => {
    const def = DEFAULT_COMPLETION[d];
    const v = draft[d];
    return v.length === def.length && v.every((k) => def.includes(k)) ? null : v;
  };
  const empty = DIRS.find((d) => !draft[d.key].length);

  const submit = async () => {
    try {
      await save.mutateAsync({
        clientId: rule.clientId,
        body: { importCompleteOn: asStored('IMPORT'), exportCompleteOn: asStored('EXPORT') },
      });
      toast(`${rule.code} status rules saved; its shipments were updated.`);
      onDone();
    } catch {
      // Shown by the banner below.
    }
  };

  return (
    <tr className={m.editRow}>
      <td>
        <b className={m.code}>{rule.code}</b>
        <span className={m.name}>{rule.name}</span>
      </td>
      {DIRS.map((d) => (
        <td key={d.key}>
          <div className={m.choices} role="group" aria-label={`${d.label} completed when`}>
            {COMPLETION_MILESTONES.map((k) => (
              <label key={k} className={m.choice} title={HINT[k]}>
                <input
                  type="checkbox"
                  checked={draft[d.key].includes(k)}
                  onChange={() => toggle(d.key, k)}
                />
                <span>{COMPLETION_MILESTONE_LABEL[k]}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className={m.reset}
            onClick={() => setDraft((v) => ({ ...v, [d.key]: [...DEFAULT_COMPLETION[d.key]] }))}
          >
            Use default (
            {DEFAULT_COMPLETION[d.key].map((k) => COMPLETION_MILESTONE_LABEL[k]).join(', ')})
          </button>
        </td>
      ))}
      <td className={m.actionCell}>
        <div className={m.editActions}>
          <button
            type="button"
            className="new-shipment-btn"
            disabled={!!empty || save.isPending}
            title={empty ? `Tick at least one for ${empty.label}` : undefined}
            onClick={() => void submit()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="filter-btn" disabled={save.isPending} onClick={onDone}>
            Cancel
          </button>
        </div>
        {save.error && <ErrorBanner error={save.error} />}
      </td>
    </tr>
  );
}
