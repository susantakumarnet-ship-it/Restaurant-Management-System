import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import clsx from 'clsx';
import { api, adminApi } from '../lib/api';
import { timeAgo } from '../lib/format';
import type { Notification } from '../lib/types';
import { usePolling } from '../hooks/useApi';

/** Bell with unread badge + dropdown. scope 'admin' = branch feed, 'customer' = personal feed. */
export function NotificationBell({ scope, dark }: { scope: 'admin' | 'customer'; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Notification[]; unread: number }>({ items: [], unread: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const client = scope === 'admin' ? adminApi : { get: (p: string) => api.get(`/customer${p}`), post: (p: string) => api.post(`/customer${p}`) };

  const load = () => client.get('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  usePolling(load, 30000);

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const openItem = async (n: Notification) => {
    setOpen(false);
    if (!n.is_read) await client.post(`/notifications/${n.id}/read`).catch(() => {});
    load();
    if (n.link) nav(n.link);
  };
  const readAll = async () => {
    await client.post('/notifications/read-all').catch(() => {});
    load();
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={clsx('relative rounded-full p-2 transition', dark ? 'text-ink-200 hover:bg-white/10' : 'text-ink-600 hover:bg-ink-100')} aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {data.unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <span className="font-semibold text-ink-900">Notifications</span>
            {data.unread > 0 && (
              <button onClick={readAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-500">You're all caught up.</p>
            ) : (
              data.items.slice(0, 12).map((n) => (
                <button key={n.id} onClick={() => openItem(n)} className={clsx('block w-full border-b border-ink-50 px-4 py-3 text-left transition hover:bg-ink-50', !n.is_read && 'bg-brand-50/50')}>
                  <div className="flex items-start gap-2">
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">{n.title}</p>
                      <p className="line-clamp-2 text-xs text-ink-600">{n.message}</p>
                      <p className="mt-1 text-[11px] text-ink-400">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          <Link to={scope === 'admin' ? '/admin/notifications' : '/my/notifications'} onClick={() => setOpen(false)} className="block bg-ink-50 py-2 text-center text-xs font-medium text-ink-600 hover:text-ink-900">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
