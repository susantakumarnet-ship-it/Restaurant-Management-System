import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, Check, ChevronLeft, Minus, Plus, Users, Armchair, Sparkles, Info, ShoppingBag, Clock } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { addDays, fmtDate, fmtTime, money, OCCASIONS, toDateInput, titleCase } from '../../lib/format';
import type { Availability, Reservation, Slot } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useShop } from '../../context/ShopContext';
import { usePayment } from '../../context/PaymentContext';
import { Button, Card, EmptyState, Field, Input, Select, Spinner, Textarea, Checkbox } from '../../components/ui';

const DRAFT_KEY = 'rms_booking_draft';
type Draft = { date: string; guests: number; sectionId: string; time: string; tableId: number | null; name: string; phone: string; email: string; occasion: string; requests: string; preorder: boolean };

const loadDraft = (): Partial<Draft> => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
};

export default function BookTable() {
  const { user } = useAuth();
  const { branch, branchId, cart, clear: clearCart } = useShop();
  const pay = usePayment();
  const nav = useNavigate();
  const draft = loadDraft();
  const [step, setStep] = useState<1 | 2 | 3>(draft.time ? 3 : 1);
  const [date, setDate] = useState(draft.date || toDateInput(addDays(new Date(), 0)));
  const [guests, setGuests] = useState(draft.guests || 2);
  const [sectionId, setSectionId] = useState(draft.sectionId || '');
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [time, setTime] = useState(draft.time || '');
  const [tableId, setTableId] = useState<number | null>(draft.tableId ?? null);
  const [form, setForm] = useState({ name: draft.name || user?.name || '', phone: draft.phone || user?.phone || '', email: draft.email || user?.email || '', occasion: draft.occasion || '', requests: draft.requests || '' });
  const [preorder, setPreorder] = useState(!!draft.preorder);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.name, phone: f.phone || user.phone || '', email: f.email || user.email }));
  }, [user]);

  const days = useMemo(() => [...Array(14)].map((_, i) => addDays(new Date(), i)), []);
  const maxDate = branch ? toDateInput(addDays(new Date(), branch.max_advance_days)) : undefined;

  // Fetch availability whenever date/guests/section change
  useEffect(() => {
    if (!branchId || !date || !guests) return;
    setLoading(true);
    api
      .get<Availability>(`/public/branches/${branchId}/availability`, { date, guests, sectionId: sectionId || undefined })
      .then((a) => {
        setAvail(a);
        const s = a.slots.find((x) => x.time === time);
        setSlot(s && s.available > 0 ? s : null);
        if (!s || s.available === 0) {
          if (step === 3) setStep(2);
          setTime('');
          setTableId(null);
        } else if (tableId && !s.tables.some((t) => t.id === tableId)) setTableId(null);
      })
      .catch((e) => {
        setAvail(null);
        toast.error(e.message);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, date, guests, sectionId, refreshKey]);

  const saveDraft = () => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ date, guests, sectionId, time, tableId, name: form.name, phone: form.phone, email: form.email, occasion: form.occasion, requests: form.requests, preorder }));
    } catch {
      /* ignore */
    }
  };

  const pickSlot = (s: Slot) => {
    setSlot(s);
    setTime(s.time);
    setTableId(null);
  };

  const submit = async () => {
    if (form.name.trim().length < 2) return toast.error('Please enter the guest name');
    if (!/^\+?[0-9]{10,15}$/.test(form.phone.trim())) return toast.error('Please enter a valid mobile number');
    setSubmitting(true);
    try {
      const res = await api.post<{ booking: Reservation; order: any }>('/customer/bookings', {
        branch_id: branchId,
        customer_name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        date,
        time,
        guests,
        section_id: sectionId ? Number(sectionId) : null,
        table_ids: tableId ? [tableId] : undefined,
        seating_preference: sectionId ? branch?.sections.find((s) => String(s.id) === sectionId)?.location_type : null,
        occasion: form.occasion || null,
        special_requests: form.requests.trim() || null,
        pre_order: preorder && cart.length ? { items: cart.map((l) => ({ food_item_id: l.food_item_id, quantity: l.quantity })) } : null,
      });
      sessionStorage.removeItem(DRAFT_KEY);
      if (preorder && res.order && !res.order.error) clearCart();
      if (res.order?.error) toast.error(`Booking saved, but the pre-order failed: ${res.order.error}`);
      if (Number(res.booking.advance_amount) > 0) {
        toast.info('Please complete the advance payment to secure your table');
        await pay({ reservation_id: res.booking.id });
      }
      nav(`/booking/confirmed/${res.booking.id}`, { replace: true });
    } catch (e: any) {
      toast.error(e.message);
      if (e.code === 'TABLE_UNAVAILABLE' || e.code === 'NO_AVAILABILITY') {
        setStep(2);
        setTime('');
        setSlot(null);
        setRefreshKey((k) => k + 1); // reload live availability
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!branch) return <Spinner className="h-[60vh]" />;

  const lunch = avail?.slots.filter((s) => s.time < '16:00') || [];
  const dinner = avail?.slots.filter((s) => s.time >= '16:00') || [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{branch.restaurant_name} • {branch.name}</p>
        <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Reserve a table</h1>
        <p className="mt-1 text-sm text-ink-500">Real-time availability • {branch.auto_confirm ? 'Instant confirmation' : 'Confirmed by the restaurant shortly'}</p>
      </div>

      {/* Stepper */}
      <ol className="mx-auto mb-8 flex max-w-xl items-center justify-between">
        {['Date & guests', 'Time & table', 'Your details'].map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const done = step > n;
          return (
            <li key={label} className="flex flex-1 items-center">
              <button
                disabled={n > step}
                onClick={() => setStep(n)}
                className={clsx('flex flex-col items-center gap-1 text-xs font-medium', step === n ? 'text-brand-700' : done ? 'text-ink-700' : 'text-ink-400')}
              >
                <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold', step === n ? 'bg-brand-600 text-white' : done ? 'bg-ink-900 text-white' : 'bg-ink-200 text-ink-500')}>{done ? <Check className="h-4 w-4" /> : n}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {i < 2 && <span className={clsx('mx-2 h-0.5 flex-1 rounded', step > n ? 'bg-ink-900' : 'bg-ink-200')} />}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {step === 1 && (
            <Card>
              <div className="space-y-6">
                <div>
                  <p className="label flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" /> Choose a date
                  </p>
                  <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                    {days.map((d) => {
                      const v = toDateInput(d);
                      const closed = branch.weekly_holidays?.includes(d.getDay());
                      return (
                        <button
                          key={v}
                          disabled={closed}
                          onClick={() => setDate(v)}
                          className={clsx('flex w-16 shrink-0 flex-col items-center rounded-xl border py-2 transition disabled:cursor-not-allowed disabled:opacity-40', date === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white hover:border-brand-400')}
                        >
                          <span className="text-[11px] font-medium uppercase">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                          <span className="text-xl font-bold">{d.getDate()}</span>
                          <span className="text-[11px]">{closed ? 'Closed' : d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-ink-600">
                    or pick: <Input type="date" className="w-auto" value={date} min={toDateInput()} max={maxDate} onChange={(e) => setDate(e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="label flex items-center gap-1.5">
                      <Users className="h-4 w-4" /> Number of guests
                    </p>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setGuests((g) => Math.max(branch.min_guests, g - 1))} className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-200 bg-white hover:bg-ink-50" aria-label="Fewer guests">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-12 text-center text-2xl font-bold tabular-nums">{guests}</span>
                      <button onClick={() => setGuests((g) => Math.min(branch.max_guests, g + 1))} className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-200 bg-white hover:bg-ink-50" aria-label="More guests">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {branch.min_guests}-{branch.max_guests} guests online. Larger party? Call {branch.phone}.
                    </p>
                  </div>
                  <Field label="Preferred seating area">
                    <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                      <option value="">No preference</option>
                      {branch.sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({titleCase(s.location_type)})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button size="lg" block onClick={() => setStep(2)} disabled={!avail || avail.closed}>
                  {loading ? 'Checking availability...' : avail?.closed ? avail.reason : 'See available times'}
                </Button>
              </div>
            </Card>
          )}

          {step === 2 && (
            <Card>
              <button onClick={() => setStep(1)} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
                <ChevronLeft className="h-4 w-4" /> {fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} • {guests} guests
              </button>
              {loading ? (
                <Spinner label="Checking tables..." />
              ) : !avail || avail.closed || !avail.slots.some((s) => s.available) ? (
                <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No tables available" description={avail?.reason || 'Try another date, time or seating area.'} action={<Button variant="secondary" onClick={() => setStep(1)}>Change date</Button>} />
              ) : (
                <div className="space-y-6">
                  {[
                    { label: 'Lunch', slots: lunch },
                    { label: 'Dinner', slots: dinner },
                  ].map(
                    (g) =>
                      g.slots.length > 0 && (
                        <div key={g.label}>
                          <p className="label">{g.label}</p>
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                            {g.slots.map((s) => (
                              <button
                                key={s.time}
                                disabled={!s.available}
                                onClick={() => pickSlot(s)}
                                className={clsx(
                                  'rounded-xl border px-2 py-2.5 text-center transition disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-300 disabled:line-through',
                                  time === s.time ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white hover:border-brand-400'
                                )}
                              >
                                <span className="block text-sm font-semibold">{fmtTime(s.time)}</span>
                                <span className={clsx('block text-[11px]', time === s.time ? 'text-white/80' : s.available <= 2 ? 'text-orange-600' : 'text-ink-500')}>{s.available ? `${s.available} table${s.available > 1 ? 's' : ''}` : 'Full'}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                  )}

                  {slot && (
                    <div className="animate-fade-in border-t border-ink-100 pt-5">
                      <p className="label flex items-center gap-1.5">
                        <Armchair className="h-4 w-4" /> Choose your table (optional)
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button onClick={() => setTableId(null)} className={clsx('flex items-center gap-3 rounded-xl border p-3 text-left', tableId === null ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:bg-ink-50')}>
                          <Sparkles className="h-5 w-5 text-brand-600" />
                          <span>
                            <span className="block text-sm font-semibold">Best available</span>
                            <span className="block text-xs text-ink-500">We'll pick the best table for your party</span>
                          </span>
                        </button>
                        {slot.tables.map((t) => (
                          <button key={t.id} onClick={() => setTableId(t.id)} className={clsx('flex items-center gap-3 rounded-xl border p-3 text-left', tableId === t.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:bg-ink-50')}>
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-900 text-xs font-bold text-white">{t.table_number}</span>
                            <span>
                              <span className="block text-sm font-semibold">
                                {t.section_name || 'Main'} • seats {t.capacity}
                              </span>
                              <span className="block text-xs text-ink-500">
                                {titleCase(t.location_type)} • {titleCase(t.table_type)}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                      <Button size="lg" block className="mt-5" onClick={() => setStep(3)}>
                        Continue
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {step === 3 && (
            <Card>
              <button onClick={() => setStep(2)} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
                <ChevronLeft className="h-4 w-4" /> Change time or table
              </button>
              {!user ? (
                <EmptyState
                  title="Sign in to confirm your booking"
                  description="Your selection is saved. Sign in or create an account to finish - it takes less than a minute."
                  action={
                    <div className="flex gap-2">
                      <Link to="/login" state={{ from: '/book' }} onClick={saveDraft}>
                        <Button>Sign in</Button>
                      </Link>
                      <Link to="/register" onClick={saveDraft}>
                        <Button variant="secondary">Create account</Button>
                      </Link>
                    </div>
                  }
                />
              ) : user.is_staff ? (
                <EmptyState title="Staff accounts can't book online" description="Use the admin Reservations screen to create bookings for guests." />
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Guest name" required>
                      <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label="Mobile number" required>
                      <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </Field>
                    <Field label="Email">
                      <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </Field>
                    <Field label="Occasion">
                      <Select value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })} options={OCCASIONS} placeholder="None" />
                    </Field>
                  </div>
                  <Field label="Special instructions" hint="Dietary needs, high chair, cake arrangement, wheelchair access...">
                    <Textarea value={form.requests} onChange={(e) => setForm({ ...form, requests: e.target.value })} maxLength={1000} />
                  </Field>
                  <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
                    <div className="flex items-start gap-3">
                      <ShoppingBag className="mt-0.5 h-5 w-5 text-brand-600" />
                      <div className="flex-1 text-sm">
                        <p className="font-semibold">Pre-order food (optional)</p>
                        {cart.length ? (
                          <>
                            <p className="text-ink-600">
                              Add the {cart.reduce((s, l) => s + l.quantity, 0)} item(s) in your cart as a pre-order so it's ready when you arrive.
                            </p>
                            <div className="mt-2">
                              <Checkbox checked={preorder} onChange={setPreorder} label="Yes, pre-order my cart items" />
                            </div>
                          </>
                        ) : (
                          <p className="text-ink-600">
                            Add dishes from the{' '}
                            <Link to="/menu" className="link" onClick={saveDraft}>
                              menu
                            </Link>{' '}
                            to your cart and come back to pre-order them.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {branch.booking_policy && (
                    <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                      <Info className="h-4 w-4 shrink-0" />
                      <p>
                        <span className="font-semibold">Booking policy: </span>
                        {branch.booking_policy}
                      </p>
                    </div>
                  )}
                  <Button size="lg" block loading={submitting} onClick={submit}>
                    {branch.advance_payment_required && Number(branch.advance_payment_amount) > 0 ? `Confirm & pay ${money(branch.advance_payment_amount)} advance` : 'Confirm booking'}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Summary */}
        <aside className="space-y-4">
          <div className="card overflow-hidden">
            <div className="bg-ink-900 px-5 py-4 text-white">
              <p className="text-xs uppercase tracking-wide text-ink-400">Your reservation</p>
              <p className="mt-1 font-display text-xl font-bold">{branch.restaurant_name}</p>
              <p className="text-sm text-ink-300">{branch.name}</p>
            </div>
            <dl className="space-y-3 p-5 text-sm">
              <Summary icon={CalendarDays} label="Date" value={fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} />
              <Summary icon={Clock} label="Time" value={time ? `${fmtTime(time)}${slot ? ` - ${fmtTime(slot.end_time)}` : ''}` : 'Not selected'} />
              <Summary icon={Users} label="Guests" value={`${guests} ${guests === 1 ? 'person' : 'people'}`} />
              <Summary icon={Armchair} label="Seating" value={tableId && slot ? `Table ${slot.tables.find((t) => t.id === tableId)?.table_number}` : sectionId ? branch.sections.find((s) => String(s.id) === sectionId)?.name || '-' : 'Best available'} />
            </dl>
          </div>
          <div className="card space-y-2 p-5 text-xs text-ink-600">
            <p>
              <span className="font-semibold text-ink-800">Duration:</span> {branch.reservation_duration_min} minutes per seating
            </p>
            <p>
              <span className="font-semibold text-ink-800">Free cancellation:</span> up to {branch.cancellation_deadline_hours} hour(s) before
            </p>
            {branch.advance_payment_required && (
              <p>
                <span className="font-semibold text-ink-800">Advance:</span> {money(branch.advance_payment_amount)} (refunded if the restaurant rejects or you cancel in time)
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

const Summary = ({ icon: I, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-center gap-3">
    <I className="h-4 w-4 text-brand-600" />
    <dt className="w-16 text-ink-500">{label}</dt>
    <dd className="font-medium text-ink-900">{value}</dd>
  </div>
);
