import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { followUpRuleLabel, type NotificationItem } from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { icons } from './icons';
import { useNavCounts } from './useNavCounts';
import n from './NotificationBell.module.css';

const PP = 'Asia/Phnom_Penh';
/** "5m ago", "3h ago", "2d ago", or a date for older ones. */
function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return `${Math.round(mins / 1440)}d ago`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: PP, day: '2-digit', month: 'short' }).format(
    new Date(iso),
  );
}

/**
 * The top-bar bell: follow-ups raised by the automatic checks or added by hand, newest first.
 * The badge counts alerts raised or gone overdue since the list was last opened; opening it
 * marks them read.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const counts = useNavCounts();
  const unread = counts.data?.unreadNotifications ?? 0;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useQuery({
    queryKey: ['meta', 'notifications'],
    queryFn: () => api<NotificationItem[]>('/meta/notifications'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Once the list has loaded, everything in it counts as seen (it still shows as new this time).
  useEffect(() => {
    if (!open || !list.data || unread === 0) return;
    void api('/meta/notifications/seen', { method: 'POST' }).then(() =>
      qc.invalidateQueries({ queryKey: queryKeys.navCounts }),
    );
  }, [open, list.data, unread, qc]);

  const go = (item: NotificationItem) => {
    setOpen(false);
    if (item.rule?.startsWith('SEAL_PLAN_'))
      navigate(`/seal-plans?q=${encodeURIComponent(item.shipmentReference ?? '')}`);
    else if (item.shipmentId) navigate(`/plans/${item.shipmentId}`);
    else if (item.rule === 'CDC_OVER_IMPORTED') navigate('/cutstock');
    else navigate(`/followup?q=${encodeURIComponent(item.reference)}`);
  };

  return (
    <div className={n.wrap} ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `${unread} new alerts` : 'Alerts'}
        onClick={() => setOpen((o) => !o)}
      >
        {icons.bell({})}
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className={n.panel} role="dialog" aria-label="Alerts">
          <div className={n.head}>
            <b>Alerts</b>
            <span>{list.data ? `${list.data.length} open` : ''}</span>
          </div>
          {list.isLoading && <p className={n.note}>Loading…</p>}
          {list.data?.length === 0 && (
            <p className={n.note}>Nothing to follow up. The checks run every 15 minutes.</p>
          )}
          <ul className={n.list}>
            {list.data?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={n.item}
                  data-unread={item.unread}
                  data-priority={item.priority}
                  onClick={() => go(item)}
                >
                  <span className={n.dot} aria-hidden="true" />
                  <span className={n.body}>
                    <span className={n.subject}>{item.subject}</span>
                    <span className={n.meta}>
                      {followUpRuleLabel(item.rule) ?? 'Follow-up'}
                      {item.clientName ? ` · ${item.clientName}` : ''}
                    </span>
                  </span>
                  <span className={n.when} data-overdue={item.overdue}>
                    {item.overdue ? 'Overdue' : ago(item.alertAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={n.footer}
            onClick={() => {
              setOpen(false);
              navigate('/followup');
            }}
          >
            View all follow-ups
          </button>
        </div>
      )}
    </div>
  );
}
