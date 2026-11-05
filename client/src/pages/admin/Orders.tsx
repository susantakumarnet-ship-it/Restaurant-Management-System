import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ChefHat, Clock, Minus, Plus, RefreshCw, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import { adminApi, api } from '../../lib/api';
import { useApi, usePolling } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { fmtDateTime, money, timeAgo, titleCase } from '../../lib/format';
import type { FoodItem, Order, Quote } from '../../lib/types';
import { Button, DataTable, DietDot, EmptyState, ErrorState, Field, Img, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea, useConfirm, type Column } from '../../components/ui';
import { OrderDrawer } from './components/OrderDrawer';

const COLUMNS = [
  { key: 'pending', label: 'New', tone: 'border-t-amber-500' },
  { key: 'confirmed', label: 'Confirmed', tone: 'border-t-sky-500' },
  { key: 'preparing', label: 'Preparing', tone: 'border-t-orange-500' },
  { key: 'ready', label: 'Ready', tone: 'border-t-teal-500' },
  { key: 'done', label: 'Served / Delivered', tone: 'border-t-violet-500' },
];

/** Next forward step per ORDER_TRANSITIONS (server enforces the same rules). */
function nextStep(o: Order): { status: string; label: string } | null {
  switch (o.status) {
    case 'pending': return { status: 'confirmed', label: 'Confirm' };
    case 'confirmed': return { status: 'preparing', label: 'Start preparing' };
    case 'preparing': return { status: 'ready', label: 'Mark ready' };
    case 'ready':
      return o.order_type === 'dine_in' ? { status: 'served', label: 'Mark served' } : o.order_type === 'delivery' ? { status: 'delivered', label: 'Mark delivered' } : { status: 'completed', label: 'Picked up' };
    case 'served':
    case 'delivered': return { status: 'completed', label: 'Complete' };
    default: return null;
  }
}
const cancellable = (s: string) => ['pending', 'confirmed', 'preparing'].includes(s);

type Row = Order & { items: { name: string; quantity: number; notes: string | null }[] };

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const { hasPerm } = useAuth();
  const canManage = hasPerm('orders.manage');
  const [tab, setTab] = useState<'board' | 'list'>(params.get('id') ? 'list' : 'board');
  const [openId, setOpenId] = useState<number | null>(params.get('id') ? Number(params.get('id')) : null);
  const [pos, setPos] = useState(false);

  useEffect(() => {
    const id = params.get('id');
    if (id) setOpenId(Number(id));
  }, [params]);
  const close = () => {
    setOpenId(null);
    if (params.get('id')) {
      params.delete('id');
      setParams(params, { replace: true });
    }
  };
  const [listKey, setListKey] = useState(0);

  return (
    <div>
      <PageHeader
        title="Orders & Kitchen"
        subtitle="Track orders from ticket to table"
        actions={
          <>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'board', label: 'Kitchen board' }, { value: 'list', label: 'All orders' }]} />
            {canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPos(true)}>New order</Button>}
          </>
        }
      />
      {tab === 'board' ? <KitchenBoard refreshKey={listKey} canManage={canManage} onOpen={setOpenId} /> : <OrdersList refreshKey={listKey} onOpen={setOpenId} />}
      {openId && <OrderDrawer id={openId} onClose={close} onChanged={() => setListKey((k) => k + 1)} />}
      {pos && <PosModal onClose={() => setPos(false)} onCreated={(o) => (setListKey((k) => k + 1), setOpenId(o.id))} />}
    </div>
  );
}

function KitchenBoard({ canManage, onOpen, refreshKey }: { canManage: boolean; onOpen: (id: number) => void; refreshKey: number }) {
  const { data, loading, error, reload } = useApi<Row[]>(() => adminApi.get('/orders', { status: 'active' }), [refreshKey]);
  const { data: chefs } = useApi<any[]>(canManage ? () => adminApi.get('/employees', { position: 'chef', status: 'active' }) : null, [canManage]);
  usePolling(reload, 20000);
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = { pending: [], confirmed: [], preparing: [], ready: [], done: [] };
    (data || []).forEach((o) => g[o.status === 'served' || o.status === 'delivered' ? 'done' : o.status]?.push(o));
    Object.values(g).forEach((l) => l.sort((a, b) => a.created_at.localeCompare(b.created_at)));
    return g;
  }, [data]);

  const run = async (id: number, fn: () => Promise<any>, msg: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(msg);
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (o: Row) => {
    const r = await confirm({ title: `Cancel order ${o.order_code}?`, message: Number(o.amount_paid) > 0 ? 'Payments received will be refunded automatically.' : undefined, danger: true, confirmText: 'Cancel order', requireReason: true });
    if (r.ok) run(o.id, () => adminApi.patch(`/orders/${o.id}/status`, { status: 'cancelled', reason: r.reason }), 'Order cancelled');
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm text-ink-500">
        <span>{data.length} active order(s) · auto-refreshes every 20s</span>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={reload}>Refresh</Button>
      </div>
      <div className="scrollbar-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {COLUMNS.map((col) => (
          <div key={col.key} className={clsx('flex w-72 shrink-0 flex-col rounded-2xl border-t-4 bg-ink-100/70', col.tone)}>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-800">{col.label}</span>
              <span className="rounded-full bg-white px-2 text-xs font-semibold text-ink-600">{grouped[col.key].length}</span>
            </div>
            <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {grouped[col.key].length === 0 && <p className="py-6 text-center text-xs text-ink-400">No orders</p>}
              {grouped[col.key].map((o) => {
                const step = nextStep(o);
                const age = (Date.now() - new Date(o.created_at).getTime()) / 60000;
                return (
                  <div key={o.id} className="rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
                    <button className="w-full text-left" onClick={() => onOpen(o.id)}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-ink-900">{o.order_code}</span>
                        <span className={clsx('inline-flex items-center gap-1 text-xs', age > 30 && o.status !== 'ready' ? 'font-semibold text-red-600' : 'text-ink-500')}>
                          <Clock className="h-3 w-3" /> {timeAgo(o.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-600">
                        {titleCase(o.order_type)}
                        {o.table_number ? ` · Table ${o.table_number}` : ''}
                        {o.contact_name ? ` · ${o.contact_name}` : ''}
                      </p>
                      <ul className="mt-2 space-y-0.5 text-sm">
                        {o.items.map((i, k) => (
                          <li key={k} className="text-ink-800">
                            <span className="font-semibold">{i.quantity}×</span> {i.name}
                            {i.notes && <span className="block pl-5 text-xs italic text-ink-500">{i.notes}</span>}
                          </li>
                        ))}
                      </ul>
                      {o.notes && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{o.notes}</p>}
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-ink-900">{money(o.total)}</span>
                        <StatusBadge status={o.payment_status} />
                      </div>
                    </button>
                    {canManage && (
                      <div className="mt-2 space-y-2 border-t border-ink-100 pt-2">
                        {['confirmed', 'preparing'].includes(o.status) && (
                          <div className="flex items-center gap-1.5">
                            <ChefHat className="h-4 w-4 shrink-0 text-ink-400" />
                            <select
                              className="input h-8 py-0 text-xs"
                              value={o.assigned_chef_id ?? ''}
                              disabled={busy === o.id}
                              onChange={(e) => run(o.id, () => adminApi.patch(`/orders/${o.id}/assign`, { chef_id: e.target.value ? Number(e.target.value) : null }), e.target.value ? 'Assigned to kitchen' : 'Chef unassigned')}
                              aria-label="Assign chef"
                            >
                              <option value="">Assign chef...</option>
                              {(chefs || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        )}
                        {o.chef_name && !['confirmed', 'preparing'].includes(o.status) && <p className="text-xs text-ink-500">Chef: {o.chef_name}</p>}
                        <div className="flex gap-1.5">
                          {step && (
                            <Button size="xs" className="flex-1" loading={busy === o.id} onClick={() => run(o.id, () => adminApi.patch(`/orders/${o.id}/status`, { status: step.status }), `${o.order_code}: ${titleCase(step.status)}`)}>
                              {step.label}
                            </Button>
                          )}
                          {cancellable(o.status) && (
                            <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" disabled={busy === o.id} onClick={() => cancel(o)} aria-label="Cancel order">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrdersList({ onOpen, refreshKey }: { onOpen: (id: number) => void; refreshKey: number }) {
  const [f, setF] = useState({ q: '', status: '', type: '', payment: '', date: '' });
  const { data, loading, error, reload } = useApi<Row[]>(() => adminApi.get('/orders', f), [JSON.stringify(f), refreshKey]);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const columns: Column<Row>[] = [
    { key: 'order_code', header: 'Order', render: (o) => <span className="font-mono text-xs font-semibold text-ink-900">{o.order_code}</span> },
    { key: 'created_at', header: 'Placed', render: (o) => fmtDateTime(o.created_at) },
    { key: 'contact_name', header: 'Customer', render: (o) => <div><p className="font-medium text-ink-900">{o.contact_name || 'Walk-in'}</p><p className="text-xs text-ink-500">{o.contact_phone}</p></div> },
    { key: 'order_type', header: 'Type', render: (o) => `${titleCase(o.order_type)}${o.table_number ? ` · ${o.table_number}` : ''}` },
    { key: 'items', header: 'Items', hideOnMobile: true, sortable: false, value: (o) => o.items.map((i) => i.name).join(', '), render: (o) => <span className="line-clamp-1 max-w-[16rem] text-xs">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (o) => <span className="font-semibold">{money(o.total)}</span> },
    { key: 'payment_status', header: 'Payment', render: (o) => <StatusBadge status={o.payment_status} /> },
    { key: 'status', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
  ];
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data}
      loading={loading}
      columns={columns}
      searchable={false}
      onRowClick={(o) => onOpen(o.id)}
      toolbar={
        <div className="flex w-full flex-wrap gap-2">
          <Input className="w-full sm:w-56" icon={<Search className="h-4 w-4" />} placeholder="Order ID, name or phone" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <Select className="w-auto" value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={[{ value: 'active', label: 'Active' }, ...['pending', 'confirmed', 'preparing', 'ready', 'served', 'delivered', 'completed', 'cancelled'].map((s) => ({ value: s, label: titleCase(s) }))]} />
          <Select className="w-auto" value={f.type} onChange={(e) => set('type', e.target.value)} placeholder="All types" options={[{ value: 'dine_in', label: 'Dine-in' }, { value: 'takeaway', label: 'Takeaway' }, { value: 'delivery', label: 'Delivery' }]} />
          <Select className="w-auto" value={f.payment} onChange={(e) => set('payment', e.target.value)} placeholder="Any payment" options={['pending', 'paid', 'partially_paid', 'refunded', 'partially_refunded'].map((s) => ({ value: s, label: titleCase(s) }))} />
          <Input type="date" className="w-auto" value={f.date} onChange={(e) => set('date', e.target.value)} aria-label="Date" />
        </div>
      }
    />
  );
}

// ---------------- POS: new order ----------------
function PosModal({ onClose, onCreated }: { onClose: () => void; onCreated: (o: any) => void }) {
  const { branchId } = useAdmin();
  const { data: foods, loading } = useApi<FoodItem[]>(() => adminApi.get('/food-items'), []);
  const { data: tables } = useApi<any[]>(() => adminApi.get('/tables'), []);
  const [type, setType] = useState<'dine_in' | 'takeaway' | 'delivery'>('dine_in');
  const [tableId, setTableId] = useState('');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [coupon, setCoupon] = useState('');
  const [contact, setContact] = useState({ name: '', phone: '', address: '', notes: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const available = (foods || []).filter((f) => f.is_available && (!q || f.name.toLowerCase().includes(q.toLowerCase()) || f.category_name?.toLowerCase().includes(q.toLowerCase())));
  const items = Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ food_item_id: Number(id), quantity: n }));
  const setQty = (id: number, n: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(100, n)) }));

  useEffect(() => {
    if (!items.length) return setQuote(null);
    const t = setTimeout(() => {
      api.post<Quote>('/public/cart/quote', { branch_id: branchId, order_type: type, coupon_code: coupon.trim() || null, items })
        .then((r) => (setQuote(r), setQuoteErr(null)))
        .catch((e) => (setQuote(null), setQuoteErr(e.message)));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), type, coupon, branchId]);

  const submit = async () => {
    if (!items.length) return toast.error('Add at least one item');
    if (type === 'dine_in' && !tableId) return toast.error('Select a table');
    if (type === 'delivery' && !contact.address.trim()) return toast.error('Delivery address is required');
    setSaving(true);
    try {
      const o = await adminApi.post('/orders', {
        order_type: type,
        items,
        table_id: type === 'dine_in' ? Number(tableId) : null,
        coupon_code: coupon.trim() || null,
        contact_name: contact.name || null,
        contact_phone: contact.phone || null,
        delivery_address: type === 'delivery' ? contact.address : null,
        notes: contact.notes || null,
      });
      toast.success(`Order ${o.order_code} sent to kitchen`);
      onCreated(o);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const byId = new Map((foods || []).map((f) => [f.id, f]));
  return (
    <Modal open onClose={onClose} size="xl" title="New order" description="Point-of-sale order entry" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!items.length} onClick={submit}>Place order{quote ? ` · ${money(quote.total)}` : ''}</Button></>}>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Input icon={<Search className="h-4 w-4" />} placeholder="Search menu..." value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-3 max-h-[52vh] space-y-1 overflow-y-auto pr-1">
            {loading ? <Spinner /> : available.length === 0 ? <EmptyState title="No available items" /> : available.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-ink-100 p-2 hover:bg-ink-50">
                <Img src={f.images?.[0]} alt={f.name} className="h-11 w-11 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-900"><DietDot type={f.diet_type} /> {f.name}</p>
                  <p className="text-xs text-ink-500">{f.category_name} · {money(f.discounted_price ?? f.price)}</p>
                </div>
                {cart[f.id] ? (
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="secondary" onClick={() => setQty(f.id, cart[f.id] - 1)} aria-label="Decrease"><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center text-sm font-semibold">{cart[f.id]}</span>
                    <Button size="xs" variant="secondary" onClick={() => setQty(f.id, cart[f.id] + 1)} aria-label="Increase"><Plus className="h-3 w-3" /></Button>
                  </div>
                ) : (
                  <Button size="xs" variant="secondary" onClick={() => setQty(f.id, 1)}>Add</Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 lg:col-span-2">
          <Tabs value={type} onChange={setType} tabs={[{ value: 'dine_in', label: 'Dine-in' }, { value: 'takeaway', label: 'Takeaway' }, { value: 'delivery', label: 'Delivery' }]} />
          {type === 'dine_in' && (
            <Field label="Table" required>
              <Select value={tableId} onChange={(e) => setTableId(e.target.value)} placeholder="Select table" options={(tables || []).filter((t) => t.is_active && t.status !== 'maintenance').map((t) => ({ value: t.id, label: `${t.table_number} · ${t.capacity} seats${t.status === 'occupied' ? ' (occupied)' : ''}` }))} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Customer name"><Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></Field>
            <Field label="Mobile"><Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
          </div>
          {type === 'delivery' && <Field label="Delivery address" required><Textarea rows={2} value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} /></Field>}
          <Field label="Kitchen notes"><Input value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} placeholder="e.g. less spicy" /></Field>
          <Field label="Coupon"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Optional" /></Field>

          <div className="rounded-xl border border-ink-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ShoppingBag className="h-4 w-4" /> Ticket</p>
            {items.length === 0 ? (
              <p className="text-xs text-ink-500">No items added.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {items.map((i) => (
                  <li key={i.food_item_id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{i.quantity} × {byId.get(i.food_item_id)?.name}</span>
                    <button onClick={() => setQty(i.food_item_id, 0)} className="text-ink-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
            {quoteErr && <p className="mt-2 text-xs text-red-600">{quoteErr}</p>}
            {quote && (
              <dl className="mt-3 space-y-0.5 border-t border-ink-100 pt-2 text-xs text-ink-600">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(quote.subtotal)}</dd></div>
                {quote.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd>-{money(quote.discount)}</dd></div>}
                {quote.service_charge > 0 && <div className="flex justify-between"><dt>Service charge</dt><dd>{money(quote.service_charge)}</dd></div>}
                <div className="flex justify-between"><dt>GST ({quote.gst_rate}%)</dt><dd>{money(quote.tax)}</dd></div>
                {quote.delivery_charge > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{money(quote.delivery_charge)}</dd></div>}
                <div className="flex justify-between pt-1 text-sm font-bold text-ink-900"><dt>Total</dt><dd>{money(quote.total)}</dd></div>
              </dl>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
