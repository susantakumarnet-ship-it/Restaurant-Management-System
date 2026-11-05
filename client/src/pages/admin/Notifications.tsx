import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, CreditCard, Mail, MessageCircle, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { fmtDateTime, timeAgo, titleCase } from '../../lib/format';
import type { Notification } from '../../lib/types';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, Tabs } from '../../components/ui';

interface OutboxRow {
  id: number;
  channel: string;
  type: string;
  title: string;
  recipient: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

function Integrations() {
  const { integrations } = useAdmin();
  const items = [
    { label: 'Payments', icon: CreditCard, value: integrations.payments, ok: integrations.payments === 'razorpay', note: integrations.payments === 'razorpay' ? 'Razorpay live checkout' : 'Mock gateway (test mode)' },
    { label: 'Email', icon: Mail, value: integrations.email, ok: integrations.email !== 'log', note: integrations.email === 'smtp' ? 'SMTP configured' : 'Logged only' },
    { label: 'SMS', icon: Smartphone, value: integrations.sms, ok: integrations.sms !== 'log', note: integrations.sms === 'twilio' ? 'Twilio configured' : 'Logged only' },
    { label: 'WhatsApp', icon: MessageCircle, value: integrations.whatsapp, ok: integrations.whatsapp !== 'disabled', note: integrations.whatsapp === 'disabled' ? 'Not configured' : 'Meta Cloud API' },
  ];
  return (
    <Card title="Integration status" className="mb-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3">
            <div className={clsx('flex h-9 w-9 items-center justify-center rounded-lg', i.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
              <i.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">{i.label}</p>
              <p className="text-xs text-ink-500">{i.note}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-500">
        <strong>"Logged"</strong> means messages are recorded in the delivery log (and printed in the server console) but not sent to customers until provider credentials are configured in the server environment (SMTP_*, TWILIO_*, WHATSAPP_*, RAZORPAY_*).
      </p>
    </Card>
  );
}

function Inbox() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi<{ items: Notification[]; unread: number }>(() => adminApi.get('/notifications'), []);
  const open = async (n: Notification) => {
    if (!n.is_read) await adminApi.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.link) nav(n.link);
    else reload();
  };
  const readAll = async () => {
    try {
      await adminApi.post('/notifications/read-all');
      toast.success('All notifications marked as read');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  return (
    <Card
      padded={false}
      title={`Inbox${data?.unread ? ` (${data.unread} unread)` : ''}`}
      actions={data?.unread ? <Button size="sm" variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={readAll}>Mark all read</Button> : null}
    >
      {!data?.items.length ? (
        <EmptyState title="No notifications" description="New bookings, orders, payments and stock alerts will show up here." />
      ) : (
        <ul className="divide-y divide-ink-100">
          {data.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => open(n)} className={clsx('flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-ink-50', !n.is_read && 'bg-brand-50/40')}>
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-ink-200' : 'bg-brand-600')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{n.title}</p>
                    <Badge tone="gray">{titleCase(n.type)}</Badge>
                  </div>
                  <p className="text-sm text-ink-600">{n.message}</p>
                </div>
                <span className="shrink-0 text-xs text-ink-400">{timeAgo(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Outbox() {
  const { data, loading, error, reload } = useApi<OutboxRow[]>(() => adminApi.get('/notifications/outbox'), []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <DataTable<OutboxRow>
      rows={data}
      loading={loading}
      toolbar={<Button size="sm" variant="secondary" onClick={reload}>Refresh</Button>}
      columns={[
        { key: 'created_at', header: 'Time', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</span> },
        { key: 'channel', header: 'Channel', render: (r) => <Badge tone={r.channel === 'email' ? 'blue' : r.channel === 'sms' ? 'purple' : 'green'}>{titleCase(r.channel)}</Badge> },
        { key: 'title', header: 'Message', render: (r) => <div><p className="font-medium text-ink-900">{r.title}</p><p className="text-xs text-ink-500">{titleCase(r.type)}</p></div> },
        { key: 'recipient', header: 'Recipient', hideOnMobile: true },
        { key: 'status', header: 'Status', render: (r) => <div><StatusBadge status={r.status} />{r.error && <p className="mt-1 max-w-[14rem] text-xs text-red-600">{r.error}</p>}</div> },
      ]}
    />
  );
}

export default function Notifications() {
  const { hasPerm } = useAuth();
  // GET /admin/notifications/outbox requires reservations.manage or orders.manage
  const canOutbox = hasPerm('reservations.manage', 'orders.manage');
  const [tab, setTab] = useState<'inbox' | 'outbox'>('inbox');
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Branch alerts and the outbound email / SMS / WhatsApp delivery log." />
      <Integrations />
      {canOutbox && <Tabs className="mb-4 w-fit" value={tab} onChange={setTab} tabs={[{ value: 'inbox', label: 'Inbox' }, { value: 'outbox', label: 'Delivery log' }]} />}
      {tab === 'outbox' && canOutbox ? <Outbox /> : <Inbox />}
    </div>
  );
}
