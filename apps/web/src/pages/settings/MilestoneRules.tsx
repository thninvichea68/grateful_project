import { useEffect, useState } from 'react';
import { MILESTONE_MODES, type MilestoneRule } from '@gs/shared';
import { useApiMutation, useMilestoneRules } from '../../features/admin';
import { ErrorBanner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';

type Draft = Pick<
  MilestoneRule,
  'offsetValue' | 'offsetUnit' | 'ownerRole' | 'remindBefore' | 'escalateAfter' | 'active'
>;

const LABEL: Record<(typeof MILESTONE_MODES)[number], string> = {
  SEA_IMPORT: 'Sea import',
  SEA_EXPORT: 'Sea export',
  AIR_IMPORT: 'Air import',
  AIR_EXPORT: 'Air export',
};

const toDraft = (rule: MilestoneRule): Draft => ({
  offsetValue: rule.offsetValue,
  offsetUnit: rule.offsetUnit,
  ownerRole: rule.ownerRole,
  remindBefore: rule.remindBefore,
  escalateAfter: rule.escalateAfter,
  active: rule.active,
});

export function MilestoneRules({ manage }: { manage: boolean }) {
  const list = useMilestoneRules();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const save = useApiMutation(
    ({ id, values }: { id: string; values: Draft }) =>
      api(`/settings/milestone-rules/${id}`, { method: 'PATCH', json: values }),
    [['settings', 'milestone-rules'], ['follow-ups']],
  );

  useEffect(() => {
    if (list.data) setDrafts(Object.fromEntries(list.data.map((rule) => [rule.id, toDraft(rule)])));
  }, [list.data]);

  const update = (id: string, field: keyof Draft, value: string | number | boolean) =>
    setDrafts((current) => {
      const rule = list.data?.find((item) => item.id === id);
      if (!rule) return current;
      return { ...current, [id]: { ...(current[id] ?? toDraft(rule)), [field]: value } };
    });

  const submit = async (rule: MilestoneRule) => {
    await save.mutateAsync({ id: rule.id, values: drafts[rule.id] ?? toDraft(rule) });
    toast(`${rule.name} rule saved.`);
  };

  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h3>Shipment milestone rules</h3>
          <p className="create-header-desc">
            Adjust suggested calendar-day offsets and owners. Open milestones re-plan when shipment
            dates or these rules change.
          </p>
        </div>
      </div>
      <ErrorBanner error={list.error ?? save.error} />
      {list.isLoading && <p role="status">Loading milestone rules…</p>}
      {MILESTONE_MODES.map((mode) => {
        const rows = list.data?.filter((rule) => rule.mode === mode) ?? [];
        if (!rows.length) return null;
        return (
          <section key={mode} style={{ marginTop: 18 }}>
            <h4>{LABEL[mode]}</h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table-clean" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th>Milestone</th>
                    <th>Anchor</th>
                    <th>Offset</th>
                    <th>Owner</th>
                    <th>Remind (hours)</th>
                    <th>Escalate (days)</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((rule) => {
                    const draft = drafts[rule.id] ?? toDraft(rule);
                    return (
                      <tr key={rule.id}>
                        <td>{rule.name}</td>
                        <td>{rule.anchorCode.replace('MILESTONE:', '').replaceAll('_', ' ')}</td>
                        <td>
                          <input
                            className="form-field-box"
                            type="number"
                            min={-365}
                            max={365}
                            value={draft.offsetValue}
                            disabled={!manage}
                            aria-label={`Offset for ${rule.name}`}
                            onChange={(event) =>
                              update(rule.id, 'offsetValue', Number(event.target.value))
                            }
                            style={{ width: 76 }}
                          />{' '}
                          <select
                            className="form-select-box"
                            value={draft.offsetUnit}
                            disabled={!manage}
                            aria-label={`Offset unit for ${rule.name}`}
                            onChange={(event) => update(rule.id, 'offsetUnit', event.target.value)}
                          >
                            <option value="DAYS">days</option>
                            <option value="HOURS">hours</option>
                          </select>
                        </td>
                        <td>
                          <input
                            className="form-field-box"
                            value={draft.ownerRole}
                            disabled={!manage}
                            aria-label={`Owner for ${rule.name}`}
                            onChange={(event) => update(rule.id, 'ownerRole', event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="form-field-box"
                            type="number"
                            min={0}
                            max={720}
                            value={draft.remindBefore}
                            disabled={!manage}
                            aria-label={`Reminder lead time for ${rule.name}`}
                            onChange={(event) =>
                              update(rule.id, 'remindBefore', Number(event.target.value))
                            }
                            style={{ width: 90 }}
                          />
                        </td>
                        <td>
                          <input
                            className="form-field-box"
                            type="number"
                            min={0}
                            max={720}
                            value={draft.escalateAfter}
                            disabled={!manage}
                            aria-label={`Escalation delay for ${rule.name}`}
                            onChange={(event) =>
                              update(rule.id, 'escalateAfter', Number(event.target.value))
                            }
                            style={{ width: 90 }}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={draft.active}
                            disabled={!manage}
                            aria-label={`${rule.active ? 'Disable' : 'Enable'} ${rule.name}`}
                            onChange={(event) => update(rule.id, 'active', event.target.checked)}
                          />
                        </td>
                        <td>
                          {manage && (
                            <button
                              type="button"
                              className="btn-create-submit"
                              disabled={save.isPending}
                              onClick={() => void submit(rule)}
                            >
                              Save
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
