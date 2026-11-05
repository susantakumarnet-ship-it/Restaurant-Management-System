import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChefHat, ClipboardCheck, CreditCard, Download, PackageCheck, RotateCcw, Star, XCircle, Bike, Utensils, Clock } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api, downloadFile } from '../../lib/api';
import { fmtDateTime, money, titleCase } from '../../lib/format';
import type { FoodItem, Order } from '../../lib/types';
import { useApi, usePolling } from '../../hooks/useApi';
import { useShop } from '../../context/ShopContext';
import { usePayment } from '../../context/PaymentContext';
import { Button, Card, ErrorState, Modal, Spinner, StatusBadge, Stars, Textarea, useConfirm, ImageUpload } from '../../components/ui';
import { AccountNav } from './AccountNav';

function steps(type: string) {
  const final = type === 'delivery' ? { key: 'delivered', label: 'Delivered', icon: Bike } : type === 'dine_in' ? { key: 'served', label: 'Served', icon: Utensils } : { key: 'completed', label: 'Picked up', icon: PackageCheck };
  return [
    { key: 'pending', label: 'Placed', icon: ClipboardCheck },
    { key: 'confirmed', label: 'Confirmed', icon: Check },
    { key: 'preparing', label: 'Preparing', icon: ChefHat },
    { key: 'ready', label: 'Ready', icon: PackageCheck },
    final,
  ];
}
const ORDER = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'delivered', 'completed'];

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const confirm = useConfirm();
  const pay = usePayment();
  const { add, setCartOpen } = useShop();
  const { data: o, loading, error, reload } = useApi<Order & { payments: any[]; reviewed_items: number[] }>(() => api.get(`/customer/orders/${id}`), [id]);
  const [review, setReview] = useState<{ food_item_id: number; name: string } | null>(null);
  usePolling(reload, 20000, !!o && !['completed', 'cancelled'].includes(o.status));

  if (loading && !o) return <Spinner className="h-[60vh]" />;
  if (error || !o) return <ErrorState error={error || 'Order not found'} onRetry={reload} />;

  const st = steps(o.order_type);
  const idx = Math.max(...st.map((s, i) => (ORDER.indexOf(o.status) >= ORDER.indexOf(s.key) ? i : -1)), o.status === 'completed' ? st.length - 1 : -1);
  const due = Math.round((Number(o.total) - Number(o.amount_paid)) * 100) / 100;
  const canCancel = ['pending', 'confirmed'].includes(o.status);

  const cancel = async () => {
    const r = await confirm({ title: 'Cancel this order?', message: Number(o.amount_paid) > 0 ? `${money(o.amount_paid)} will be refunded to your original payment method.` : undefined, danger: true, confirmText: 'Cancel order', requireReason: false, reasonLabel: 'Reason (optional)' });
    if (!r.ok) return;
    try {
      await api.post(`/customer/orders/${o.id}/cancel`, { reason: r.reason });
      toast.success('Order cancelled');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reorder = async () => {
    try {
      const menu = await api.get<{ items: FoodItem[] }>(`/public/branches/${o.branch_id}/menu`);
      let added = 0;
      for (const it of o.items) {
        const f = menu.items.find((m) => m.id === it.food_item_id);
        if (f?.is_available) {
          add(f, it.quantity);
          added++;
        }
      }
      if (!added) return toast.error('These items are no longer available');
      toast.success(added < o.items.length ? 'Some items are unavailable; the rest were added to your cart' : 'Items added to cart');
      setCartOpen(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <AccountNav />
      <Link to="/my/orders" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> All orders
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Order {o.order_code}</h1>
          <p className="text-sm text-ink-500">
            {titleCase(o.order_type)} • {o.branch_name} • {fmtDateTime(o.created_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <StatusBadge status={o.status} className="text-sm" />
          <StatusBadge status={o.payment_status} className="text-sm" />
        </div>
      </div>

      {o.status === 'cancelled' ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          <XCircle className="h-5 w-5" />
          <p className="text-sm">This order was cancelled{(o as any).cancel_reason ? `: ${(o as any).cancel_reason}` : '.'}</p>
        </div>
      ) : (
        <Card className="mb-6">
          <div className="flex items-start justify-between">
            {st.map((s, i) => (
              <div key={s.key} className="relative flex flex-1 flex-col items-center text-center">
                {i > 0 && <span className={clsx('absolute right-1/2 top-5 h-1 w-full -translate-y-1/2', i <= idx ? 'bg-brand-600' : 'bg-ink-200')} />}
                <span className={clsx('relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition', i <= idx ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-400', i === idx && o.status !== 'completed' && 'ring-4 ring-brand-200')}>
                  <s.icon className="h-4 w-4" />
                </span>
                <span className={clsx('mt-2 text-[11px] font-medium sm:text-xs', i <= idx ? 'text-ink-900' : 'text-ink-400')}>{s.label}</span>
              </div>
            ))}
          </div>
          {!['completed', 'cancelled'].includes(o.status) && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-500">
              <Clock className="h-3.5 w-3.5" /> Live tracking - updates automatically
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card title="Items" padded={false}>
            <ul className="divide-y divide-ink-100">
              {o.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {it.name} <span className="text-ink-500">× {it.quantity}</span>
                    </p>
                    {it.notes && <p className="text-xs text-ink-500">{it.notes}</p>}
                    {o.status === 'completed' && it.food_item_id && (
                      o.reviewed_items.includes(it.food_item_id) ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700">
                          <Check className="h-3 w-3" /> Reviewed
                        </span>
                      ) : (
                        <button onClick={() => setReview({ food_item_id: it.food_item_id!, name: it.name })} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                          <Star className="h-3 w-3" /> Rate this dish
                        </button>
                      )
                    )}
                  </div>
                  <span className="text-sm font-semibold">{money(it.line_total)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1.5 border-t border-ink-100 px-5 py-4 text-sm">
              <R l="Subtotal" v={money(o.subtotal)} />
              {Number(o.discount) > 0 && <R l={`Discount${o.coupon_code ? ` (${o.coupon_code})` : ''}`} v={`- ${money(o.discount)}`} />}
              {Number(o.service_charge) > 0 && <R l="Service charge" v={money(o.service_charge)} />}
              <R l="GST (CGST + SGST)" v={money(o.tax)} />
              {Number(o.delivery_charge) > 0 && <R l="Delivery" v={money(o.delivery_charge)} />}
              <div className="flex justify-between border-t border-dashed border-ink-200 pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd>{money(o.total)}</dd>
              </div>
              <R l="Paid" v={money(o.amount_paid)} />
            </dl>
          </Card>
          {o.payments.length > 0 && (
            <Card title="Payments" padded={false}>
              <ul className="divide-y divide-ink-100 text-sm">
                {o.payments.map((p) => (
                  <li key={p.payment_code} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className="font-mono text-xs">{p.payment_code}</span>
                    <span className="text-ink-600">{titleCase(p.method)}</span>
                    <span className="font-medium">{money(p.amount)}</span>
                    <StatusBadge status={p.status} />
                    {Number(p.refunded_amount) > 0 && <span className="w-full text-xs text-ink-500">Refunded {money(p.refunded_amount)}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-3">
          <Card>
            <div className="space-y-2">
              {due > 0 && o.status !== 'cancelled' && (
                <Button block icon={<CreditCard className="h-4 w-4" />} onClick={async () => (await pay({ order_id: o.id })) && reload()}>
                  Pay {money(due)} now
                </Button>
              )}
              {o.status !== 'cancelled' && (
                <Button block variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/customer/orders/${o.id}/invoice.pdf`).then(reload).catch((e) => toast.error(e.message))}>
                  Download invoice
                </Button>
              )}
              <Button block variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={reorder}>
                Order again
              </Button>
              {canCancel && (
                <Button block variant="ghost" className="text-red-600 hover:bg-red-50" icon={<XCircle className="h-4 w-4" />} onClick={cancel}>
                  Cancel order
                </Button>
              )}
            </div>
          </Card>
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <R l="Name" v={o.contact_name || '-'} />
              <R l="Phone" v={o.contact_phone || '-'} />
              {o.delivery_address && (
                <div>
                  <dt className="text-ink-500">Delivery address</dt>
                  <dd className="font-medium">{o.delivery_address}</dd>
                </div>
              )}
              {o.table_number && <R l="Table" v={o.table_number} />}
              {o.notes && (
                <div>
                  <dt className="text-ink-500">Notes</dt>
                  <dd>{o.notes}</dd>
                </div>
              )}
            </dl>
          </Card>
          <button onClick={() => nav('/reviews')} className="w-full text-center text-sm font-medium text-brand-700 hover:underline">
            Review the restaurant
          </button>
        </div>
      </div>
      {review && <ReviewModal orderId={o.id} branchId={o.branch_id} item={review} onClose={() => setReview(null)} onDone={reload} />}
    </div>
  );
}

const R = ({ l, v }: { l: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-ink-500">{l}</dt>
    <dd className="font-medium">{v}</dd>
  </div>
);

function ReviewModal({ orderId, branchId, item, onClose, onDone }: { orderId: number; branchId: number; item: { food_item_id: number; name: string }; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/customer/reviews', { branch_id: branchId, order_id: orderId, food_item_id: item.food_item_id, rating, comment: comment.trim() || null, images });
      toast.success('Thanks for your review!');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Rate ${item.name}`} size="md" footer={<Button loading={busy} onClick={submit}>Submit review</Button>}>
      <div className="space-y-4">
        <div className="flex justify-center">
          <Stars value={rating} onChange={setRating} size={32} />
        </div>
        <Textarea placeholder="How was it? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div>
          <p className="label">Add photos</p>
          <ImageUpload value={images} onChange={setImages} max={3} label="Photo" />
        </div>
      </div>
    </Modal>
  );
}
