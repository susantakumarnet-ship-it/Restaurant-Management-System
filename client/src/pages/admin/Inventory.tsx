import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BarChart3, CalendarClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { fmtDate, fmtDateTime, money, titleCase } from '../../lib/format';
import { CrudPage, type FieldDef } from '../../components/CrudPage';
import { Badge, Button, DataTable, ErrorState, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea } from '../../components/ui';

interface InvItem {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  quantity: number;
  min_quantity: number;
  cost_per_unit: number;
  supplier_id: number | null;
  supplier_name: string | null;
  expiry_date: string | null;
  is_active: boolean;
  stock_status: 'low' | 'expiring' | 'ok';
  days_left?: number;
}
interface Supplier { id: number; name: string; contact_person: string | null; phone: string | null; email: string | null; gstin: string | null; is_active: boolean; item_count: number; total_purchases: number }
interface Tx { id: number; created_at: string; item_name: string; unit: string; type: string; quantity: number; unit_cost: number | null; total_cost: number | null; supplier_name: string | null; reference: string | null; notes: string | null; balance_after: number; created_by_name: string | null }

type MoveType = 'stock_in' | 'stock_out' | 'adjustment' | 'wastage';
const TYPE_OPTS = [
  { value: 'stock_in', label: 'Stock in (purchase)' },
  { value: 'stock_out', label: 'Stock out (usage)' },
  { value: 'wastage', label: 'Wastage' },
  { value: 'adjustment', label: 'Adjustment (set physical count)' },
];
const TYPE_TONE: Record<string, any> = { stock_in: 'green', stock_out: 'blue', wastage: 'red', adjustment: 'purple' };

function MovementModal({ open, onClose, items, suppliers, initial, onSaved }: { open: boolean; onClose: () => void; items: InvItem[]; suppliers: Supplier[]; initial?: { itemId?: number; type?: MoveType }; onSaved: () => void }) {
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF({ inventory_item_id: initial?.itemId ? String(initial.itemId) : '', type: initial?.type || 'stock_in', quantity: '', unit_cost: '', supplier_id: '', reference: '', notes: '', expiry_date: '' });
  }, [open, initial]);
  const item = items.find((i) => String(i.id) === f.inventory_item_id);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.inventory_item_id) return toast.error('Select an item');
    if (!(Number(f.quantity) > 0)) return toast.error('Enter a quantity greater than 0');
    setSaving(true);
    try {
      const tx = await adminApi.post('/inventory/transactions', {
        inventory_item_id: Number(f.inventory_item_id),
        type: f.type,
        quantity: Number(f.quantity),
        unit_cost: f.unit_cost === '' ? null : Number(f.unit_cost),
        // supplier / expiry only apply to purchases (the field is hidden for other types but may hold a stale value)
        supplier_id: f.type === 'stock_in' && f.supplier_id ? Number(f.supplier_id) : null,
        reference: f.reference || null,
        notes: f.notes || null,
        expiry_date: f.type === 'stock_in' && f.expiry_date ? f.expiry_date : null,
      });
      toast.success(`Recorded. New balance: ${tx.balance_after} ${item?.unit || ''}`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record stock movement" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save movement</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item" required className="sm:col-span-2">
          <Select value={f.inventory_item_id || ''} onChange={(e) => set('inventory_item_id', e.target.value)} placeholder="Select item..." options={items.map((i) => ({ value: i.id, label: `${i.name} (${i.quantity} ${i.unit})` }))} />
        </Field>
        <Field label="Movement type" required>
          <Select value={f.type} onChange={(e) => set('type', e.target.value)} options={TYPE_OPTS} />
        </Field>
        <Field label={f.type === 'adjustment' ? `New stock count${item ? ` (${item.unit})` : ''}` : `Quantity${item ? ` (${item.unit})` : ''}`} required hint={item ? `Current stock: ${item.quantity} ${item.unit}` : undefined}>
          <Input type="number" min={0} step="0.001" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        <Field label="Unit cost (₹)" hint={item ? `Default ${money(item.cost_per_unit)}` : undefined}>
          <Input type="number" min={0} step="0.01" value={f.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />
        </Field>
        {f.type === 'stock_in' && (
          <>
            <Field label="Supplier">
              <Select value={f.supplier_id} onChange={(e) => set('supplier_id', e.target.value)} placeholder="- None -" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={f.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Reference" hint="PO / bill number">
          <Input value={f.reference} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Alerts({ version }: { version: string }) {
  const { data } = useApi<{ low: InvItem[]; expiring: InvItem[] }>(() => adminApi.get('/inventory/alerts'), [version]);
  if (!data || (!data.low.length && !data.expiring.length)) return null;
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2">
      {data.low.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 font-semibold text-red-800"><AlertTriangle className="h-4 w-4" /> {data.low.length} item(s) low on stock</p>
          <ul className="mt-2 space-y-1 text-sm text-red-900">
            {data.low.slice(0, 6).map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span className="truncate">{i.name}</span>
                <span className="shrink-0 font-medium">{Number(i.quantity)} / min {Number(i.min_quantity)} {i.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.expiring.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-semibold text-amber-800"><CalendarClock className="h-4 w-4" /> {data.expiring.length} item(s) expiring within 7 days</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {data.expiring.slice(0, 6).map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span className="truncate">{i.name}</span>
                <span className="shrink-0 font-medium">{fmtDate(i.expiry_date)} • {Number(i.days_left) < 0 ? 'expired' : Number(i.days_left) === 0 ? 'today' : `${i.days_left}d left`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Movements({ items, suppliers, version, onRecord }: { items: InvItem[]; suppliers: Supplier[]; version: number; onRecord: () => void }) {
  const [filters, setFilters] = useState({ type: '', itemId: '', from: '', to: '' });
  const { data, loading, error, reload } = useApi<Tx[]>(() => adminApi.get('/inventory/transactions', filters), [JSON.stringify(filters), version]);
  const set = (k: string, v: string) => setFilters((s) => ({ ...s, [k]: v }));
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <DataTable<Tx>
      rows={data}
      loading={loading}
      toolbar={
        <>
          <Select className="w-40" value={filters.type} onChange={(e) => set('type', e.target.value)} placeholder="All types" options={TYPE_OPTS.map((t) => ({ value: t.value, label: titleCase(t.value) }))} />
          <Select className="w-44" value={filters.itemId} onChange={(e) => set('itemId', e.target.value)} placeholder="All items" options={items.map((i) => ({ value: i.id, label: i.name }))} />
          <Input type="date" className="w-36" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From" />
          <Input type="date" className="w-36" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To" />
          <Button icon={<Plus className="h-4 w-4" />} onClick={onRecord}>Record movement</Button>
        </>
      }
      columns={[
        { key: 'created_at', header: 'Date', render: (t) => <span className="whitespace-nowrap text-xs">{fmtDateTime(t.created_at)}</span> },
        { key: 'item_name', header: 'Item', render: (t) => <span className="font-medium text-ink-900">{t.item_name}</span> },
        { key: 'type', header: 'Type', render: (t) => <Badge tone={TYPE_TONE[t.type]}>{titleCase(t.type)}</Badge> },
        { key: 'quantity', header: 'Qty', align: 'right', render: (t) => `${t.type === 'stock_in' ? '+' : t.type === 'adjustment' ? '±' : '-'}${Number(t.quantity)} ${t.unit}` },
        { key: 'total_cost', header: 'Cost', align: 'right', hideOnMobile: true, render: (t) => (t.total_cost != null ? money(t.total_cost) : '-') },
        { key: 'balance_after', header: 'Balance', align: 'right', render: (t) => <span className="font-semibold">{Number(t.balance_after)} {t.unit}</span> },
        { key: 'supplier_name', header: 'Supplier / Ref', hideOnMobile: true, render: (t) => <span className="text-xs">{[t.supplier_name, t.reference].filter(Boolean).join(' • ') || '-'}</span> },
        { key: 'created_by_name', header: 'By', hideOnMobile: true, render: (t) => t.created_by_name || '-' },
      ]}
    />
  );
}

export default function Inventory() {
  const [tab, setTab] = useState<'items' | 'movements' | 'suppliers'>('items');
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const items = useApi<InvItem[]>(() => adminApi.get('/inventory'), [version]);
  const suppliers = useApi<Supplier[]>(() => adminApi.get('/suppliers'), [version]);
  const [move, setMove] = useState<{ open: boolean; itemId?: number; type?: MoveType }>({ open: false });
  // Item/supplier edits made inside CrudPage: refresh header stock value, alerts and supplier options without remounting the table.
  const [sideVersion, setSideVersion] = useState(0);
  const refreshSide = () => {
    items.reload();
    suppliers.reload();
    setSideVersion((v) => v + 1);
  };

  const itemFields: FieldDef[] = [
    { name: 'name', label: 'Item name', required: true },
    { name: 'sku', label: 'SKU' },
    { name: 'category', label: 'Category', placeholder: 'Dairy, Vegetables...' },
    { name: 'unit', label: 'Unit', type: 'select', required: true, options: ['kg', 'g', 'ltr', 'ml', 'pcs', 'pack', 'box', 'dozen'].map((u) => ({ value: u, label: u })), default: 'kg' },
    { name: 'quantity', label: 'Opening stock', type: 'number', step: '0.001', min: 0, createOnly: true, hint: 'Later changes go through stock movements' },
    { name: 'min_quantity', label: 'Minimum stock level', type: 'number', step: '0.001', min: 0, hint: 'Low-stock alert threshold' },
    { name: 'cost_per_unit', label: 'Cost per unit (₹)', type: 'number', step: '0.01', min: 0 },
    { name: 'supplier_id', label: 'Supplier', type: 'select', numeric: true, options: (suppliers.data || []).map((s) => ({ value: s.id, label: s.name })) },
    { name: 'expiry_date', label: 'Expiry date', type: 'date' },
    { name: 'is_active', label: 'Status', type: 'switch', placeholder: 'Active' },
  ];
  const supplierFields: FieldDef[] = [
    { name: 'name', label: 'Supplier name', required: true },
    { name: 'contact_person', label: 'Contact person' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'gstin', label: 'GSTIN' },
    { name: 'is_active', label: 'Status', type: 'switch', placeholder: 'Active' },
    { name: 'address', label: 'Address', type: 'textarea' },
  ];

  const stockValue = (items.data || []).reduce((s, i) => s + Number(i.quantity) * Number(i.cost_per_unit), 0);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle={`Ingredients & raw materials • stock value ${money(stockValue)}`}
        actions={
          <>
            <Link to="/admin/reports"><Button variant="secondary" icon={<BarChart3 className="h-4 w-4" />}>Usage report</Button></Link>
            <Button variant="secondary" icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setMove({ open: true, type: 'stock_in' })}>Stock in</Button>
            <Button variant="secondary" icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => setMove({ open: true, type: 'stock_out' })}>Stock out</Button>
          </>
        }
      />
      <Alerts version={`${version}-${sideVersion}`} />
      <Tabs className="mb-4 w-fit" value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Items', count: items.data?.length }, { value: 'movements', label: 'Stock movements' }, { value: 'suppliers', label: 'Suppliers', count: suppliers.data?.length }]} />

      {tab === 'items' && (
        <CrudPage<InvItem>
          key={`items-${version}-${suppliers.data?.length || 0}`}
          hideHeader
          title="Items"
          endpoint="/inventory"
          entityName="Item"
          fields={itemFields}
          onSaved={refreshSide}
          transform={(p) => ({ ...p, quantity: p.quantity ?? undefined, min_quantity: p.min_quantity ?? 0, cost_per_unit: p.cost_per_unit ?? 0 })}
          rowActions={(row) => (
            <>
              <Button size="xs" variant="ghost" className="text-emerald-700" title="Stock in" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={() => setMove({ open: true, itemId: row.id, type: 'stock_in' })}>In</Button>
              <Button size="xs" variant="ghost" className="text-sky-700" title="Stock out" icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} onClick={() => setMove({ open: true, itemId: row.id, type: 'stock_out' })}>Out</Button>
            </>
          )}
          columns={[
            { key: 'name', header: 'Item', render: (i) => <div><p className="font-medium text-ink-900">{i.name}</p><p className="text-xs text-ink-500">{[i.sku, i.category].filter(Boolean).join(' • ')}</p></div> },
            { key: 'quantity', header: 'In stock', align: 'right', value: (i) => Number(i.quantity), render: (i) => <span className={i.stock_status === 'low' ? 'font-semibold text-red-700' : 'font-semibold'}>{Number(i.quantity)} {i.unit}</span> },
            { key: 'min_quantity', header: 'Min', align: 'right', hideOnMobile: true, render: (i) => `${Number(i.min_quantity)} ${i.unit}` },
            { key: 'cost_per_unit', header: 'Unit cost', align: 'right', hideOnMobile: true, render: (i) => money(i.cost_per_unit) },
            { key: 'value', header: 'Value', align: 'right', hideOnMobile: true, value: (i) => Number(i.quantity) * Number(i.cost_per_unit), render: (i) => money(Number(i.quantity) * Number(i.cost_per_unit)) },
            { key: 'supplier_name', header: 'Supplier', hideOnMobile: true, render: (i) => i.supplier_name || '-' },
            { key: 'expiry_date', header: 'Expiry', hideOnMobile: true, render: (i) => (i.expiry_date ? fmtDate(i.expiry_date) : '-') },
            { key: 'stock_status', header: 'Status', render: (i) => (i.is_active ? <StatusBadge status={i.stock_status} label={i.stock_status === 'ok' ? 'In stock' : i.stock_status === 'low' ? 'Low stock' : 'Expiring'} /> : <StatusBadge status="inactive" />) },
          ]}
        />
      )}
      {tab === 'movements' && <Movements items={items.data || []} suppliers={suppliers.data || []} version={version} onRecord={() => setMove({ open: true })} />}
      {tab === 'suppliers' && (
        <CrudPage<Supplier>
          hideHeader
          title="Suppliers"
          endpoint="/suppliers"
          entityName="Supplier"
          fields={supplierFields}
          onSaved={refreshSide}
          columns={[
            { key: 'name', header: 'Supplier', render: (s) => <div><p className="font-medium text-ink-900">{s.name}</p><p className="text-xs text-ink-500">{s.contact_person}</p></div> },
            { key: 'phone', header: 'Phone', render: (s) => s.phone || '-' },
            { key: 'email', header: 'Email', hideOnMobile: true, render: (s) => s.email || '-' },
            { key: 'gstin', header: 'GSTIN', hideOnMobile: true, render: (s) => s.gstin || '-' },
            { key: 'item_count', header: 'Items', align: 'right' },
            { key: 'total_purchases', header: 'Purchases', align: 'right', render: (s) => money(s.total_purchases) },
            { key: 'is_active', header: 'Status', render: (s) => <StatusBadge status={s.is_active ? 'active' : 'inactive'} /> },
          ]}
        />
      )}

      <MovementModal open={move.open} onClose={() => setMove({ open: false })} items={items.data || []} suppliers={suppliers.data || []} initial={move} onSaved={bump} />
    </div>
  );
}
