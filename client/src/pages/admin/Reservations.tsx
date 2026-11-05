import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, ChevronRight, Download, List, Pencil, Plus, Send, Armchair, Users, Phone, Mail, X } from 'lucide-react';
import { adminApi, downloadFile } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { fmtDate, fmtDateTime, fmtTime, money, OCCASIONS, STATUS_TONE, titleCase, toDateInput } from '../../lib/format';
import type { Availability, Reservation } from '../../lib/types';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea, useConfirm, type Column } from '../../components/ui';

const STATUSES = ['pending', 'confirmed', 'checked_in', 'seated', 'completed', 'cancelled', 'rejected', 'no_show'];
const TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['checked_in', 'seated', 'completed', 'cancelled', 'no_show'],
  checked_in: ['seated', 'completed', 'cancelled', 'no_show'],
  seated: ['completed'],
};
const ACTION: Record<string, { label: string; variant: 'primary' | 'secondary' | 'danger' | 'success' | 'dark'; reason?: boolean }> = {
  confirmed: { label: 'Approve', variant: 'success' },
  rejected: { label: 'Reject', variant: 'danger', reason: true },
  checked_in: { label: 'Check in', variant: 'primary' },
  seated: { label: 'Seat guests', variant: 'dark' },
  completed: { label: 'Complete', variant: 'success' },
  cancelled: { label: 'Cancel', variant: 'secondary', reason: true },
  no_show: { label: 'No-show', variant: 'secondary', reason: true },
};

type ResRow = Reservation & { tables: { id: number; table_number: string; capacity: number }[] };
const tableList = (r: ResRow) => (Array.isArray(r.tables) ? r.tables.map((t) => t.table_number).join(', ') : '');

export default function Reservations() {
  const [params, setParams] = useSearchParams();
  const { hasPerm } = useAuth();
  const canManage = hasPerm('reservations.manage');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [status, setStatus] = useState<string>(params.get('status') || 'all');
  const [filters, setFilters] = useState({ q: '', date: '', time: '', tableId: '', sectionId: '', sort: 'upcoming' });
  const [openId, setOpenId] = useState<number | null>(params.get('id') ? Number(params.get('id')) : null);
  const [creating, setCreating] = useState(false);

  const { data: tables } = useApi<any[]>(() => adminApi.get('/tables'), []);
  const { data: sections } = useApi<any[]>(() => adminApi.get('/sections'), []);
  const { data, loading, error, reload } = useApi<ResRow[]>(() => adminApi.get('/reservations', filters), [JSON.stringify(filters)]);

  useEffect(() => {
    const id = params.get('id');
    if (id) setOpenId(Number(id));
  }, [params]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length || 0 };
    data?.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
    return c;
  }, [data]);
  const rows = useMemo(() => (status === 'all' ? data : data?.filter((r) => r.status === status)) || null, [data, status]);
  const setF = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const closeDrawer = () => {
    setOpenId(null);
    if (params.get('id')) {
      params.delete('id');
      setParams(params, { replace: true });
    }
  };

  const columns: Column<ResRow>[] = [
    { key: 'booking_code', header: 'Booking', render: (r) => <span className="font-mono text-xs font-semibold text-ink-900">{r.booking_code}</span> },
    {
      key: 'start_at',
      header: 'When',
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{fmtDate(r.booking_date, { day: 'numeric', month: 'short', weekday: 'short' })}</p>
          <p className="text-xs text-ink-500">{fmtTime(r.start_at)}</p>
        </div>
      ),
    },
    {
      key: 'customer_name',
      header: 'Guest',
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.customer_name}</p>
          <p className="text-xs text-ink-500">{r.phone}</p>
        </div>
      ),
      value: (r) => `${r.customer_name} ${r.phone}`,
    },
    { key: 'guests', header: 'Guests', align: 'center' },
    { key: 'tables', header: 'Table(s)', value: tableList, render: (r) => tableList(r) || <span className="text-xs text-amber-700">Unassigned</span> },
    { key: 'occasion', header: 'Occasion', hideOnMobile: true, render: (r) => (r.occasion ? titleCase(r.occasion) : '-') },
    { key: 'source', header: 'Source', hideOnMobile: true, render: (r) => titleCase(r.source) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle="Manage table bookings, approvals and seating"
        actions={
          <>
            <Tabs value={view} onChange={setView} tabs={[{ value: 'list', label: <span className="inline-flex items-center gap-1"><List className="h-4 w-4" />List</span> }, { value: 'calendar', label: <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" />Calendar</span> }]} />
            {canManage && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New booking
              </Button>
            )}
          </>
        }
      />

      {view === 'calendar' ? (
        <CalendarView
          onPick={(d) => {
            setF('date', d);
            setView('list');
          }}
        />
      ) : (
        <>
          <Tabs className="mb-3" value={status} onChange={setStatus} tabs={[{ value: 'all', label: 'All', count: counts.all }, ...STATUSES.map((s) => ({ value: s, label: titleCase(s), count: counts[s] || 0 }))]} />
          {error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : (
            <DataTable
              rows={rows}
              loading={loading}
              columns={columns}
              searchable={false}
              onRowClick={(r) => setOpenId(r.id)}
              toolbar={
                <div className="flex w-full flex-wrap items-center gap-2">
                  <Input className="w-full sm:w-56" placeholder="Booking ID, name or phone" value={filters.q} onChange={(e) => setF('q', e.target.value)} />
                  <Input type="date" className="w-auto" value={filters.date} onChange={(e) => setF('date', e.target.value)} aria-label="Date" />
                  <Input type="time" className="w-auto" value={filters.time} onChange={(e) => setF('time', e.target.value)} aria-label="Time" />
                  <Select className="w-auto" value={filters.tableId} onChange={(e) => setF('tableId', e.target.value)} placeholder="All tables" options={(tables || []).map((t) => ({ value: t.id, label: `Table ${t.table_number}` }))} />
                  <Select className="w-auto" value={filters.sectionId} onChange={(e) => setF('sectionId', e.target.value)} placeholder="All areas" options={(sections || []).map((s) => ({ value: s.id, label: s.name }))} />
                  <Select className="w-auto" value={filters.sort} onChange={(e) => setF('sort', e.target.value)} options={[{ value: 'upcoming', label: 'Upcoming first' }, { value: 'latest', label: 'Latest first' }, { value: 'created', label: 'Recently created' }]} />
                  <Button size="sm" variant="ghost" onClick={() => setF('date', toDateInput())}>
                    Today
                  </Button>
                  {(filters.q || filters.date || filters.time || filters.tableId || filters.sectionId) && (
                    <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setFilters({ q: '', date: '', time: '', tableId: '', sectionId: '', sort: filters.sort })}>
                      Clear
                    </Button>
                  )}
                </div>
              }
            />
          )}
        </>
      )}

      {openId && <ReservationDrawer id={openId} canManage={canManage} onClose={closeDrawer} onChanged={reload} />}
      <NewBookingModal open={creating} onClose={() => setCreating(false)} sections={sections || []} onCreated={(r) => (reload(), setOpenId(r.id))} />
    </div>
  );
}

// ---------------- Calendar ----------------
function CalendarView({ onPick }: { onPick: (date: string) => void }) {
  const [month, setMonth] = useState(() => toDateInput().slice(0, 7));
  const { data, loading } = useApi<{ days: { date: string; total: number; guests: number; byStatus: Record<string, number> }[] }>(() => adminApi.get('/reservations/calendar', { month }), [month]);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDate = new Map((data?.days || []).map((d) => [d.date, d]));
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(toDateInput(d).slice(0, 7));
  };
  const today = toDateInput();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <Card
      title={first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => shift(-1)} aria-label="Previous month" />
          <Button size="sm" variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
          <Button size="sm" variant="ghost" icon={<ChevronRight className="h-4 w-4" />} onClick={() => shift(1)} aria-label="Next month" />
        </>
      }
    >
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-1.5">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1 text-center text-xs font-semibold uppercase text-ink-500">
                {d}
              </div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const date = `${month}-${String(d).padStart(2, '0')}`;
              const info = byDate.get(date);
              return (
                <button
                  key={i}
                  onClick={() => onPick(date)}
                  className={clsx('flex min-h-[88px] flex-col rounded-xl border p-2 text-left transition hover:border-brand-400 hover:bg-brand-50/40', date === today ? 'border-brand-500 ring-1 ring-brand-500' : 'border-ink-200')}
                >
                  <span className={clsx('text-sm font-semibold', date === today ? 'text-brand-700' : 'text-ink-800')}>{d}</span>
                  {info && (
                    <div className="mt-auto space-y-0.5">
                      <p className="text-xs font-medium text-ink-800">
                        {info.total} booking{info.total > 1 ? 's' : ''}
                      </p>
                      <p className="text-[11px] text-ink-500">{info.guests} guests</p>
                      {info.byStatus.pending ? <Badge tone="amber" className="!px-1.5 text-[10px]">{info.byStatus.pending} pending</Badge> : null}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------- Detail drawer ----------------
function ReservationDrawer({ id, canManage, onClose, onChanged }: { id: number; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { data: r, loading, error, reload } = useApi<any>(() => adminApi.get(`/reservations/${id}`), [id]);
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const refresh = () => (reload(), onChanged());

  const change = async (to: string) => {
    const a = ACTION[to];
    // Server rejects confirming a booking with no table (booking.changeStatus) - guide the user instead.
    if (to === 'confirmed' && !r.tables.length) {
      toast.error('Assign a table before approving this booking');
      setAssigning(true);
      return;
    }
    let note: string | undefined;
    if (a.reason || to === 'confirmed') {
      const res = await confirm({
        title: `${a.label} booking ${r.booking_code}?`,
        message: to === 'confirmed' ? 'The guest will be notified by email/SMS.' : 'The guest will be notified and the table released.',
        confirmText: a.label,
        danger: a.variant === 'danger',
        requireReason: a.reason ? true : undefined,
        reasonLabel: to === 'rejected' ? 'Reason (shared with the guest)' : 'Reason',
      });
      if (!res.ok) return;
      note = res.reason;
    }
    setBusy(to);
    try {
      await adminApi.patch(`/reservations/${id}/status`, { status: to, note });
      toast.success(`Booking ${titleCase(to).toLowerCase()}`);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const notifyGuest = async () => {
    setBusy('notify');
    try {
      await adminApi.post(`/reservations/${id}/notify`, {});
      toast.success('Notification sent to guest');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const active = r && ['pending', 'confirmed', 'checked_in', 'seated'].includes(r.status);
  return (
    <Drawer
      open
      onClose={onClose}
      title={r ? <span className="flex items-center gap-2">{r.booking_code} <StatusBadge status={r.status} /></span> : 'Booking'}
      footer={
        r && canManage ? (
          <div className="flex w-full flex-wrap gap-2">
            {(TRANSITIONS[r.status] || []).map((to) => (
              <Button key={to} size="sm" variant={ACTION[to].variant} loading={busy === to} onClick={() => change(to)}>
                {ACTION[to].label}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !r ? (
        <Spinner />
      ) : r ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-4 text-sm">
            <div>
              <p className="label">Date</p>
              <p className="font-semibold">{fmtDate(r.booking_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>
            <div>
              <p className="label">Time</p>
              <p className="font-semibold">
                {fmtTime(r.start_at)} - {fmtTime(r.end_at)}
              </p>
            </div>
            <div>
              <p className="label">Guests</p>
              <p className="font-semibold">{r.guests}</p>
            </div>
            <div>
              <p className="label">Table(s)</p>
              <p className="font-semibold">{r.tables.length ? r.tables.map((t: any) => `${t.table_number}${t.section_name ? ` (${t.section_name})` : ''}`).join(', ') : <span className="text-amber-700">Not assigned</span>}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {canManage && active && (
              <>
                <Button size="sm" variant="secondary" icon={<Armchair className="h-4 w-4" />} onClick={() => setAssigning(true)}>
                  {r.tables.length ? 'Reassign tables' : 'Assign table'}
                </Button>
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Modify
                </Button>
              </>
            )}
            {canManage && (
              <Button size="sm" variant="secondary" icon={<Send className="h-4 w-4" />} loading={busy === 'notify'} onClick={notifyGuest}>
                Notify guest
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/admin/reservations/${id}/confirmation.pdf`, undefined, { branch: true }).catch((e) => toast.error(e.message))}>
              Confirmation PDF
            </Button>
          </div>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-ink-900">Guest</h4>
            <div className="space-y-1.5 text-sm text-ink-700">
              <p className="font-medium text-ink-900">{r.customer_name}</p>
              <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-400" /> <a href={`tel:${r.phone}`} className="link">{r.phone}</a></p>
              {r.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-ink-400" /> {r.email}</p>}
              {r.customer && (
                <p className="flex items-center gap-2"><Users className="h-4 w-4 text-ink-400" /> {r.customer.visits} visits · {r.customer.loyalty_points} loyalty points · spent {money(r.customer.total_spent)}</p>
              )}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="label">Occasion</p><p>{r.occasion ? titleCase(r.occasion) : '-'}</p></div>
            <div><p className="label">Source</p><p>{titleCase(r.source)}</p></div>
            <div><p className="label">Seating preference</p><p>{r.section_name || r.seating_preference || '-'}</p></div>
            <div><p className="label">Advance</p><p>{Number(r.advance_amount) ? `${money(r.advance_amount)} · ` : ''}<StatusBadge status={r.payment_status} /></p></div>
            <div className="col-span-2"><p className="label">Special requests</p><p className="whitespace-pre-line">{r.special_requests || '-'}</p></div>
            {r.admin_notes && <div className="col-span-2"><p className="label">Staff notes</p><p className="whitespace-pre-line">{r.admin_notes}</p></div>}
            {r.cancel_reason && <div className="col-span-2"><p className="label">Cancellation reason</p><p>{r.cancel_reason}</p></div>}
          </section>

          {r.payments.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-ink-900">Payments</h4>
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 text-sm">
                {r.payments.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2">
                    <span>{p.payment_code} · {titleCase(p.method)}</span>
                    <span className="flex items-center gap-2 font-medium">{money(p.amount)} <StatusBadge status={p.status} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.orders.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-ink-900">Pre-orders</h4>
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 text-sm">
                {r.orders.map((o: any) => (
                  <li key={o.id} className="flex items-center justify-between px-3 py-2">
                    <a className="link" href={`/admin/orders?id=${o.id}`}>{o.order_code}</a>
                    <span className="flex items-center gap-2">{money(o.total)} <StatusBadge status={o.status} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h4 className="mb-2 text-sm font-semibold text-ink-900">History</h4>
            <ol className="relative space-y-3 border-l border-ink-200 pl-4">
              {r.history.map((h: any) => (
                <li key={h.id} className="text-sm">
                  <span className={clsx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full', STATUS_TONE[h.to_status] === 'red' ? 'bg-red-500' : 'bg-brand-500')} />
                  <p className="font-medium text-ink-900">
                    {h.from_status && h.from_status !== h.to_status ? `${titleCase(h.from_status)} → ` : ''}
                    {titleCase(h.to_status)}
                  </p>
                  {h.note && <p className="text-ink-600">{h.note}</p>}
                  <p className="text-xs text-ink-400">
                    {fmtDateTime(h.created_at)}
                    {h.changed_by_name ? ` · ${h.changed_by_name}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
      {r && assigning && <AssignTablesModal reservation={r} onClose={() => setAssigning(false)} onDone={refresh} />}
      {r && editing && <EditBookingModal reservation={r} onClose={() => setEditing(false)} onDone={refresh} />}
    </Drawer>
  );
}

// ---------------- Assign tables ----------------
function AssignTablesModal({ reservation: r, onClose, onDone }: { reservation: any; onClose: () => void; onDone: () => void }) {
  const time = r.start_at.slice(11, 16);
  // Ask for guests=1 so smaller tables can be combined for large parties.
  const { data, loading, error } = useApi<Availability>(() => adminApi.get('/reservations/availability', { date: r.booking_date, guests: 1, excludeReservationId: r.id }), [r.id]);
  const [selected, setSelected] = useState<number[]>(r.tables.map((t: any) => t.id));
  const [saving, setSaving] = useState(false);
  const slot = data?.slots.find((s) => s.time === time);
  const free = slot?.tables || [];
  const seats = free.filter((t) => selected.includes(t.id)).reduce((s, t) => s + t.capacity, 0);
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.put(`/reservations/${r.id}/tables`, { table_ids: selected });
      toast.success('Tables assigned');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Assign tables"
      description={`${fmtDate(r.booking_date)} at ${fmtTime(r.start_at)} · ${r.guests} guests`}
      footer={
        <>
          <span className={clsx('mr-auto self-center text-sm', seats >= r.guests ? 'text-emerald-700' : 'text-amber-700')}>
            {seats} seats selected for {r.guests} guests
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!selected.length || seats < r.guests} onClick={save}>Save</Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} />
      ) : loading ? (
        <Spinner />
      ) : !slot ? (
        <EmptyState title="This time is outside the bookable slots" description="Tables can still be assigned from a valid slot. Modify the booking time first." />
      ) : free.length === 0 ? (
        <EmptyState title="No free tables for this slot" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {free.map((t) => (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={clsx('rounded-xl border p-3 text-left transition', selected.includes(t.id) ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:bg-ink-50')}
            >
              <p className="font-semibold text-ink-900">Table {t.table_number}</p>
              <p className="text-xs text-ink-500">{t.capacity} seats · {t.section_name || titleCase(t.table_type)}</p>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------------- Modify booking ----------------
function EditBookingModal({ reservation: r, onClose, onDone }: { reservation: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    customer_name: r.customer_name,
    phone: r.phone,
    email: r.email || '',
    date: r.booking_date,
    time: r.start_at.slice(11, 16),
    guests: String(r.guests),
    occasion: r.occasion || '',
    special_requests: r.special_requests || '',
    admin_notes: r.admin_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      await adminApi.put(`/reservations/${r.id}`, { ...f, guests: Number(f.guests), email: f.email || null, occasion: f.occasion || null });
      toast.success('Booking updated');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Modify ${r.booking_code}`} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save changes</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Guest name" required><Input value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} /></Field>
        <Field label="Mobile" required><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Guests" required><Input type="number" min={1} value={f.guests} onChange={(e) => set('guests', e.target.value)} /></Field>
        <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Time" required hint="Tables are re-checked for availability"><Input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} /></Field>
        <Field label="Occasion"><Select value={f.occasion} onChange={(e) => set('occasion', e.target.value)} placeholder="None" options={OCCASIONS} /></Field>
        <div />
        <Field label="Special requests" className="sm:col-span-2"><Textarea value={f.special_requests} onChange={(e) => set('special_requests', e.target.value)} /></Field>
        <Field label="Staff notes (internal)" className="sm:col-span-2"><Textarea value={f.admin_notes} onChange={(e) => set('admin_notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ---------------- New booking (phone / walk-in) ----------------
function NewBookingModal({ open, onClose, sections, onCreated }: { open: boolean; onClose: () => void; sections: any[]; onCreated: (r: any) => void }) {
  const blank = { customer_name: '', phone: '', email: '', date: toDateInput(), guests: '2', section_id: '', time: '', table_ids: [] as number[], occasion: '', special_requests: '', admin_notes: '', source: 'phone', status: 'confirmed' };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    if (open) setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const guests = Number(f.guests) || 0;
  const { data: avail, loading } = useApi<Availability>(
    open && f.date && guests > 0 ? () => adminApi.get('/reservations/availability', { date: f.date, guests, sectionId: f.section_id || undefined }) : null,
    [open, f.date, guests, f.section_id]
  );
  const slot = avail?.slots.find((s) => s.time === f.time);

  const submit = async () => {
    if (!f.customer_name || !f.phone || !f.time) return toast.error('Name, mobile and time are required');
    setSaving(true);
    try {
      const r = await adminApi.post('/reservations', {
        customer_name: f.customer_name,
        phone: f.phone,
        email: f.email || null,
        date: f.date,
        time: f.time,
        guests,
        section_id: f.section_id ? Number(f.section_id) : null,
        table_ids: f.table_ids.length ? f.table_ids : undefined,
        occasion: f.occasion || null,
        special_requests: f.special_requests || null,
        admin_notes: f.admin_notes || null,
        source: f.source,
        status: f.status,
      });
      toast.success(`Booking ${r.booking_code} created`);
      onCreated(r);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title="New booking" description="Phone or walk-in reservation" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={submit}>Create booking</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => (set('date', e.target.value), set('time', ''), set('table_ids', []))} /></Field>
        <Field label="Guests" required><Input type="number" min={1} value={f.guests} onChange={(e) => (set('guests', e.target.value), set('table_ids', []))} /></Field>
        <Field label="Area"><Select value={f.section_id} onChange={(e) => (set('section_id', e.target.value), set('table_ids', []))} placeholder="Any" options={sections.map((s) => ({ value: s.id, label: s.name }))} /></Field>
        <Field label="Source"><Select value={f.source} onChange={(e) => set('source', e.target.value)} options={[{ value: 'phone', label: 'Phone' }, { value: 'walk_in', label: 'Walk-in' }, { value: 'admin', label: 'Other' }]} /></Field>
      </div>

      <div className="mt-4">
        <p className="label">Time slot</p>
        {loading ? (
          <Spinner className="py-4" />
        ) : avail?.closed ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{avail.reason}</p>
        ) : !avail?.slots.length ? (
          <p className="text-sm text-ink-500">No slots for this date.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {avail.slots.map((s) => (
              <button
                key={s.time}
                disabled={!s.available}
                onClick={() => (set('time', s.time), set('table_ids', []))}
                className={clsx('rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40', f.time === s.time ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 hover:border-brand-400')}
              >
                {fmtTime(s.time)} <span className="text-xs opacity-75">({s.available})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {slot && (
        <div className="mt-4">
          <p className="label">Table (optional - auto-assigned if none selected)</p>
          <div className="flex flex-wrap gap-2">
            {slot.tables.map((t) => (
              <button
                key={t.id}
                onClick={() => set('table_ids', f.table_ids.includes(t.id) ? f.table_ids.filter((x) => x !== t.id) : [...f.table_ids, t.id])}
                className={clsx('rounded-lg border px-3 py-1.5 text-sm', f.table_ids.includes(t.id) ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800' : 'border-ink-200 hover:bg-ink-50')}
              >
                {t.table_number} · {t.capacity} seats
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Guest name" required><Input value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} /></Field>
        <Field label="Mobile" required><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="10-15 digits" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Occasion"><Select value={f.occasion} onChange={(e) => set('occasion', e.target.value)} placeholder="None" options={OCCASIONS} /></Field>
        <Field label="Initial status"><Select value={f.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'confirmed', label: 'Confirmed' }, { value: 'pending', label: 'Pending' }, { value: 'seated', label: 'Seated now' }]} /></Field>
        <div />
        <Field label="Special requests" className="sm:col-span-3"><Textarea rows={2} value={f.special_requests} onChange={(e) => set('special_requests', e.target.value)} /></Field>
        <Field label="Staff notes" className="sm:col-span-3"><Textarea rows={2} value={f.admin_notes} onChange={(e) => set('admin_notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
