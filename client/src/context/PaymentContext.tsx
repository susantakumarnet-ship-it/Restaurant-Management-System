import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CreditCard, Landmark, Lock, Smartphone, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { money } from '../lib/format';
import type { PaymentInit } from '../lib/types';
import { Button, Modal } from '../components/ui';

type PayTarget = { order_id?: number; reservation_id?: number };
const Ctx = createContext<(t: PayTarget) => Promise<boolean>>(async () => false);

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Online payments. Uses Razorpay Checkout when the server has keys configured;
 * otherwise shows a simulated gateway (mock mode) that exercises the same server flow.
 *   const pay = usePayment(); const ok = await pay({ order_id });
 */
export function PaymentProvider({ children }: { children: ReactNode }) {
  const [mock, setMock] = useState<PaymentInit | null>(null);
  const [method, setMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [busy, setBusy] = useState(false);
  const resolver = useRef<(ok: boolean) => void>();

  const pay = useCallback(async (target: PayTarget) => {
    let init: PaymentInit;
    try {
      init = await api.post<PaymentInit>('/customer/payments/create', target);
    } catch (e: any) {
      toast.error(e.message);
      return false;
    }
    if (init.mode === 'mock') {
      setMethod('upi');
      setMock(init);
      return new Promise<boolean>((res) => (resolver.current = res));
    }
    const ok = await loadRazorpay();
    if (!ok) {
      toast.error('Could not load the payment gateway. Check your connection.');
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const rz = new window.Razorpay({
        key: init.key_id,
        amount: init.amount_paise,
        currency: init.currency,
        name: init.name,
        description: init.description,
        order_id: init.gateway_order_id,
        prefill: init.prefill,
        theme: { color: '#d97706' },
        handler: async (resp: any) => {
          try {
            await api.post('/customer/payments/verify', { payment_id: init.payment_id, ...resp });
            toast.success('Payment successful');
            resolve(true);
          } catch (e: any) {
            toast.error(e.message);
            resolve(false);
          }
        },
        modal: { ondismiss: () => resolve(false) },
      });
      rz.on('payment.failed', (r: any) => toast.error(r?.error?.description || 'Payment failed'));
      rz.open();
    });
  }, []);

  const finishMock = async (success: boolean) => {
    if (!mock) return;
    setBusy(true);
    try {
      await api.post('/customer/payments/mock-complete', { payment_id: mock.payment_id, success });
      toast.success('Payment successful');
      resolver.current?.(true);
    } catch (e: any) {
      toast.error(e.message);
      resolver.current?.(false);
    } finally {
      setBusy(false);
      setMock(null);
    }
  };

  const methods = [
    { id: 'upi' as const, label: 'UPI', icon: Smartphone, hint: 'GPay, PhonePe, Paytm' },
    { id: 'card' as const, label: 'Card', icon: CreditCard, hint: 'Visa, Mastercard, RuPay' },
    { id: 'netbanking' as const, label: 'Net Banking', icon: Landmark, hint: 'All major banks' },
  ];

  return (
    <Ctx.Provider value={pay}>
      {children}
      <Modal open={!!mock} onClose={() => !busy && (resolver.current?.(false), setMock(null))} size="sm" title="Secure Checkout" description={mock?.description}>
        {mock && (
          <div className="space-y-4">
            <div className="rounded-xl bg-ink-900 p-4 text-white">
              <p className="text-xs uppercase tracking-wide text-ink-400">Amount payable</p>
              <p className="mt-1 font-display text-3xl font-bold text-brand-400">{money(mock.amount)}</p>
              <p className="mt-1 text-xs text-ink-400">{mock.name} • Ref {mock.payment_code}</p>
            </div>
            <div className="space-y-2">
              {methods.map((m) => (
                <button key={m.id} type="button" onClick={() => setMethod(m.id)} className={clsx('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition', method === m.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:bg-ink-50')}>
                  <m.icon className="h-5 w-5 text-brand-700" />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-xs text-ink-500">{m.hint}</span>
                  </span>
                  <span className={clsx('h-4 w-4 rounded-full border-2', method === m.id ? 'border-brand-600 bg-brand-600 ring-2 ring-inset ring-white' : 'border-ink-300')} />
                </button>
              ))}
            </div>
            <Button block size="lg" loading={busy} icon={<Lock className="h-4 w-4" />} onClick={() => finishMock(true)}>
              Pay {money(mock.amount)}
            </Button>
            <div className="flex items-center justify-between text-xs text-ink-500">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Test mode - no real money is charged
              </span>
              <button type="button" className="text-red-600 hover:underline" disabled={busy} onClick={() => finishMock(false)}>
                Simulate failure
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

export const usePayment = () => useContext(Ctx);
