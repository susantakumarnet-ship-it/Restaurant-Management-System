import { useState } from 'react';
import { toast } from 'sonner';
import { Download, FileText, Wallet } from 'lucide-react';
import { adminApi, downloadFile } from '../../../lib/api';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { fmtDateTime, money, titleCase } from '../../../lib/format';
import { Button, Drawer, ErrorState, Field, Input, Modal, Select, Spinner, StatusBadge, Textarea } from '../../../components/ui';

/** Record a cash/UPI/card payment (full or partial) against an order or booking. */
export function PaymentEntryModal({ target, due, label, onClose, onDone }: { target: { order_id?: number; reservation_id?: number }; due: number; label: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const amt = Number(amount);
  const save = async () => {
    if (!(amt > 0) || amt > due) return toast.error(`Enter an amount between ₹0.01 and ${money(due)}`);
    setSaving(true);
    try {
      await adminApi.post('/payments', { ...target, amount: amt, method, notes: notes || null });
      toast.success(`Payment of ${money(amt)} recorded`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Record payment" description={label} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Record {amt > 0 ? money(amt) : ''}</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-ink-50 p-3 text-sm">
          Outstanding: <span className="font-bold text-ink-900">{money(due)}</span>
        </div>
        <Field label="Amount" hint={amt > 0 && amt < due ? `Partial payment - ${money(due - amt)} will remain due` : undefined}>
          <Input type="number" step="0.01" min={0} max={due} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Credit / Debit card' }]} />
        </Field>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. UPI ref no." /></Field>
      </div>
    </Modal>
  );
}

export function OrderDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { hasPerm } = useAuth();
  const { data: o, loading, error, reload } = useApi<any>(() => adminApi.get(`/orders/${id}`), [id]);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const canPay = hasPerm('payments.manage');
  // POST /orders/:id/invoice and GET /invoices/:id/pdf require payments.manage or orders.manage.
  const canInvoice = hasPerm('payments.manage', 'orders.manage');
  const refresh = () => (reload(), onChanged());

  const invoice = async () => {
    setBusy(true);
    try {
      const inv = o.invoice_id ? { id: o.invoice_id } : await adminApi.post(`/orders/${id}/invoice`);
      await downloadFile(`/admin/invoices/${inv.id}/pdf`, undefined, { branch: true });
      if (!o.invoice_id) refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const due = o ? Math.round((Number(o.total) - Number(o.amount_paid)) * 100) / 100 : 0;
  return (
    <Drawer open onClose={onClose} title={o ? <span className="flex flex-wrap items-center gap-2">{o.order_code} <StatusBadge status={o.status} /> <StatusBadge status={o.payment_status} /></span> : 'Order'}>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !o ? (
        <Spinner />
      ) : o ? (
        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-4">
            <div><p className="label">Type</p><p className="font-semibold">{titleCase(o.order_type)}{o.table_number ? ` · Table ${o.table_number}` : ''}</p></div>
            <div><p className="label">Placed</p><p className="font-semibold">{fmtDateTime(o.created_at)}</p></div>
            <div><p className="label">Customer</p><p className="font-semibold">{o.contact_name || 'Walk-in'}</p><p className="text-ink-500">{o.contact_phone}</p></div>
            <div><p className="label">Chef</p><p className="font-semibold">{o.chef_name || '-'}</p></div>
            {o.delivery_address && <div className="col-span-2"><p className="label">Delivery address</p><p>{o.delivery_address}</p></div>}
            {o.notes && <div className="col-span-2"><p className="label">Notes</p><p>{o.notes}</p></div>}
            {o.cancel_reason && <div className="col-span-2"><p className="label">Cancel reason</p><p>{o.cancel_reason}</p></div>}
          </div>

          <div>
            <h4 className="mb-2 font-semibold text-ink-900">Items</h4>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
              {o.items.map((i: any) => (
                <li key={i.id} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-medium">{i.quantity} × {i.name}</span>
                    {i.notes && <span className="block text-xs text-ink-500">{i.notes}</span>}
                  </span>
                  <span className="font-medium">{money(i.line_total)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1">
              {[
                ['Subtotal', o.subtotal],
                ...(Number(o.discount) ? [[`Discount${o.coupon_code ? ` (${o.coupon_code})` : ''}`, -o.discount]] : []),
                ...(Number(o.service_charge) ? [['Service charge', o.service_charge]] : []),
                ['GST', o.tax],
                ...(Number(o.delivery_charge) ? [['Delivery', o.delivery_charge]] : []),
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between text-ink-600"><dt>{k}</dt><dd>{money(v as number)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-ink-200 pt-1 text-base font-bold text-ink-900"><dt>Total</dt><dd>{money(o.total)}</dd></div>
              <div className="flex justify-between text-ink-600"><dt>Paid</dt><dd>{money(o.amount_paid)}</dd></div>
              {due > 0 && o.status !== 'cancelled' && <div className="flex justify-between font-semibold text-red-700"><dt>Due</dt><dd>{money(due)}</dd></div>}
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            {canPay && due > 0 && o.status !== 'cancelled' && (
              <Button size="sm" icon={<Wallet className="h-4 w-4" />} onClick={() => setPaying(true)}>Record payment</Button>
            )}
            {canInvoice && o.status !== 'cancelled' && (
              <Button size="sm" variant="secondary" loading={busy} icon={o.invoice_id ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />} onClick={invoice}>
                {o.invoice_id ? `Invoice ${o.invoice_number}` : 'Generate invoice'}
              </Button>
            )}
          </div>

          {o.payments.length > 0 && (
            <div>
              <h4 className="mb-2 font-semibold text-ink-900">Payments</h4>
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
                {o.payments.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="font-mono text-xs">{p.payment_code}</span>
                      <span className="block text-xs text-ink-500">{titleCase(p.method)} · {fmtDateTime(p.created_at)}{p.is_partial ? ' · partial' : ''}</span>
                    </span>
                    <span className="flex items-center gap-2 font-medium">
                      {money(p.amount)}
                      <StatusBadge status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
      {paying && o && <PaymentEntryModal target={{ order_id: o.id }} due={due} label={`Order ${o.order_code}`} onClose={() => setPaying(false)} onDone={refresh} />}
    </Drawer>
  );
}
