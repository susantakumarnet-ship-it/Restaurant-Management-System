import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Mail, Phone, Search, Star } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { fmtDate, fmtDateTime, fmtTime, money, titleCase } from '../../lib/format';
import { Button, DataTable, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, StatCard, StatusBadge, Stars, Tabs, Textarea, useConfirm, type Column } from '../../components/ui';

export default function Customers() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error, reload } = useApi<any[]>(() => adminApi.get('/customers', { q: debounced, status }), [debounced, status]);
  const [openId, setOpenId] = useState<number | null>(null);

  const columns: Column<any>[] = [
    {
      key: 'name',
      header: 'Customer',
      value: (c) => `${c.name} ${c.email}`,
      render: (c) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{c.name[0]}</span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{c.name}</p>
            <p className="truncate text-xs text-ink-500">{c.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', hideOnMobile: true },
    { key: 'bookings', header: 'Bookings', align: 'center' },
    { key: 'orders', header: 'Orders', align: 'center' },
    { key: 'total_spent', header: 'Spent', align: 'right', render: (c) => <span className="font-semibold">{money(c.total_spent)}</span> },
    { key: 'loyalty_points', header: 'Points', align: 'center', hideOnMobile: true },
    { key: 'last_visit', header: 'Last visit', hideOnMobile: true, render: (c) => (c.last_visit ? fmtDate(c.last_visit.slice(0, 10)) : '-') },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Customers" subtitle="Guests who have booked, ordered or reviewed at your restaurant" />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={data}
          loading={loading}
          columns={columns}
          searchable={false}
          initialSort={{ key: 'total_spent', dir: 'desc' }}
          onRowClick={(c) => setOpenId(c.id)}
          toolbar={
            <div className="flex w-full flex-wrap gap-2">
              <Input className="w-full sm:w-72" icon={<Search className="h-4 w-4" />} placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={[{ value: 'active', label: 'Active' }, { value: 'blocked', label: 'Blocked' }]} />
            </div>
          }
        />
      )}
      {openId && <CustomerDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function CustomerDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { hasPerm } = useAuth();
  const canManage = hasPerm('customers.manage');
  const { data: c, loading, error, reload } = useApi<any>(() => adminApi.get(`/customers/${id}`), [id]);
  const [tab, setTab] = useState<'bookings' | 'orders' | 'reviews'>('bookings');
  const [points, setPoints] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    if (c) {
      setPoints(String(c.loyalty_points));
      setNotes(c.notes || '');
    }
  }, [c]);

  const patch = async (body: Record<string, any>, msg: string) => {
    setSaving(true);
    try {
      await adminApi.patch(`/customers/${id}`, body);
      toast.success(msg);
      reload();
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  const toggleBlock = async () => {
    const block = c.status !== 'blocked';
    const { ok } = await confirm({ title: block ? `Block ${c.name}?` : `Unblock ${c.name}?`, message: block ? 'Blocked customers cannot log in, book or order.' : undefined, danger: block, confirmText: block ? 'Block' : 'Unblock' });
    if (ok) patch({ status: block ? 'blocked' : 'active' }, block ? 'Customer blocked' : 'Customer unblocked');
  };

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={c ? <span className="flex items-center gap-2">{c.name} <StatusBadge status={c.status} /></span> : 'Customer'}>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !c ? (
        <Spinner />
      ) : c ? (
        <div className="space-y-5">
          <div className="space-y-1 text-sm text-ink-700">
            <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-ink-400" /> {c.email}</p>
            {c.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-400" /> {c.phone}</p>}
            <p className="text-xs text-ink-500">
              Registered {fmtDate(c.registered_at)} · Last login {c.last_login_at ? fmtDateTime(c.last_login_at) : 'never'}
              {c.date_of_birth ? ` · Birthday ${fmtDate(c.date_of_birth, { day: 'numeric', month: 'short' })}` : ''}
              {c.anniversary ? ` · Anniversary ${fmtDate(c.anniversary, { day: 'numeric', month: 'short' })}` : ''}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Spent here" value={money(c.restaurant_spent, { decimals: false })} />
            <StatCard label="Bookings" value={c.bookings.length} />
            <StatCard label="Orders" value={c.orders.length} />
            <StatCard label="Points" value={c.loyalty_points} tone="purple" />
          </div>

          {canManage && (
            <div className="space-y-3 rounded-xl border border-ink-200 p-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Loyalty points" className="w-32"><Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
                <Button size="sm" variant="secondary" loading={saving} disabled={points === String(c.loyalty_points) || Number(points) < 0} onClick={() => patch({ loyalty_points: Number(points) }, 'Loyalty points updated')}>
                  Update points
                </Button>
                <Button size="sm" variant={c.status === 'blocked' ? 'success' : 'danger'} className="ml-auto" icon={c.status === 'blocked' ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />} onClick={toggleBlock}>
                  {c.status === 'blocked' ? 'Unblock' : 'Block'}
                </Button>
              </div>
              <Field label="Internal notes">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Preferences, allergies, VIP notes..." />
              </Field>
              <Button size="sm" variant="secondary" loading={saving} disabled={notes === (c.notes || '')} onClick={() => patch({ notes }, 'Notes saved')}>Save notes</Button>
            </div>
          )}

          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'bookings', label: 'Bookings', count: c.bookings.length }, { value: 'orders', label: 'Orders', count: c.orders.length }, { value: 'reviews', label: 'Feedback', count: c.reviews.length }]} />
          {tab === 'bookings' &&
            (c.bookings.length ? (
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 text-sm">
                {c.bookings.map((b: any) => (
                  <li key={b.id}>
                    <a href={`/admin/reservations?id=${b.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-ink-50">
                      <span><span className="font-mono text-xs font-semibold">{b.booking_code}</span><span className="block text-xs text-ink-500">{fmtDate(b.booking_date)} {fmtTime(b.start_at)} · {b.guests} guests · {b.branch_name}</span></span>
                      <StatusBadge status={b.status} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No bookings" />)}
          {tab === 'orders' &&
            (c.orders.length ? (
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 text-sm">
                {c.orders.map((o: any) => (
                  <li key={o.id}>
                    <a href={`/admin/orders?id=${o.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-ink-50">
                      <span><span className="font-mono text-xs font-semibold">{o.order_code}</span><span className="block text-xs text-ink-500">{fmtDateTime(o.created_at)} · {titleCase(o.order_type)}</span></span>
                      <span className="flex items-center gap-2 font-medium">{money(o.total)} <StatusBadge status={o.status} /></span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No orders" />)}
          {tab === 'reviews' &&
            (c.reviews.length ? (
              <ul className="space-y-3">
                {c.reviews.map((r: any) => (
                  <li key={r.id} className="rounded-xl border border-ink-200 p-3 text-sm">
                    <div className="flex items-center justify-between"><Stars value={r.rating} /><span className="text-xs text-ink-500">{fmtDate(r.created_at)}</span></div>
                    {r.food_name && <p className="mt-1 text-xs font-medium text-brand-700">{r.food_name}</p>}
                    <p className="mt-1 text-ink-700">{r.comment || <span className="italic text-ink-400">No comment</span>}</p>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={<Star className="h-6 w-6" />} title="No feedback yet" />)}
        </div>
      ) : null}
    </Drawer>
  );
}
