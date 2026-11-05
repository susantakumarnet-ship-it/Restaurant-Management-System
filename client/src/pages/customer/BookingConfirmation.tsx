import { Link, useParams } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, Clock, Download, Hourglass, MapPin, Users, Armchair } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '../../lib/api';
import { fmtDate, fmtTime, money } from '../../lib/format';
import { useApi } from '../../hooks/useApi';
import { usePayment } from '../../context/PaymentContext';
import { Button, ErrorState, Spinner, StatusBadge } from '../../components/ui';
import { downloadIcs, tablesText } from './bookingShared';

export default function BookingConfirmation() {
  const { id } = useParams();
  const pay = usePayment();
  const { data: b, loading, error, reload } = useApi<any>(() => api.get(`/customer/bookings/${id}`), [id]);
  if (loading && !b) return <Spinner className="h-[60vh]" />;
  if (error || !b) return <ErrorState error={error || 'Not found'} onRetry={reload} />;
  const confirmed = b.status === 'confirmed';
  const needsPayment = Number(b.advance_amount) > 0 && ['pending', 'partially_paid'].includes(b.payment_status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="card overflow-hidden">
        <div className={`px-6 py-10 text-center ${confirmed ? 'bg-gradient-to-br from-emerald-600 to-emerald-700' : 'bg-gradient-to-br from-brand-600 to-orange-700'} text-white`}>
          {confirmed ? <CheckCircle2 className="mx-auto h-14 w-14" /> : <Hourglass className="mx-auto h-14 w-14" />}
          <h1 className="mt-4 font-display text-3xl font-bold">{confirmed ? 'Your table is confirmed!' : 'Booking request received'}</h1>
          <p className="mt-2 text-white/85">{confirmed ? "We've sent the confirmation to your email and phone." : "We'll notify you by email/SMS as soon as the restaurant confirms."}</p>
          <div className="mx-auto mt-6 inline-block rounded-2xl bg-white/15 px-6 py-3">
            <p className="text-xs uppercase tracking-widest text-white/70">Booking ID</p>
            <p className="font-mono text-2xl font-bold tracking-wider">{b.booking_code}</p>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink-900">{b.restaurant_name}</p>
              <p className="flex items-center gap-1 text-sm text-ink-500">
                <MapPin className="h-3.5 w-3.5" /> {b.branch_name}
              </p>
            </div>
            <StatusBadge status={b.status} />
          </div>
          <div className="grid gap-3 rounded-xl bg-ink-50 p-4 sm:grid-cols-2">
            <Item icon={Clock} label="When" value={`${fmtDate(b.booking_date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmtTime(b.start_at)}`} />
            <Item icon={Users} label="Guests" value={`${b.guests} people`} />
            <Item icon={Armchair} label="Table" value={tablesText(b)} />
            <Item icon={CalendarPlus} label="Occasion" value={b.occasion ? b.occasion[0].toUpperCase() + b.occasion.slice(1) : '-'} />
          </div>
          {needsPayment && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-amber-900">
                Advance payment of <b>{money(b.advance_amount)}</b> is pending.
              </p>
              <Button size="sm" onClick={async () => (await pay({ reservation_id: b.id })) && reload()}>
                Pay now
              </Button>
            </div>
          )}
          {b.orders?.length > 0 && <p className="text-sm text-ink-600">Pre-order {b.orders[0].order_code} ({money(b.orders[0].total)}) is linked to this booking.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/customer/bookings/${b.id}/confirmation.pdf`).catch((e) => toast.error(e.message))}>
              Download PDF
            </Button>
            <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => downloadIcs(b)}>
              Add to calendar
            </Button>
            <Link to={`/my/bookings/${b.id}`} className="sm:ml-auto">
              <Button variant="dark">Manage booking</Button>
            </Link>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-ink-500">
        Hungry already?{' '}
        <Link to="/menu" className="link">
          Browse the menu
        </Link>
      </p>
    </div>
  );
}

const Item = ({ icon: I, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-start gap-2.5">
    <I className="mt-0.5 h-4 w-4 text-brand-600" />
    <div>
      <p className="text-xs text-ink-500">{label}</p>
      <p className="text-sm font-semibold text-ink-900">{value}</p>
    </div>
  </div>
);
