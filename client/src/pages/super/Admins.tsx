import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, DataTable, ErrorState, Field, Input, Modal, PageHeader, Select, StatusBadge, Switch } from '../../components/ui';

interface AdminRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  restaurant_id: number | null;
  branch_id: number | null;
  role: string;
  role_name: string;
  restaurant_name: string | null;
  branch_name: string | null;
}

const ROLES = [
  { value: 'restaurant_admin', label: 'Restaurant Admin' },
  { value: 'manager', label: 'Branch Manager' },
  { value: 'waiter', label: 'Waiter' },
  { value: 'chef', label: 'Chef' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'super_admin', label: 'Super Admin' },
];
const ROLE_TONE: Record<string, any> = { super_admin: 'purple', restaurant_admin: 'amber', manager: 'blue' };

function AdminModal({ open, onClose, row, onSaved }: { open: boolean; onClose: () => void; row: AdminRow | null; onSaved: () => void }) {
  const restaurants = useApi<{ id: number; name: string }[]>(open ? () => api.get('/super/restaurants') : null, [open]);
  const ctx = useApi<{ branches: { id: number; name: string; restaurant_id: number }[] }>(open ? () => api.get('/admin/context') : null, [open]);
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open)
      setF(
        row
          ? { name: row.name, email: row.email, phone: row.phone || '', password: '', role: row.role, restaurant_id: row.restaurant_id ? String(row.restaurant_id) : '', branch_id: row.branch_id ? String(row.branch_id) : '', is_active: row.is_active }
          : { name: '', email: '', phone: '', password: '', role: 'restaurant_admin', restaurant_id: '', branch_id: '', is_active: true }
      );
  }, [open, row]);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const isSuper = f.role === 'super_admin';
  const branches = (ctx.data?.branches || []).filter((b) => String(b.restaurant_id) === f.restaurant_id);

  const save = async () => {
    if (!f.name?.trim() || !f.email?.trim()) return toast.error('Name and email are required');
    if (!row && (f.password || '').length < 8) return toast.error('Password must be at least 8 characters');
    if (row && f.password && f.password.length < 8) return toast.error('Password must be at least 8 characters');
    if (!isSuper && !f.restaurant_id) return toast.error('Select a restaurant');
    const body: Record<string, any> = {
      name: f.name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim() || null,
      role: f.role,
      restaurant_id: isSuper ? null : Number(f.restaurant_id),
      branch_id: isSuper || !f.branch_id ? null : Number(f.branch_id),
      is_active: f.is_active,
    };
    if (f.password) body.password = f.password;
    setSaving(true);
    try {
      if (row) await api.put(`/super/admins/${row.id}`, body);
      else await api.post('/super/admins', body);
      toast.success(row ? 'Account updated' : 'Account created');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={row ? `Edit ${row.name}` : 'New staff / admin account'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>{row ? 'Save changes' : 'Create account'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required><Input value={f.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Email" required><Input type="email" value={f.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><Input value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={row ? 'New password (optional)' : 'Password'} required={!row} hint="Minimum 8 characters">
          <Input type="password" autoComplete="new-password" value={f.password || ''} onChange={(e) => set('password', e.target.value)} />
        </Field>
        <Field label="Role" required><Select value={f.role} onChange={(e) => set('role', e.target.value)} options={ROLES} /></Field>
        {!isSuper && (
          <>
            <Field label="Restaurant" required>
              <Select value={f.restaurant_id} onChange={(e) => setF((s: any) => ({ ...s, restaurant_id: e.target.value, branch_id: '' }))} placeholder="Select restaurant..." options={(restaurants.data || []).map((r) => ({ value: r.id, label: r.name }))} />
            </Field>
            <Field label="Branch" hint="Leave empty for access to all branches of the restaurant">
              <Select value={f.branch_id} disabled={!f.restaurant_id} onChange={(e) => set('branch_id', e.target.value)} placeholder="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            </Field>
          </>
        )}
        <div className="sm:col-span-2"><Switch checked={!!f.is_active} onChange={(v) => set('is_active', v)} label="Account active" /></div>
      </div>
    </Modal>
  );
}

export default function Admins() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<AdminRow[]>(() => api.get('/super/admins'), []);
  const [role, setRole] = useState('');
  const [modal, setModal] = useState<{ open: boolean; row: AdminRow | null }>({ open: false, row: null });

  return (
    <div>
      <PageHeader title="Admin Accounts" subtitle="Super admins, restaurant admins and staff logins across the platform." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, row: null })}>New account</Button>} />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <DataTable<AdminRow>
          rows={(data || []).filter((a) => !role || a.role === role)}
          loading={loading}
          onRowClick={(r) => setModal({ open: true, row: r })}
          toolbar={<Select className="w-48" value={role} onChange={(e) => setRole(e.target.value)} placeholder="All roles" options={ROLES} />}
          columns={[
            { key: 'name', header: 'Name', render: (a) => <div><p className="font-medium text-ink-900">{a.name}{a.id === user?.id && <span className="ml-1 text-xs text-ink-400">(you)</span>}</p><p className="text-xs text-ink-500">{a.email}</p></div> },
            { key: 'role', header: 'Role', render: (a) => <Badge tone={ROLE_TONE[a.role] || 'gray'}>{a.role_name}</Badge> },
            { key: 'restaurant_name', header: 'Restaurant', render: (a) => a.restaurant_name || (a.role === 'super_admin' ? 'Platform' : '-') },
            { key: 'branch_name', header: 'Branch', hideOnMobile: true, render: (a) => a.branch_name || (a.restaurant_id ? 'All branches' : '-') },
            { key: 'is_active', header: 'Status', render: (a) => <StatusBadge status={a.is_active ? 'active' : 'inactive'} /> },
            { key: 'last_login_at', header: 'Last login', hideOnMobile: true, render: (a) => <span className="text-xs">{a.last_login_at ? fmtDateTime(a.last_login_at) : 'Never'}</span> },
            { key: '_a', header: '', sortable: false, align: 'right', render: (a) => <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={(e) => (e.stopPropagation(), setModal({ open: true, row: a }))} aria-label="Edit" /> },
          ]}
        />
      )}
      <AdminModal open={modal.open} onClose={() => setModal((m) => ({ ...m, open: false }))} row={modal.row} onSaved={reload} />
    </div>
  );
}
