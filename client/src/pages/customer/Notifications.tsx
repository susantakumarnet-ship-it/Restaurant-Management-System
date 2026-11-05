import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import type { Notification } from '../../lib/types';
import { useApi } from '../../hooks/useApi';
import { Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { AccountNav } from './AccountNav';

export default function Notifications() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi<{ items: Notification[]; unread: number }>(() => api.get('/customer/notifications'), []);
  const open = async (n: Notification) => {
    if (!n.is_read) await api.post(`/customer/notifications/${n.id}/read`).catch(() => {});
    if (n.link) nav(n.link);
    else reload();
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <AccountNav />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Notifications</h1>
        {!!data?.unread && (
          <Button variant="secondary" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={async () => (await api.post('/customer/notifications/read-all'), reload())}>
            Mark all read
          </Button>
        )}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !data?.items.length ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications yet" description="Booking confirmations, order updates and payment receipts will appear here." />
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {data.items.map((n) => (
            <button key={n.id} onClick={() => open(n)} className={clsx('flex w-full gap-3 px-5 py-4 text-left transition hover:bg-ink-50', !n.is_read && 'bg-brand-50/50')}>
              <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-brand-600')} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{n.title}</p>
                <p className="text-sm text-ink-600">{n.message}</p>
                <p className="mt-1 text-xs text-ink-400">{fmtDateTime(n.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
