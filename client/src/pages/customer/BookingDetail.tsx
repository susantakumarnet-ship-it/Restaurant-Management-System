import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, Clock, Download, MapPin, Pencil, Phone, Users, XCircle, Armchair, MessageSquare, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtTime, money, titleCase } from '../../lib/format';
import { useApi } from '../../hooks/useApi';
import { usePayment } from '../../context/PaymentContext';
import { Button, Card, ErrorState, Spinner, StatusBadge, useConfirm } from '../../components/ui';
import { downloadIcs, ModifyBookingModal, tablesText } from './bookingShared';
import { AccountNav } from './AccountNav';

export default function BookingDetail() {
  const { id } = useParams();
  const confirm = useConfirm();
  const pay = usePayment();
  const { data: b, loading, error, reload } = useApi<any>(() => api.get(`/customer/bookings/${id}`), [id]);
  const [modify, setModify] = useState(false);

  if (loading && !b) return <Spinner className="h-[60vh]" />;
  if (error || !b) return <ErrorState error={error || 'Booking not found'} onRetry={reload} />;

  const deadline = new Date(new Date(b.start_at).getTime() - (b.cancellation_deadline_hours || 0) * 3600000);
  const changeable = ['pending', 'confirmed'].includes(b.status) && Date.now() < deadline.getTime();
  const needsPayment = Number(b.advance_amount) > 0 && ['pending', 'partially_paid'].includes(b.payment_status) && ['pending', 'confirmed'].includes(b.status);

  const cancel = async () => {
    const r = await confirm({
      title: 'Cancel this booking?',
      message: Number(b.advance_amount) > 0 && b.payment_status === 'paid' ? `Your advance of ${money(b.advance_amount)} will be refunded.` : 'The table will be released for other guests.',
      danger: true,
      confirmText: 'Cancel booking',
      requireReason: false,
      reasonLabel: 'Reason (optional)',
    });
    if (!r.ok) return;
    try {
      await api.post(`/customer/bookings/${b.id}/cancel`, { reason: r.reason });
      toast.success('Booking cancelled');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <AccountNav />
      <Link to="/my/bookings" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> All bookings
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-ink-500">{b.booking_code}</p>
          <h1 className="font-display text-3xl font-bold">{b.restaurant_name}</h1>
          <p className="flex items-center gap-1 text-sm text-ink-500">
            <MapPin className="h-4 w-4" /> {b.branch_name}
            {b.branch_address ? `, ${b.branch_address}` : ''}
          </p>
        </div>
        <StatusBadge status={b.status} className="text-sm" />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card title="Reservation details">
            <dl className="grid gap-4 sm:grid-cols-2">
              <D icon={Clock} label="Date & time" value={`${fmtDate(b.booking_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(b.start_at)} - ${fmtTime(b.end_at)}`} />
              <D icon={Users} label="Guests" value={`${b.guests} people`} />
              <D icon={Armchair} label="Table" value={`${tablesText(b)}${b.section_name ? ` • ${b.section_name}` : ''}`} />
              <D icon={CalendarPlus} label="Occasion" value={titleCase(b.occasion) || '-'} />
              <D icon={Phone} label="Contact" value={`${b.customer_name} • ${b.phone}`} />
              <D icon={CreditCard} label="Advance payment" value={Number(b.advance_amount) > 0 ? `${money(b.advance_amount)} • ${titleCase(b.payment_status)}` : 'Not required'} />
              {b.special_requests && <D icon={MessageSquare} label="Special requests" value={b.special_requests} className="sm:col-span-2" />}
              {b.cancel_reason && <D icon={XCircle} label="Cancellation reason" value={b.cancel_reason} className="sm:col-span-2" />}
            </dl>
          </Card>

          {b.orders?.length > 0 && (
            <Card title="Pre-ordered food">
              {b.orders.map((o: any) => (
                <Link key={o.id} to={`/my/orders/${o.id}`} className="flex items-center justify-between rounded-lg p-2 hover:bg-ink-50">
                  <span className="font-mono text-sm">{o.order_code}</span>
                  <span className="flex items-center gap-2 text-sm">
                    {money(o.total)} <StatusBadge status={o.status} />
                  </span>
                </Link>
              ))}
            </Card>
          )}

          <Card title="Status timeline">
            <ol className="relative space-y-4 border-l-2 border-ink-100 pl-5">
              {b.history.map((h: any, i: number) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-600 ring-2 ring-brand-100" />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={h.to_status} />
                    <span className="text-xs text-ink-500">{fmtDateTime(h.created_at)}</span>
                  </div>
                  {h.note && <p className="mt-1 text-sm text-ink-600">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <div className="space-y-2">
              {needsPayment && (
                <Button block icon={<CreditCard className="h-4 w-4" />} onClick={async () => (await pay({ reservation_id: b.id })) && reload()}>
                  Pay advance {money(b.advance_amount)}
                </Button>
              )}
              <Button block variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/customer/bookings/${b.id}/confirmation.pdf`).catch((e) => toast.error(e.message))}>
                Download confirmation
              </Button>
              <Button block variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => downloadIcs(b)}>
                Add to calendar
              </Button>
              {changeable && (
                <>
                  <Button block variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setModify(true)}>
                    Modify booking
                  </Button>
                  <Button block variant="ghost" className="text-red-600 hover:bg-red-50" icon={<XCircle className="h-4 w-4" />} onClick={cancel}>
                    Cancel booking
                  </Button>
                </>
              )}
            </div>
            {['pending', 'confirmed'].includes(b.status) && (
              <p className="mt-3 text-xs text-ink-500">
                {changeable ? `Free changes/cancellation until ${fmtDateTime(deadline.toISOString())}.` : `Changes are closed (${b.cancellation_deadline_hours}h before the booking). Please call the restaurant.`}
              </p>
            )}
          </Card>
          {b.branch_phone && (
            <a href={`tel:${b.branch_phone}`} className="card flex items-center gap-3 p-4 text-sm hover:bg-ink-50">
              <Phone className="h-4 w-4 text-brand-600" /> Call {b.branch_phone}
            </a>
          )}
        </div>
      </div>
      {modify && <ModifyBookingModal booking={b} open={modify} onClose={() => setModify(false)} onSaved={reload} />}
    </div>
  );
}

const D = ({ icon: I, label, value, className }: { icon: any; label: string; value: string; className?: string }) => (
  <div className={`flex gap-3 ${className || ''}`}>
    <I className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="text-sm font-medium text-ink-900">{value}</dd>
    </div>
  </div>
);
