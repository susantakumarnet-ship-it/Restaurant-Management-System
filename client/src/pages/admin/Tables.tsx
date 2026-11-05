import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Users, Wrench, CheckCircle2, CircleDot, RefreshCw, Clock } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { useApi, usePolling } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { fmtTime, titleCase } from '../../lib/format';
import { CrudPage, type FieldDef } from '../../components/CrudPage';
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Tabs, Textarea } from '../../components/ui';

const LIVE_STYLE: Record<string, string> = {
  available: 'border-emerald-300 bg-emerald-50/60',
  reserved: 'border-amber-300 bg-amber-50/70',
  occupied: 'border-red-300 bg-red-50/70',
  maintenance: 'border-ink-300 bg-ink-100',
};
const DOT: Record<string, string> = { available: 'bg-emerald-500', reserved: 'bg-amber-500', occupied: 'bg-red-500', maintenance: 'bg-ink-400' };

export default function Tables() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm('tables.manage');
  // PATCH /tables/:id/status is allowed for tables.manage OR tables.view (floor staff mark tables occupied/free).
  const canSetStatus = hasPerm('tables.manage', 'tables.view');
  const [tab, setTab] = useState<'floor' | 'tables' | 'sections'>('floor');
  return (
    <div>
      <PageHeader title="Tables & Floor" subtitle="Live floor status, table setup and seating areas" actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'floor', label: 'Live floor' }, { value: 'tables', label: 'Tables' }, { value: 'sections', label: 'Sections' }]} />} />
      {tab === 'floor' && <LiveFloor canManage={canSetStatus} />}
      {tab === 'tables' && <TablesCrud canManage={canManage} />}
      {tab === 'sections' && <SectionsCrud canManage={canManage} />}
    </div>
  );
}

function LiveFloor({ canManage }: { canManage: boolean }) {
  const [at, setAt] = useState('');
  const { data, loading, error, reload } = useApi<any[]>(() => adminApi.get('/tables/live', at ? { at } : undefined), [at]);
  usePolling(reload, 30000, !at);
  const [acting, setActing] = useState<any | null>(null);

  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    (data || []).forEach((t) => (g[t.section_name || 'Unassigned'] ||= []).push(t));
    return Object.entries(g);
  }, [data]);
  const counts = useMemo(() => (data || []).reduce<Record<string, number>>((a, t) => ({ ...a, [t.live_status]: (a[t.live_status] || 0) + 1 }), {}), [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3 text-sm">
          {['available', 'reserved', 'occupied', 'maintenance'].map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-ink-700">
              <span className={clsx('h-2.5 w-2.5 rounded-full', DOT[s])} /> {titleCase(s)} <span className="font-semibold text-ink-900">{counts[s] || 0}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input type="datetime-local" className="w-auto" value={at} onChange={(e) => setAt(e.target.value)} aria-label="View floor at time" />
          {at && <Button size="sm" variant="ghost" onClick={() => setAt('')}>Now</Button>}
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={reload} loading={loading}>Refresh</Button>
        </div>
      </div>
      {at && <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">Showing floor as of {new Date(at).toLocaleString('en-IN')}.</p>}
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No tables yet" description="Add tables in the Tables tab." />
      ) : (
        <div className="space-y-6">
          {groups.map(([section, tables]) => (
            <div key={section}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-700">
                {section} {tables[0].location_type && <Badge>{titleCase(tables[0].location_type)}</Badge>}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {tables.map((t) => (
                  <button key={t.id} onClick={() => setActing(t)} className={clsx('flex min-h-[132px] flex-col rounded-2xl border-2 p-3 text-left transition hover:shadow-lift', LIVE_STYLE[t.live_status])}>
                    <div className="flex items-center justify-between">
                      <span className="font-display text-xl font-bold text-ink-900">{t.table_number}</span>
                      <span className={clsx('h-2.5 w-2.5 rounded-full', DOT[t.live_status])} />
                    </div>
                    <p className="flex items-center gap-1 text-xs text-ink-600">
                      <Users className="h-3.5 w-3.5" /> {t.capacity} · {titleCase(t.table_type)}
                    </p>
                    <div className="mt-auto space-y-0.5 pt-2 text-xs">
                      {t.live_status === 'maintenance' && <p className="text-ink-600">{t.maintenance_note || 'Under maintenance'}</p>}
                      {t.current_reservation_id && (
                        <p className="truncate font-medium text-ink-800">
                          {t.current_customer} · {t.current_guests}p · until {fmtTime(t.current_end)}
                        </p>
                      )}
                      {t.next_reservation_id && (
                        <p className="flex items-center gap-1 truncate text-ink-600">
                          <Clock className="h-3 w-3" /> Next {fmtTime(t.next_start)} · {t.next_customer}
                        </p>
                      )}
                      {t.open_orders > 0 && <p className="font-medium text-red-700">{t.open_orders} open order(s)</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {acting && <TableActionModal table={acting} canManage={canManage} onClose={() => setActing(null)} onDone={reload} />}
    </div>
  );
}

function TableActionModal({ table: t, canManage, onClose, onDone }: { table: any; canManage: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(t.maintenance_note || '');
  const [busy, setBusy] = useState<string | null>(null);
  const set = async (status: string) => {
    setBusy(status);
    try {
      await adminApi.patch(`/tables/${t.id}/status`, { status, maintenance_note: status === 'maintenance' ? note : null });
      toast.success(`Table ${t.table_number} marked ${status}`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Table ${t.table_number}`} description={`${t.capacity} seats · ${t.section_name || 'No section'}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          Live status: <StatusBadge status={t.live_status} /> <span className="text-ink-400">·</span> Manual: <StatusBadge status={t.status} />
        </div>
        {t.current_reservation_id && (
          <Link to={`/admin/reservations?id=${t.current_reservation_id}`} className="block rounded-xl border border-ink-200 p-3 text-sm hover:bg-ink-50">
            <p className="font-medium">Current: {t.current_booking_code} · {t.current_customer}</p>
            <p className="text-ink-500">{fmtTime(t.current_start)} - {fmtTime(t.current_end)} · <StatusBadge status={t.current_reservation_status} /></p>
          </Link>
        )}
        {t.next_reservation_id && (
          <Link to={`/admin/reservations?id=${t.next_reservation_id}`} className="block rounded-xl border border-ink-200 p-3 text-sm hover:bg-ink-50">
            <p className="font-medium">Next: {t.next_booking_code} · {t.next_customer}</p>
            <p className="text-ink-500">Starts {fmtTime(t.next_start)}</p>
          </Link>
        )}
        {t.open_orders > 0 && (
          <Link to="/admin/orders" className="block text-sm text-brand-700 hover:underline">
            {t.open_orders} open order(s) on this table →
          </Link>
        )}
        {canManage ? (
          <>
            <Field label="Maintenance note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wobbly leg, awaiting repair" /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={busy === 'available'} onClick={() => set('available')}>Available</Button>
              <Button size="sm" variant="danger" icon={<CircleDot className="h-4 w-4" />} loading={busy === 'occupied'} onClick={() => set('occupied')}>Occupied</Button>
              <Button size="sm" variant="secondary" icon={<Wrench className="h-4 w-4" />} loading={busy === 'maintenance'} onClick={() => set('maintenance')}>Maintenance</Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-500">You can view the floor but not change table status.</p>
        )}
      </div>
    </Modal>
  );
}

const TABLE_TYPES = [
  { value: '2_seater', label: '2-seater' },
  { value: '4_seater', label: '4-seater' },
  { value: '6_seater', label: '6-seater' },
  { value: 'family', label: 'Family table' },
  { value: 'vip', label: 'VIP' },
];

function TablesCrud({ canManage }: { canManage: boolean }) {
  const { data: sections } = useApi<any[]>(() => adminApi.get('/sections'), []);
  const fields: FieldDef[] = [
    { name: 'table_number', label: 'Table number', required: true, placeholder: 'e.g. T7' },
    { name: 'name', label: 'Display name', placeholder: 'e.g. Window booth' },
    { name: 'section_id', label: 'Section', type: 'select', numeric: true, options: (sections || []).map((s) => ({ value: s.id, label: s.name })) },
    { name: 'table_type', label: 'Table type', type: 'select', required: true, options: TABLE_TYPES, default: '4_seater' },
    { name: 'capacity', label: 'Seating capacity', type: 'number', required: true, min: 1, max: 50 },
    { name: 'min_capacity', label: 'Minimum guests', type: 'number', min: 1, max: 50, hint: 'Avoid seating 1 guest at a large table' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'available', label: 'Available' }, { value: 'occupied', label: 'Occupied' }, { value: 'maintenance', label: 'Maintenance' }], default: 'available' },
    { name: 'maintenance_note', label: 'Maintenance note', hidden: (v) => v.status !== 'maintenance' },
    { name: 'is_active', label: 'Active', type: 'switch', placeholder: 'Bookable' },
  ];
  if (!sections) return <Spinner />;
  return (
    <CrudPage
      hideHeader
      title="Tables"
      endpoint="/tables"
      entityName="Table"
      fields={fields}
      canCreate={canManage}
      canEdit={canManage}
      canDelete={canManage}
      transform={(p) => ({ ...p, min_capacity: p.min_capacity || 1, status: p.status || 'available' })}
      columns={[
        { key: 'table_number', header: 'Table', render: (r) => <span className="font-semibold text-ink-900">{r.table_number}</span> },
        { key: 'name', header: 'Name', hideOnMobile: true },
        { key: 'section_name', header: 'Section', render: (r) => r.section_name || '-' },
        { key: 'capacity', header: 'Seats', align: 'center' },
        { key: 'table_type', header: 'Type', render: (r) => titleCase(r.table_type) },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'is_active', header: 'Active', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
      ]}
    />
  );
}

function SectionsCrud({ canManage }: { canManage: boolean }) {
  return (
    <CrudPage
      hideHeader
      title="Sections"
      endpoint="/sections"
      entityName="Section"
      canCreate={canManage}
      canEdit={canManage}
      canDelete={canManage}
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Rooftop Lounge' },
        { name: 'location_type', label: 'Location', type: 'select', required: true, options: [{ value: 'indoor', label: 'Indoor' }, { value: 'outdoor', label: 'Outdoor' }, { value: 'rooftop', label: 'Rooftop' }, { value: 'private', label: 'Private dining' }], default: 'indoor' },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'is_active', label: 'Active', type: 'switch', placeholder: 'Shown to guests' },
      ]}
      columns={[
        { key: 'name', header: 'Section', render: (r) => <span className="font-semibold text-ink-900">{r.name}</span> },
        { key: 'location_type', header: 'Location', render: (r) => titleCase(r.location_type) },
        { key: 'table_count', header: 'Tables', align: 'center' },
        { key: 'description', header: 'Description', hideOnMobile: true },
        { key: 'is_active', header: 'Active', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
      ]}
    />
  );
}
