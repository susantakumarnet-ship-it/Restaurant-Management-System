import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bike, Store, UtensilsCrossed, TicketPercent, X, Wallet, CreditCard, ShieldCheck, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import type { Order, Quote } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useShop } from '../../context/ShopContext';
import { usePayment } from '../../context/PaymentContext';
import { Button, Card, DietDot, EmptyState, Field, Img, Input, Textarea } from '../../components/ui';
import { QtyStepper } from '../../components/FoodCard';

type OrderType = 'delivery' | 'takeaway' | 'dine_in';

export default function Checkout() {
  const { user } = useAuth();
  const { cart, branch, branchId, setQty, clear, coupon, setCoupon } = useShop();
  const pay = usePayment();
  const nav = useNavigate();
  const [type, setType] = useState<OrderType>('delivery');
  const [contact, setContact] = useState({ name: user?.name || '', phone: user?.phone || '', address: '', notes: '' });
  const [couponInput, setCouponInput] = useState(coupon);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [method, setMethod] = useState<'online' | 'cash'>('online');
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => r.customer?.address && setContact((c) => ({ ...c, address: c.address || r.customer.address }))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!branch) return;
    if (type === 'delivery' && !branch.accepts_delivery) setType(branch.accepts_takeaway ? 'takeaway' : 'dine_in');
    if (type === 'takeaway' && !branch.accepts_takeaway) setType('dine_in');
  }, [branch, type]);

  // Live server-side quote (prices, coupon, GST, charges)
  useEffect(() => {
    if (!branchId || !cart.length) return setQuote(null);
    const t = setTimeout(() => {
      api
        .post<Quote>('/public/cart/quote', { branch_id: branchId, order_type: type, coupon_code: coupon || null, items: cart.map((l) => ({ food_item_id: l.food_item_id, quantity: l.quantity })) })
        .then((q) => {
          setQuote(q);
          setQuoteError(null);
        })
        .catch((e) => {
          setQuoteError(e.message);
          if (coupon && /coupon|minimum|expired|used|limit/i.test(e.message)) {
            toast.error(e.message);
            setCoupon('');
          }
        });
    }, 250);
    return () => clearTimeout(t);
  }, [branchId, cart, type, coupon, setCoupon]);

  if (!cart.length) {
    return (
      <EmptyState
        className="py-24"
        title="Your cart is empty"
        description="Add dishes from the menu to place an order."
        action={
          <Link to="/menu">
            <Button>Browse menu</Button>
          </Link>
        }
      />
    );
  }

  const placeOrder = async () => {
    if (contact.name.trim().length < 2) return toast.error('Please enter your name');
    if (!/^\+?[0-9]{10,15}$/.test(contact.phone.trim())) return toast.error('Please enter a valid mobile number');
    if (type === 'delivery' && contact.address.trim().length < 8) return toast.error('Please enter your full delivery address');
    setPlacing(true);
    try {
      const order = await api.post<Order>('/customer/orders', {
        branch_id: branchId,
        order_type: type,
        items: cart.map((l) => ({ food_item_id: l.food_item_id, quantity: l.quantity, notes: l.notes || null })),
        coupon_code: coupon || null,
        contact_name: contact.name.trim(),
        contact_phone: contact.phone.trim(),
        delivery_address: type === 'delivery' ? contact.address.trim() : null,
        notes: contact.notes.trim() || null,
        payment_method: method,
      });
      clear();
      if (method === 'online') {
        const ok = await pay({ order_id: order.id });
        if (!ok) toast.info('Order placed. You can complete the payment from the order page.');
      } else toast.success('Order placed! Pay on ' + (type === 'delivery' ? 'delivery' : 'pickup'));
      nav(`/my/orders/${order.id}`, { replace: true });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPlacing(false);
    }
  };

  const types: { id: OrderType; label: string; icon: any; hint: string; enabled: boolean }[] = [
    { id: 'delivery', label: 'Delivery', icon: Bike, hint: branch?.delivery_charge ? `${money(branch.delivery_charge)} delivery fee` : 'Free delivery', enabled: !!branch?.accepts_delivery },
    { id: 'takeaway', label: 'Takeaway', icon: Store, hint: 'Pick up at the restaurant', enabled: !!branch?.accepts_takeaway },
    { id: 'dine_in', label: 'Dine-in', icon: UtensilsCrossed, hint: 'Order ahead for your table', enabled: true },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/menu" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Continue shopping
      </Link>
      <h1 className="mb-6 font-display text-3xl font-bold">Checkout</h1>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="How would you like your order?">
            <div className="grid gap-3 sm:grid-cols-3">
              {types.map((t) => (
                <button
                  key={t.id}
                  disabled={!t.enabled}
                  onClick={() => setType(t.id)}
                  className={clsx('rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-40', type === t.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:bg-ink-50')}
                >
                  <t.icon className={clsx('h-5 w-5', type === t.id ? 'text-brand-700' : 'text-ink-500')} />
                  <p className="mt-2 font-semibold">{t.label}</p>
                  <p className="text-xs text-ink-500">{t.enabled ? t.hint : 'Not available'}</p>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Contact details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              </Field>
              <Field label="Mobile" required>
                <Input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
              </Field>
              {type === 'delivery' && (
                <Field label="Delivery address" required className="sm:col-span-2">
                  <Textarea rows={2} value={contact.address} placeholder="House / flat, street, landmark, area" onChange={(e) => setContact({ ...contact, address: e.target.value })} />
                </Field>
              )}
              <Field label="Cooking / delivery instructions" className="sm:col-span-2">
                <Input value={contact.notes} placeholder="e.g. less spicy, ring the bell" onChange={(e) => setContact({ ...contact, notes: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="Payment method">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { id: 'online' as const, label: 'Pay online', hint: 'UPI, cards, net banking', icon: CreditCard },
                { id: 'cash' as const, label: type === 'delivery' ? 'Cash on delivery' : 'Pay at restaurant', hint: 'Cash, card or UPI at the counter', icon: Wallet },
              ].map((m) => (
                <button key={m.id} onClick={() => setMethod(m.id)} className={clsx('flex items-center gap-3 rounded-xl border p-4 text-left transition', method === m.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:bg-ink-50')}>
                  <m.icon className="h-5 w-5 text-brand-700" />
                  <span>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block text-xs text-ink-500">{m.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <div className="card sticky top-24 overflow-hidden">
            <div className="border-b border-ink-100 px-5 py-4">
              <h3 className="font-semibold">Order summary</h3>
              <p className="text-xs text-ink-500">
                {branch?.restaurant_name} • {branch?.name}
              </p>
            </div>
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto px-5">
              {cart.map((l) => (
                <li key={l.food_item_id} className="flex items-center gap-3 py-3">
                  <Img src={l.image} alt={l.name} className="h-12 w-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <DietDot type={l.diet_type} /> {l.name}
                    </p>
                    <p className="text-xs text-ink-500">{money(l.price)}</p>
                  </div>
                  <QtyStepper qty={l.quantity} onChange={(q) => setQty(l.food_item_id, q)} size="sm" />
                </li>
              ))}
            </ul>
            <div className="space-y-3 border-t border-ink-100 px-5 py-4">
              {coupon ? (
                <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <span className="flex items-center gap-1.5 font-medium">
                    <TicketPercent className="h-4 w-4" /> {coupon} applied
                  </span>
                  <button onClick={() => (setCoupon(''), setCouponInput(''))} aria-label="Remove coupon">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!couponInput.trim()) return;
                    try {
                      const r = await api.post('/public/coupons/validate', { branch_id: branchId, code: couponInput.trim(), subtotal: quote?.subtotal || 0 });
                      setCoupon(r.coupon.code);
                      toast.success(`${r.coupon.title} - you save ${money(r.discount)}`);
                    } catch (err: any) {
                      toast.error(err.message);
                    }
                  }}
                >
                  <Input placeholder="Coupon code" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} className="font-mono uppercase" />
                  <Button type="submit" variant="secondary">
                    Apply
                  </Button>
                </form>
              )}
              {quote ? (
                <dl className="space-y-1.5 text-sm">
                  <Row label="Subtotal" value={money(quote.subtotal)} />
                  {quote.discount > 0 && <Row label={`Discount${quote.coupon ? ` (${quote.coupon.code})` : ''}`} value={`- ${money(quote.discount)}`} className="text-emerald-700" />}
                  {quote.service_charge > 0 && <Row label={`Service charge (${quote.service_charge_rate}%)`} value={money(quote.service_charge)} />}
                  <Row label={`GST (${quote.gst_rate}%: CGST ${money(quote.cgst)} + SGST ${money(quote.sgst)})`} value={money(quote.tax)} />
                  {quote.delivery_charge > 0 && <Row label="Delivery charge" value={money(quote.delivery_charge)} />}
                  <div className="flex justify-between border-t border-dashed border-ink-200 pt-2 text-base font-bold">
                    <dt>Total</dt>
                    <dd>{money(quote.total)}</dd>
                  </div>
                </dl>
              ) : quoteError ? (
                <p className="text-sm text-red-600">{quoteError}</p>
              ) : (
                <p className="text-sm text-ink-500">Calculating...</p>
              )}
              <Button block size="lg" loading={placing} disabled={!quote} onClick={placeOrder}>
                {method === 'online' ? `Pay ${quote ? money(quote.total) : ''}` : 'Place order'}
              </Button>
              <p className="flex items-center justify-center gap-1 text-xs text-ink-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Secure checkout powered by Razorpay
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value, className }: { label: string; value: string; className?: string }) => (
  <div className={clsx('flex justify-between gap-3', className)}>
    <dt className="text-ink-600">{label}</dt>
    <dd className="shrink-0 font-medium">{value}</dd>
  </div>
);
