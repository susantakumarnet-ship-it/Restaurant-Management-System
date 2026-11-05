import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Banknote, CreditCard, Download, IndianRupee, RotateCcw, Search, Smartphone, Wallet, Globe, AlertTriangle, Clock, Undo2 } from 'lucide-react';
import { adminApi, downloadFile } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { fmtDate, fmtDateTime, money, titleCase, toDateInput } from '../../lib/format';
import { Button, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, StatCard, StatusBadge, Tabs, Textarea, type Column } from '../../components/ui';
import { OrderDrawer, PaymentEntryModal } from './components/OrderDrawer';

const monthStart = () => toDateInput().slice(0, 8) + '01';

export default function Payments() {
  const [range, setRange] = useState({ from: monthStart(), to: toDateInput() });
  const [tab, setTab] = useState<'transactions' | 'invoices'>('transactions');
  const [recording, setRecording] = useState(false);
  const [bump, setBump] = useState(0);
  const { data: s } = useApi<any>(() => adminApi.get('/payments/summary', range), [range.from, range.to, bump]);

  return (
    <div>
      <PageHeader
        title="Payments & Billing"
        subtitle="Transactions, refunds and GST invoices"
        actions={
          <>
            <Input type="date" className="w-auto" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
            <Input type="date" className="w-auto" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
            <Button icon={<Wallet className="h-4 w-4" />} onClick={() => setRecording(true)}>Record payment</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Received" value={money(s?.received ?? 0, { decimals: false })} icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Refunded" value={money(s?.refunded ?? 0, { decimals: false })} icon={<Undo2 className="h-5 w-5" />} tone="gray" />
        <StatCard label="Cash" value={money(s?.cash ?? 0, { decimals: false })} icon={<Banknote className="h-5 w-5" />} tone="green" />
        <StatCard label="UPI" value={money(s?.upi ?? 0, { decimals: false })} icon={<Smartphone className="h-5 w-5" />} tone="purple" />
        <StatCard label="Card" value={money(s?.card ?? 0, { decimals: false })} icon={<CreditCard className="h-5 w-5" />} tone="blue" />
        <StatCard label="Online" value={money(s?.online ?? 0, { decimals: false })} icon={<Globe className="h-5 w-5" />} tone="brand" />
        <StatCard label="Failed" value={s?.failed ?? 0} icon={<AlertTriangle className="h-5 w-5" />} tone="red" />
        <StatCard label="Pending" value={s?.pending ?? 0} icon={<Clock className="h-5 w-5" />} tone="gray" />
      </div>
      <Tabs className="my-4 w-fit" value={tab} onChange={setTab} tabs={[{ value: 'transactions', label: 'Transactions' }, { value: 'invoices', label: 'Invoices' }]} />
      {tab === 'transactions' ? <Transactions refreshKey={bump} range={range} onChanged={() => setBump((b) => b + 1)} /> : <Invoices range={range} />}
      {recording && <RecordPayment onClose={() => setRecording(false)} onDone={() => setBump((b) => b + 1)} />}
    </div>
  );
}

function Transactions({ range, onChanged, refreshKey }: { range: { from: string; to: string }; onChanged: () => void; refreshKey: number }) {
  const [f, setF] = useState({ q: '', status: '', method: '', purpose: '' });
  // refreshKey (bumped after refunds / new payments) reloads the list without remounting, so filters and the open drawer survive.
  const { data, loading, error, reload } = useApi<any[]>(() => adminApi.get('/payments', { ...f, ...range }), [JSON.stringify(f), range.from, range.to, refreshKey]);
  const [refunding, setRefunding] = useState<any | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const columns: Column<any>[] = [
    { key: 'payment_code', header: 'Txn', render: (p) => <span className="font-mono text-xs font-semibold text-ink-900">{p.payment_code}</span> },
    { key: 'created_at', header: 'Date', render: (p) => fmtDateTime(p.created_at) },
    {
      key: 'reference',
      header: 'Reference',
      value: (p) => p.order_code || p.booking_code,
      render: (p) =>
        p.order_id ? (
          <button className="link text-xs" onClick={(e) => (e.stopPropagation(), setOrderId(p.order_id))}>{p.order_code}</button>
        ) : (
          <a className="link text-xs" href={`/admin/reservations?id=${p.reservation_id}`} onClick={(e) => e.stopPropagation()}>{p.booking_code}</a>
        ),
    },
    { key: 'customer_name', header: 'Customer', hideOnMobile: true, render: (p) => p.customer_name || '-' },
    { key: 'method', header: 'Method', render: (p) => <span>{titleCase(p.method)}{p.is_partial ? <span className="ml-1 text-xs text-amber-700">(partial)</span> : null}</span> },
    { key: 'purpose', header: 'For', hideOnMobile: true, render: (p) => titleCase(p.purpose) },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => <div><p className="font-semibold">{money(p.amount)}</p>{Number(p.refunded_amount) > 0 && <p className="text-xs text-red-600">-{money(p.refunded_amount)} refunded</p>}</div> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    {
      key: '_a',
      header: '',
      sortable: false,
      align: 'right',
      render: (p) =>
        ['success', 'partially_refunded'].includes(p.status) ? (
          <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={(e) => (e.stopPropagation(), setRefunding(p))}>Refund</Button>
        ) : null,
    },
  ];

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        columns={columns}
        searchable={false}
        toolbar={
          <div className="flex w-full flex-wrap gap-2">
            <Input className="w-full sm:w-64" icon={<Search className="h-4 w-4" />} placeholder="Txn, order, booking or gateway ref" value={f.q} onChange={(e) => set('q', e.target.value)} />
            <Select className="w-auto" value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={['success', 'pending', 'failed', 'refunded', 'partially_refunded'].map((s) => ({ value: s, label: titleCase(s) }))} />
            <Select className="w-auto" value={f.method} onChange={(e) => set('method', e.target.value)} placeholder="All methods" options={['cash', 'upi', 'card', 'online'].map((s) => ({ value: s, label: s.toUpperCase() }))} />
            <Select className="w-auto" value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="Orders & advances" options={[{ value: 'order', label: 'Orders' }, { value: 'advance', label: 'Booking advances' }]} />
          </div>
        }
      />
      {refunding && <RefundModal payment={refunding} onClose={() => setRefunding(null)} onDone={onChanged} />}
      {orderId && <OrderDrawer id={orderId} onClose={() => setOrderId(null)} onChanged={onChanged} />}
    </>
  );
}

function RefundModal({ payment: p, onClose, onDone }: { payment: any; onClose: () => void; onDone: () => void }) {
  const refundable = Math.round((Number(p.amount) - Number(p.refunded_amount)) * 100) / 100;
  const [amount, setAmount] = useState(String(refundable));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const amt = Number(amount);
  const save = async () => {
    if (!(amt > 0) || amt > refundable) return toast.error(`Refund must be between ₹0.01 and ${money(refundable)}`);
    if (reason.trim().length < 3) return toast.error('Please give a reason');
    setSaving(true);
    try {
      await adminApi.post(`/payments/${p.id}/refund`, { amount: amt, reason: reason.trim() });
      toast.success(`Refund of ${money(amt)} processed`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Refund ${p.payment_code}`} description={`${titleCase(p.method)} payment for ${p.order_code || p.booking_code}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={saving} onClick={save}>Refund {amt > 0 ? money(amt) : ''}</Button></>}>
      <div className="space-y-4">
        <p className="rounded-xl bg-ink-50 p-3 text-sm">Refundable: <span className="font-bold">{money(refundable)}</span>{p.gateway === 'razorpay' ? ' · refunded via Razorpay' : ''}</p>
        <Field label="Amount" hint={amt > 0 && amt < refundable ? 'Partial refund' : 'Full refund'}><Input type="number" step="0.01" min={0} max={refundable} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason" required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item missing from delivery" /></Field>
      </div>
    </Modal>
  );
}

function Invoices({ range }: { range: { from: string; to: string } }) {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi<any[]>(() => adminApi.get('/invoices', { q, ...range }), [q, range.from, range.to]);
  const [busy, setBusy] = useState<number | null>(null);
  const dl = async (id: number) => {
    setBusy(id);
    try {
      await downloadFile(`/admin/invoices/${id}/pdf`, undefined, { branch: true });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const columns: Column<any>[] = [
    { key: 'invoice_number', header: 'Invoice', render: (i) => <span className="font-mono text-xs font-semibold text-ink-900">{i.invoice_number}</span> },
    { key: 'issued_at', header: 'Issued', render: (i) => fmtDate(i.issued_at) },
    { key: 'order_code', header: 'Order' },
    { key: 'customer_name', header: 'Customer', hideOnMobile: true },
    { key: 'subtotal', header: 'Taxable', align: 'right', hideOnMobile: true, render: (i) => money(Number(i.subtotal) - Number(i.discount) + Number(i.service_charge)) },
    { key: 'cgst', header: 'GST', align: 'right', render: (i) => money(Number(i.cgst) + Number(i.sgst)) },
    { key: 'total', header: 'Total', align: 'right', render: (i) => <span className="font-semibold">{money(i.total)}</span> },
    { key: 'payment_status', header: 'Payment', render: (i) => <StatusBadge status={i.payment_status} /> },
    { key: '_d', header: '', sortable: false, align: 'right', render: (i) => <Button size="xs" variant="ghost" loading={busy === i.id} icon={<Download className="h-3.5 w-3.5" />} onClick={() => dl(i.id)}>PDF</Button> },
  ];
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return <DataTable rows={data} loading={loading} columns={columns} searchable={false} toolbar={<Input className="w-full sm:w-64" icon={<Search className="h-4 w-4" />} placeholder="Invoice, order or customer" value={q} onChange={(e) => setQ(e.target.value)} />} />;
}

/** Find an order or booking with an outstanding balance, then record a counter payment. */
function RecordPayment({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'order' | 'booking'>('order');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<{ target: { order_id?: number; reservation_id?: number }; due: number; label: string } | null>(null);
  const [checking, setChecking] = useState<number | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(kind === 'order' ? await adminApi.get('/orders', { q: q.trim() }) : await adminApi.get('/reservations', { q: q.trim(), sort: 'latest' }));
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, kind]);

  const pickOrder = (o: any) => {
    const due = Math.round((Number(o.total) - Number(o.amount_paid)) * 100) / 100;
    if (o.status === 'cancelled') return toast.error('This order is cancelled');
    if (due <= 0) return toast.error('This order is fully paid');
    setPicked({ target: { order_id: o.id }, due, label: `Order ${o.order_code} · ${o.contact_name || 'Walk-in'}` });
  };
  const pickBooking = async (r: any) => {
    if (!Number(r.advance_amount)) return toast.error('This booking has no advance payment due');
    setChecking(r.id);
    try {
      const d = await adminApi.get(`/reservations/${r.id}`);
      const paid = d.payments.filter((p: any) => ['success', 'partially_refunded'].includes(p.status)).reduce((s: number, p: any) => s + Number(p.amount) - Number(p.refunded_amount), 0);
      const due = Math.round((Number(d.advance_amount) - paid) * 100) / 100;
      if (due <= 0) return toast.error('Advance already paid');
      setPicked({ target: { reservation_id: r.id }, due, label: `Booking ${r.booking_code} · ${r.customer_name}` });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setChecking(null);
    }
  };

  if (picked) return <PaymentEntryModal target={picked.target} due={picked.due} label={picked.label} onClose={onClose} onDone={onDone} />;
  return (
    <Modal open onClose={onClose} size="lg" title="Record payment" description="Find the order or booking being paid at the counter">
      <div className="space-y-3">
        <Tabs value={kind} onChange={(k) => (setKind(k), setResults(null))} tabs={[{ value: 'order', label: 'Order' }, { value: 'booking', label: 'Booking advance' }]} />
        <Input autoFocus icon={<Search className="h-4 w-4" />} placeholder={kind === 'order' ? 'Order ID, customer name or phone' : 'Booking ID, guest name or phone'} value={q} onChange={(e) => setQ(e.target.value)} />
        {searching ? (
          <Spinner className="py-6" />
        ) : results === null ? (
          <p className="py-4 text-center text-sm text-ink-500">Type at least 2 characters to search.</p>
        ) : results.length === 0 ? (
          <EmptyState title="No matches" />
        ) : (
          <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-200 text-sm">
            {results.slice(0, 30).map((x) =>
              kind === 'order' ? (
                <li key={x.id}>
                  <button onClick={() => pickOrder(x)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ink-50">
                    <span>
                      <span className="font-mono text-xs font-semibold">{x.order_code}</span>
                      <span className="block text-xs text-ink-500">{x.contact_name || 'Walk-in'} · {fmtDateTime(x.created_at)}</span>
                    </span>
                    <span className="text-right">
                      <span className={clsx('block font-semibold', Number(x.total) > Number(x.amount_paid) && x.status !== 'cancelled' ? 'text-red-700' : 'text-ink-500')}>
                        Due {money(Math.max(0, Number(x.total) - Number(x.amount_paid)))}
                      </span>
                      <StatusBadge status={x.payment_status} />
                    </span>
                  </button>
                </li>
              ) : (
                <li key={x.id}>
                  <button onClick={() => pickBooking(x)} disabled={checking === x.id} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ink-50">
                    <span>
                      <span className="font-mono text-xs font-semibold">{x.booking_code}</span>
                      <span className="block text-xs text-ink-500">{x.customer_name} · {fmtDate(x.booking_date)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold">{Number(x.advance_amount) ? `Advance ${money(x.advance_amount)}` : 'No advance'}</span>
                      <StatusBadge status={x.payment_status} />
                    </span>
                  </button>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
