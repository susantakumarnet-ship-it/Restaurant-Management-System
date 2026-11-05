import { useEffect, useState } from 'react';
import { Award, KeyRound, Save, Wallet, Star, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, money, titleCase } from '../../lib/format';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, Field, ImageUpload, Input, Spinner, StatCard, StatusBadge, Stars, Tabs, Textarea, EmptyState } from '../../components/ui';
import { AccountNav } from './AccountNav';

export default function Profile() {
  const { refresh } = useAuth();
  const me = useApi<any>(() => api.get('/auth/me'), []);
  const reviews = useApi<any[]>(() => api.get('/customer/reviews'), []);
  const payments = useApi<any[]>(() => api.get('/customer/payments'), []);
  const [tab, setTab] = useState<'profile' | 'security' | 'reviews' | 'payments'>('profile');
  const [form, setForm] = useState({ name: '', phone: '', address: '', date_of_birth: '', anniversary: '', avatar: [] as string[] });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    const { user, customer } = me.data;
    setForm({ name: user.name, phone: user.phone || '', address: customer?.address || '', date_of_birth: customer?.date_of_birth || '', anniversary: customer?.anniversary || '', avatar: user.avatar_url ? [user.avatar_url] : [] });
  }, [me.data]);

  if (me.loading && !me.data) return <Spinner className="h-[60vh]" />;
  const c = me.data?.customer;

  const save = async () => {
    if (form.name.trim().length < 2) return toast.error('Name is required');
    if (form.phone && !/^\+?[0-9]{10,15}$/.test(form.phone.trim())) return toast.error('Enter a valid mobile number');
    setSaving(true);
    try {
      await api.put('/auth/me', { name: form.name.trim(), phone: form.phone.trim() || undefined, address: form.address.trim() || null, date_of_birth: form.date_of_birth || null, anniversary: form.anniversary || null, avatar_url: form.avatar[0] || null });
      await refresh();
      me.reload();
      toast.success('Profile updated');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return toast.error('New passwords do not match');
    setSaving(true);
    try {
      await api.put('/auth/me/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <AccountNav />
      <h1 className="mb-6 font-display text-3xl font-bold">My profile</h1>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Loyalty points" value={c?.loyalty_points ?? 0} icon={<Award className="h-5 w-5" />} hint="Earned on every completed order" />
        <StatCard label="Total spent" value={money(c?.total_spent ?? 0)} icon={<Wallet className="h-5 w-5" />} tone="green" />
        <StatCard label="Reviews written" value={reviews.data?.length ?? 0} icon={<Star className="h-5 w-5" />} tone="purple" />
      </div>
      <Tabs
        className="mb-5 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Personal info' },
          { value: 'security', label: 'Password' },
          { value: 'reviews', label: 'My reviews' },
          { value: 'payments', label: 'Payments' },
        ]}
      />
      {tab === 'profile' && (
        <Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Photo" className="sm:col-span-2">
              <ImageUpload value={form.avatar} onChange={(v) => setForm({ ...form, avatar: v })} max={1} label="Photo" />
            </Field>
            <Field label="Full name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email" hint="Contact support to change your email">
              <Input value={me.data?.user.email || ''} disabled />
            </Field>
            <Field label="Mobile">
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Birthday" hint="We'll send you a treat!">
              <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
            </Field>
            <Field label="Anniversary">
              <Input type="date" value={form.anniversary} onChange={(e) => setForm({ ...form, anniversary: e.target.value })} />
            </Field>
            <Field label="Default delivery address" className="sm:col-span-2">
              <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end">
            <Button loading={saving} icon={<Save className="h-4 w-4" />} onClick={save}>
              Save changes
            </Button>
          </div>
        </Card>
      )}
      {tab === 'security' && (
        <Card>
          <form onSubmit={changePw} className="max-w-md space-y-4">
            <Field label="Current password">
              <Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" required />
            </Field>
            <Field label="New password" hint="At least 8 characters with a letter and a number">
              <Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" required />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required />
            </Field>
            <Button type="submit" loading={saving} icon={<KeyRound className="h-4 w-4" />}>
              Change password
            </Button>
          </form>
        </Card>
      )}
      {tab === 'reviews' &&
        (reviews.data?.length ? (
          <div className="space-y-3">
            {reviews.data.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.rating} />
                  <span className="text-sm font-medium">{r.food_name || r.branch_name}</span>
                  {!r.is_published && <StatusBadge status="inactive" label="Hidden by restaurant" />}
                  <span className="ml-auto text-xs text-ink-500">{fmtDate(r.created_at)}</span>
                </div>
                {r.comment && <p className="mt-2 text-sm text-ink-700">{r.comment}</p>}
                {r.admin_reply && <p className="mt-2 rounded-lg bg-ink-50 p-2 text-xs text-ink-600"><b>Restaurant reply:</b> {r.admin_reply}</p>}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Star className="h-6 w-6" />} title="No reviews yet" description="Rate dishes from your completed orders." />
        ))}
      {tab === 'payments' &&
        (payments.data?.length ? (
          <Card padded={false}>
            <ul className="divide-y divide-ink-100">
              {payments.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Receipt className="h-4 w-4 text-ink-400" />
                  <span className="font-mono text-xs">{p.payment_code}</span>
                  <span className="text-ink-600">{p.reference}</span>
                  <span className="text-ink-500">{titleCase(p.purpose)} • {titleCase(p.method)}</span>
                  <span className="ml-auto font-semibold">{money(p.amount)}</span>
                  <StatusBadge status={p.status} />
                  <span className="w-full text-xs text-ink-400 sm:w-auto">{fmtDateTime(p.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments yet" />
        ))}
    </div>
  );
}
