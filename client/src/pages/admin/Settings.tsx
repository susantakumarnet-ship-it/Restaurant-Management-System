import { useEffect, useState, type ReactNode } from 'react';
import { Clock, MapPin, Pencil, Phone, Plus, Save, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { fmtTime } from '../../lib/format';
import { EntityFormModal, FormFields, formToPayload, rowToForm, type FieldDef } from '../../components/CrudPage';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Img, Input, PageHeader, Spinner, StatusBadge, Switch, Tabs, Textarea, useConfirm } from '../../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------- Restaurant profile ----------------
const profileFields: FieldDef[] = [
  { name: 'name', label: 'Restaurant name', required: true },
  { name: 'cuisine', label: 'Cuisine', placeholder: 'Modern Indian, Continental' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Contact number', type: 'tel' },
  { name: 'website', label: 'Website' },
  { name: 'gstin', label: 'GSTIN', hint: 'Printed on tax invoices' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'logo_url', label: 'Logo', type: 'image' },
  { name: 'cover_url', label: 'Cover image', type: 'image' },
];

function Profile() {
  const { reloadContext } = useAdmin();
  const { data, loading, error, reload } = useApi<any>(() => adminApi.get('/restaurant'), []);
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setValues(rowToForm(profileFields, data));
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const save = async () => {
    if (!String(values.name || '').trim()) return toast.error('Restaurant name is required');
    setSaving(true);
    try {
      await adminApi.put('/restaurant', formToPayload(profileFields, values, true));
      toast.success('Restaurant profile saved');
      reload();
      reloadContext();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Restaurant profile" actions={<Button loading={saving} icon={<Save className="h-4 w-4" />} onClick={save}>Save</Button>}>
      <FormFields fields={profileFields} values={values} set={(n, v) => setValues((s) => ({ ...s, [n]: v }))} isEdit />
    </Card>
  );
}

// ---------------- Branches ----------------
const branchFields: FieldDef[] = [
  { name: 'name', label: 'Branch name', required: true },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'city', label: 'City' },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'state', label: 'State' },
  { name: 'postal_code', label: 'Postal code' },
  { name: 'opening_time', label: 'Opening time', type: 'time', required: true },
  { name: 'closing_time', label: 'Closing time', type: 'time', required: true },
  { name: 'weekly_holidays', label: 'Weekly holidays (closed days)', type: 'weekdays' },
  { name: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
  { name: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
  { name: 'map_url', label: 'Google Maps link', full: true, placeholder: 'https://maps.google.com/...' },
  { name: 'images', label: 'Restaurant images', type: 'images' },
  { name: 'is_active', label: 'Status', type: 'switch', placeholder: 'Accepting bookings & orders' },
];

const NEW_BRANCH = { opening_time: '11:00', closing_time: '23:00', is_active: true };

function Branches() {
  const { reloadContext, branchId } = useAdmin();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<any[]>(() => adminApi.get('/branches'), []);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const pinned = !!user?.branch_id;

  const save = async (payload: Record<string, any>) => {
    if (payload.closing_time <= payload.opening_time) throw new Error('Closing time must be after opening time');
    if (editing?.id) await adminApi.put(`/branches/${editing.id}`, payload);
    else await adminApi.post('/branches', payload);
    toast.success(editing?.id ? 'Branch updated' : 'Branch created');
    reload();
    reloadContext();
  };
  const del = async (b: any) => {
    if (b.id === branchId) return toast.error('Switch to another branch before removing the one you are working in');
    const { ok } = await confirm({ title: `Remove ${b.name}?`, message: 'Branches with booking or order history are deactivated instead of deleted.', danger: true, confirmText: 'Remove' });
    if (!ok) return;
    try {
      const r = await adminApi.delete(`/branches/${b.id}`);
      toast.success(r.message || 'Branch deleted');
      reload();
      reloadContext();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  return (
    <div>
      {!pinned && (
        <div className="mb-3 flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => (setEditing(null), setOpen(true))}>Add branch</Button>
        </div>
      )}
      {!data?.length ? (
        <Card><EmptyState title="No branches" /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((b) => (
            <div key={b.id} className={clsx('card overflow-hidden', b.id === branchId && 'ring-2 ring-brand-500')}>
              <div className="flex gap-4 p-4">
                <Img src={b.images?.[0]} alt={b.name} className="h-20 w-24 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-900">{b.name}</p>
                    <StatusBadge status={b.is_active ? 'active' : 'inactive'} />
                    {b.id === branchId && <Badge tone="amber">Current</Badge>}
                  </div>
                  {b.address && <p className="mt-1 flex gap-1.5 text-xs text-ink-600"><MapPin className="h-3.5 w-3.5 shrink-0" />{b.address}{b.city ? `, ${b.city}` : ''}</p>}
                  <p className="mt-1 flex gap-1.5 text-xs text-ink-600"><Clock className="h-3.5 w-3.5 shrink-0" />{fmtTime(b.opening_time)} - {fmtTime(b.closing_time)}{b.weekly_holidays?.length ? ` • closed ${b.weekly_holidays.map((d: number) => DAYS[d]).join(', ')}` : ''}</p>
                  {b.phone && <p className="mt-1 flex gap-1.5 text-xs text-ink-600"><Phone className="h-3.5 w-3.5 shrink-0" />{b.phone}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  {(!pinned || b.id === user?.branch_id) && <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => (setEditing(b), setOpen(true))} aria-label="Edit branch" />}
                  {!pinned && <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del(b)} aria-label="Remove branch" />}
                </div>
              </div>
              {b.latitude != null && b.longitude != null && (
                <iframe title={`Map of ${b.name}`} className="h-40 w-full border-0 border-t border-ink-100" loading="lazy" src={`https://maps.google.com/maps?q=${b.latitude},${b.longitude}&z=15&output=embed`} />
              )}
            </div>
          ))}
        </div>
      )}
      <EntityFormModal open={open} onClose={() => setOpen(false)} title={editing?.id ? `Edit ${editing.name}` : 'New branch'} fields={branchFields} initial={editing || NEW_BRANCH} onSubmit={save} size="xl" />
    </div>
  );
}

// ---------------- Booking & billing settings ----------------
const NUM_KEYS = ['reservation_duration_min', 'buffer_min', 'slot_interval_min', 'min_guests', 'max_guests', 'max_advance_days', 'min_notice_minutes', 'cancellation_deadline_hours', 'advance_payment_amount', 'gst_rate', 'service_charge_rate', 'delivery_charge', 'min_delivery_order', 'loyalty_points_per_100'];
const BOOL_KEYS = ['auto_confirm', 'advance_payment_required', 'accepts_delivery', 'accepts_takeaway'];

function NumField({ label, k, f, set, hint, step, suffix }: { label: string; k: string; f: any; set: (k: string, v: any) => void; hint?: ReactNode; step?: string; suffix?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <Input type="number" min={0} step={step || '1'} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={suffix ? 'pr-14' : ''} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-400">{suffix}</span>}
      </div>
    </Field>
  );
}

function BookingSettings() {
  const { branch } = useAdmin();
  const { data, loading, error, reload } = useApi<any>(() => adminApi.get('/settings'), []);
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setF({ ...data });
  }, [data]);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;

  const save = async () => {
    const body: Record<string, any> = {};
    for (const k of NUM_KEYS) {
      if (f[k] === '' || f[k] == null || isNaN(Number(f[k]))) return toast.error(`${k.replace(/_/g, ' ')} must be a number`);
      body[k] = Number(f[k]);
    }
    for (const k of BOOL_KEYS) body[k] = !!f[k];
    body.booking_policy = f.booking_policy?.trim() || null;
    if (body.max_guests < body.min_guests) return toast.error('Maximum guests must be at least the minimum');
    setSaving(true);
    try {
      await adminApi.put('/settings', body);
      toast.success('Settings saved');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const dur = Number(f.reservation_duration_min);
  return (
    <div className="space-y-4">
      <Card title={`Reservations • ${branch.name}`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Reservation duration" hint="How long a table is held per booking" className="sm:col-span-2 lg:col-span-1">
            <div className="flex flex-wrap gap-2">
              {[60, 90, 120].map((m) => (
                <button key={m} type="button" onClick={() => set('reservation_duration_min', m)} className={clsx('rounded-lg border px-3 py-2 text-sm font-medium', dur === m ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 hover:bg-ink-50')}>
                  {m} min
                </button>
              ))}
              <Input type="number" min={15} max={480} className="w-24" value={f.reservation_duration_min ?? ''} onChange={(e) => set('reservation_duration_min', e.target.value)} aria-label="Custom duration" />
            </div>
          </Field>
          <NumField label="Buffer between bookings" k="buffer_min" f={f} set={set} suffix="min" hint="Cleaning / reset time" />
          <NumField label="Slot interval" k="slot_interval_min" f={f} set={set} suffix="min" hint="Gap between offered start times" />
          <NumField label="Minimum guests" k="min_guests" f={f} set={set} />
          <NumField label="Maximum guests" k="max_guests" f={f} set={set} />
          <NumField label="Advance booking window" k="max_advance_days" f={f} set={set} suffix="days" />
          <NumField label="Minimum notice" k="min_notice_minutes" f={f} set={set} suffix="min" />
          <NumField label="Cancellation deadline" k="cancellation_deadline_hours" f={f} set={set} suffix="hours" hint="Customers can modify/cancel until this many hours before" />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Switch checked={!!f.auto_confirm} onChange={(v) => set('auto_confirm', v)} label="Auto-confirm bookings" description="Otherwise bookings stay pending until staff approve them." />
          <Switch checked={!!f.advance_payment_required} onChange={(v) => set('advance_payment_required', v)} label="Require advance payment" description="Customers pay online when booking." />
          {f.advance_payment_required && <NumField label="Advance amount per booking" k="advance_payment_amount" f={f} set={set} step="0.01" suffix="₹" />}
        </div>
        <Field label="Booking policy" className="mt-4" hint="Shown to customers on the booking page">
          <Textarea rows={4} value={f.booking_policy || ''} onChange={(e) => set('booking_policy', e.target.value)} />
        </Field>
      </Card>
      <Card title="Billing & ordering">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumField label="GST rate" k="gst_rate" f={f} set={set} step="0.01" suffix="%" hint="Split equally into CGST + SGST" />
          <NumField label="Service charge (dine-in)" k="service_charge_rate" f={f} set={set} step="0.01" suffix="%" />
          <NumField label="Delivery charge" k="delivery_charge" f={f} set={set} step="0.01" suffix="₹" />
          <NumField label="Minimum delivery order" k="min_delivery_order" f={f} set={set} step="0.01" suffix="₹" />
          <NumField label="Loyalty points per ₹100" k="loyalty_points_per_100" f={f} set={set} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Switch checked={!!f.accepts_delivery} onChange={(v) => set('accepts_delivery', v)} label="Accept delivery orders" />
          <Switch checked={!!f.accepts_takeaway} onChange={(v) => set('accepts_takeaway', v)} label="Accept takeaway orders" />
        </div>
      </Card>
      <div className="flex justify-end">
        <Button size="lg" loading={saving} icon={<Save className="h-4 w-4" />} onClick={save}>Save settings</Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<'profile' | 'branches' | 'booking'>('profile');
  return (
    <div>
      <PageHeader title="Restaurant Settings" subtitle="Profile, branches, opening hours, booking rules and billing." />
      <Tabs className="mb-4 w-fit" value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Restaurant profile' }, { value: 'branches', label: 'Branches & hours' }, { value: 'booking', label: 'Booking & billing' }]} />
      {tab === 'profile' && <Profile />}
      {tab === 'branches' && <Branches />}
      {tab === 'booking' && <BookingSettings />}
    </div>
  );
}
