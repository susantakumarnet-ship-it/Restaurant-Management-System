import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, adminBranchStore } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { fmtDate, titleCase } from '../../lib/format';
import { EntityFormModal, type FieldDef } from '../../components/CrudPage';
import { Badge, Button, DataTable, ErrorState, Img, PageHeader, StatusBadge, useConfirm } from '../../components/ui';

interface RestaurantRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cuisine: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  gstin: string | null;
  logo_url: string | null;
  subscription_plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  is_active: boolean;
  branch_count: number;
  admin_count: number;
}

const baseFields: FieldDef[] = [
  { name: 'name', label: 'Restaurant name', required: true },
  { name: 'cuisine', label: 'Cuisine' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'website', label: 'Website' },
  { name: 'gstin', label: 'GSTIN' },
  { name: 'branch_name', label: 'First branch name', required: true, createOnly: true, placeholder: 'Main Branch' },
  { name: 'city', label: 'City', createOnly: true },
  { name: 'subscription_plan', label: 'Plan', type: 'select', required: true, options: ['basic', 'pro', 'enterprise'].map((p) => ({ value: p, label: titleCase(p) })), default: 'basic' },
  { name: 'subscription_status', label: 'Subscription status', type: 'select', required: true, options: ['trial', 'active', 'past_due', 'cancelled'].map((p) => ({ value: p, label: titleCase(p) })), default: 'active' },
  { name: 'subscription_expires_at', label: 'Subscription expires', type: 'date' },
  { name: 'is_active', label: 'Status', type: 'switch', placeholder: 'Restaurant active' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'logo_url', label: 'Logo', type: 'image' },
];

const NEW = { subscription_plan: 'basic', subscription_status: 'trial', is_active: true, branch_name: 'Main Branch' };

export default function Restaurants() {
  const { data, loading, error, reload } = useApi<RestaurantRow[]>(() => api.get('/super/restaurants'), []);
  const [editing, setEditing] = useState<RestaurantRow | null>(null);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState<number | null>(null);
  const confirm = useConfirm();
  const nav = useNavigate();

  const save = async (p: Record<string, any>) => {
    if (editing) await api.put(`/super/restaurants/${editing.id}`, p);
    else await api.post('/super/restaurants', p);
    toast.success(editing ? 'Restaurant updated' : 'Restaurant created with its first branch');
    reload();
  };

  const del = async (r: RestaurantRow) => {
    const { ok } = await confirm({ title: `Remove ${r.name}?`, message: 'Restaurants with booking or order history are deactivated instead of deleted. All branches, menus and staff of a deleted restaurant are removed permanently.', danger: true, confirmText: 'Remove' });
    if (!ok) return;
    try {
      const res = await api.delete(`/super/restaurants/${r.id}`);
      toast.success(res.message || 'Restaurant deleted');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const manage = async (r: RestaurantRow) => {
    setManaging(r.id);
    try {
      const ctx = await api.get('/admin/context');
      const branch = ctx.branches.find((b: any) => b.restaurant_id === r.id);
      if (!branch) throw new Error('This restaurant has no branches yet');
      adminBranchStore.set(branch.id);
      nav('/admin');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setManaging(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Restaurants"
        subtitle="Onboard restaurants and manage their subscriptions."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => (setEditing(null), setOpen(true))}>Add restaurant</Button>}
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <DataTable<RestaurantRow>
          rows={data}
          loading={loading}
          columns={[
            {
              key: 'name',
              header: 'Restaurant',
              render: (r) => (
                <div className="flex items-center gap-3">
                  <Img src={r.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
                  <div>
                    <p className="font-medium text-ink-900">{r.name}</p>
                    <p className="text-xs text-ink-500">{r.cuisine || r.slug}</p>
                  </div>
                </div>
              ),
            },
            { key: 'subscription_plan', header: 'Plan', render: (r) => <Badge tone={r.subscription_plan === 'enterprise' ? 'purple' : r.subscription_plan === 'pro' ? 'amber' : 'gray'}>{titleCase(r.subscription_plan)}</Badge> },
            { key: 'subscription_status', header: 'Subscription', render: (r) => <div><StatusBadge status={r.subscription_status} />{r.subscription_expires_at && <p className="mt-0.5 text-[11px] text-ink-500">until {fmtDate(r.subscription_expires_at)}</p>}</div> },
            { key: 'branch_count', header: 'Branches', align: 'right', hideOnMobile: true },
            { key: 'admin_count', header: 'Admins', align: 'right', hideOnMobile: true },
            { key: 'is_active', header: 'Status', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
            {
              key: '_a',
              header: '',
              sortable: false,
              align: 'right',
              render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="secondary" loading={managing === r.id} icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => manage(r)}>Manage</Button>
                  <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => (setEditing(r), setOpen(true))} aria-label="Edit" />
                  <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del(r)} aria-label="Delete" />
                </div>
              ),
            },
          ]}
        />
      )}
      <EntityFormModal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.name}` : 'New restaurant'} fields={baseFields} initial={editing || NEW} onSubmit={save} size="xl" />
    </div>
  );
}
