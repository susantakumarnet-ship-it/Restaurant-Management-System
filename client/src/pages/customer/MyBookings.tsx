import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Clock, Users, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate, fmtTime, money, toDateInput } from '../../lib/format';
import { useApi } from '../../hooks/useApi';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, Tabs } from '../../components/ui';
import { AccountNav } from './AccountNav';

type Tab = 'upcoming' | 'past' | 'cancelled';

export default function MyBookings() {
  const { data, loading, error, reload } = useApi<any[]>(() => api.get('/customer/bookings'), []);
  const [tab, setTab] = useState<Tab>('upcoming');
  // Booking times are local wall-clock strings, so compare against local "now" (not UTC).
  const now = `${toDateInput()}T${new Date().toTimeString().slice(0, 5)}`;

  const groups = useMemo(() => {
    const list = data || [];
    return {
      upcoming: list.filter((b) => ['pending', 'confirmed', 'checked_in', 'seated'].includes(b.status) && b.end_at.slice(0, 16) >= now).sort((a, b) => a.start_at.localeCompare(b.start_at)),
      past: list.filter((b) => ['completed', 'no_show'].includes(b.status) || (['pending', 'confirmed'].includes(b.status) && b.end_at.slice(0, 16) < now)),
      cancelled: list.filter((b) => ['cancelled', 'rejected'].includes(b.status)),
    };
  }, [data, now]);

  const list = groups[tab];
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <AccountNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">My bookings</h1>
        <Link to="/book">
          <Button icon={<Plus className="h-4 w-4" />}>New booking</Button>
        </Link>
      </div>
      <Tabs
        className="mb-5 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
          { value: 'past', label: 'History', count: groups.past.length },
          { value: 'cancelled', label: 'Cancelled', count: groups.cancelled.length },
        ]}
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={tab === 'upcoming' ? 'No upcoming bookings' : 'Nothing here yet'} description={tab === 'upcoming' ? 'Reserve a table and it will show up here.' : undefined} action={tab === 'upcoming' && <Link to="/book"><Button>Book a table</Button></Link>} />
      ) : (
        <div className="space-y-3">
          {list.map((b) => (
            <Link key={b.id} to={`/my/bookings/${b.id}`} className="card flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex w-16 shrink-0 flex-col items-center rounded-xl bg-ink-900 py-2 text-white">
                <span className="text-[11px] uppercase text-brand-400">{fmtDate(b.booking_date, { month: 'short' })}</span>
                <span className="text-2xl font-bold leading-none">{Number(b.booking_date.slice(8, 10))}</span>
                <span className="text-[11px] text-ink-400">{fmtDate(b.booking_date, { weekday: 'short' })}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-900">{b.restaurant_name}</p>
                  <StatusBadge status={b.status} />
                  {Number(b.advance_amount) > 0 && <StatusBadge status={b.payment_status} label={`Advance ${b.payment_status.replace('_', ' ')}`} />}
                </div>
                <p className="text-sm text-ink-500">{b.branch_name}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {fmtTime(b.start_at)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {b.guests} guests
                  </span>
                  <span>Table: {b.tables || 'TBA'}</span>
                  <span className="font-mono">{b.booking_code}</span>
                  {Number(b.advance_amount) > 0 && <span>Advance {money(b.advance_amount)}</span>}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-300" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
