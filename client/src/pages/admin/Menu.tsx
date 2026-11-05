import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Flame, Pencil, Plus, Search, Star, Trash2, Clock, Award, ThumbsUp } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { money, DIET_LABEL } from '../../lib/format';
import type { Category, FoodItem } from '../../lib/types';
import { CrudPage, EntityFormModal, type FieldDef } from '../../components/CrudPage';
import { Badge, Button, DietDot, EmptyState, ErrorState, Img, Input, PageHeader, Select, Spinner, StatusBadge, Switch, Tabs, useConfirm } from '../../components/ui';

export default function Menu() {
  const [tab, setTab] = useState<'items' | 'categories'>('items');
  return (
    <div>
      <PageHeader title="Food Menu" subtitle="Dishes, prices, availability and categories" actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Menu items' }, { value: 'categories', label: 'Categories' }]} />} />
      {tab === 'items' ? <Items /> : <Categories />}
    </div>
  );
}

function Items() {
  const { data: items, loading, error, reload, setData } = useApi<FoodItem[]>(() => adminApi.get('/food-items'), []);
  const { data: categories } = useApi<Category[]>(() => adminApi.get('/categories'), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [diet, setDiet] = useState('');
  const [avail, setAvail] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();

  const filtered = useMemo(
    () =>
      (items || []).filter(
        (f) =>
          (!q || `${f.name} ${f.description || ''}`.toLowerCase().includes(q.toLowerCase())) &&
          (!cat || f.category_id === Number(cat)) &&
          (!diet || f.diet_type === diet) &&
          (!avail || String(f.is_available) === avail)
      ),
    [items, q, cat, diet, avail]
  );

  const fields: FieldDef[] = [
    { name: 'name', label: 'Dish name', required: true },
    { name: 'category_id', label: 'Category', type: 'select', numeric: true, required: true, options: (categories || []).map((c) => ({ value: c.id, label: c.name })) },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'price', label: 'Price (₹)', type: 'number', required: true, step: '0.01', min: 0 },
    { name: 'discounted_price', label: 'Discounted price (₹)', type: 'number', step: '0.01', min: 0, hint: 'Leave empty for no discount' },
    { name: 'diet_type', label: 'Diet type', type: 'select', required: true, options: [{ value: 'veg', label: 'Veg' }, { value: 'non_veg', label: 'Non-Veg' }, { value: 'vegan', label: 'Vegan' }], default: 'veg' },
    { name: 'prep_time_min', label: 'Preparation time (min)', type: 'number', min: 0, max: 240 },
    { name: 'spice_level', label: 'Spice level', type: 'select', numeric: true, options: [{ value: 0, label: 'Not spicy' }, { value: 1, label: 'Mild' }, { value: 2, label: 'Medium' }, { value: 3, label: 'Hot' }] },
    { name: 'is_available', label: 'Availability', type: 'switch', placeholder: 'Available to order' },
    { name: 'is_bestseller', label: 'Bestseller tag', type: 'switch', placeholder: 'Show "Bestseller"' },
    { name: 'is_recommended', label: 'Recommended tag', type: 'switch', placeholder: 'Show "Chef recommends"' },
    { name: 'ingredients', label: 'Ingredients', type: 'textarea' },
    { name: 'allergens', label: 'Allergens', full: true, placeholder: 'e.g. Dairy, Nuts, Gluten' },
    { name: 'images', label: 'Photos (first is primary)', type: 'images' },
  ];

  const save = async (payload: Record<string, any>) => {
    const body = { ...payload, prep_time_min: payload.prep_time_min ?? 15, spice_level: payload.spice_level ?? 0 };
    if (editing?.id) await adminApi.put(`/food-items/${editing.id}`, body);
    else await adminApi.post('/food-items', body);
    toast.success(editing?.id ? 'Dish updated' : 'Dish added');
    reload();
  };

  const toggle = async (f: FoodItem) => {
    setData((list) => list?.map((x) => (x.id === f.id ? { ...x, is_available: !f.is_available } : x)) || null);
    try {
      await adminApi.patch(`/food-items/${f.id}/availability`, { is_available: !f.is_available });
      toast.success(`${f.name} is now ${!f.is_available ? 'available' : 'unavailable'}`);
    } catch (e: any) {
      toast.error(e.message);
      reload();
    }
  };

  const del = async (f: FoodItem) => {
    const { ok } = await confirm({ title: `Delete ${f.name}?`, message: 'Past orders keep their line items; the dish is removed from the menu.', danger: true, confirmText: 'Delete' });
    if (!ok) return;
    try {
      await adminApi.delete(`/food-items/${f.id}`);
      toast.success('Dish deleted');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="sm:w-64"><Input icon={<Search className="h-4 w-4" />} placeholder="Search dishes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className="sm:w-auto" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={(categories || []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select className="sm:w-auto" value={diet} onChange={(e) => setDiet(e.target.value)} placeholder="All diets" options={Object.entries(DIET_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select className="sm:w-auto" value={avail} onChange={(e) => setAvail(e.target.value)} placeholder="Any availability" options={[{ value: 'true', label: 'Available' }, { value: 'false', label: 'Unavailable' }]} />
        <span className="text-sm text-ink-500 sm:ml-auto">{filtered.length} dishes</span>
        <Button icon={<Plus className="h-4 w-4" />} disabled={!categories?.length} onClick={() => (setEditing({ is_available: true, diet_type: 'veg', prep_time_min: 15, spice_level: 0 }), setOpen(true))}>
          Add dish
        </Button>
      </div>
      {loading && !items ? (
        <Spinner />
      ) : !categories?.length ? (
        <EmptyState title="Create a category first" description="Dishes belong to categories such as Starters or Desserts." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No dishes match" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((f) => (
            <div key={f.id} className={clsx('card flex flex-col overflow-hidden', !f.is_available && 'opacity-70')}>
              <div className="relative">
                <Img src={f.images?.[0]} alt={f.name} className="h-40 w-full" />
                <div className="absolute left-2 top-2 flex gap-1">
                  {f.is_bestseller && <Badge tone="amber" className="bg-white/95"><Award className="h-3 w-3" />Bestseller</Badge>}
                  {f.is_recommended && <Badge tone="purple" className="bg-white/95"><ThumbsUp className="h-3 w-3" />Recommended</Badge>}
                </div>
                {!f.is_available && <span className="absolute inset-x-0 bottom-0 bg-ink-900/80 py-1 text-center text-xs font-semibold text-white">Unavailable</span>}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-semibold text-ink-900"><DietDot type={f.diet_type} /> <span className="truncate">{f.name}</span></p>
                    <p className="text-xs text-ink-500">{f.category_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-ink-900">{money(f.discounted_price ?? f.price)}</p>
                    {f.discounted_price != null && <p className="text-xs text-ink-400 line-through">{money(f.price)}</p>}
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-ink-600">{f.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-brand-500 text-brand-500" />{Number(f.avg_rating).toFixed(1)} ({f.rating_count})</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{f.prep_time_min} min</span>
                  {f.spice_level > 0 && <span className="inline-flex items-center gap-0.5 text-red-600">{Array.from({ length: f.spice_level }).map((_, i) => <Flame key={i} className="h-3.5 w-3.5" />)}</span>}
                  <span>{f.times_ordered} sold</span>
                </div>
                {f.allergens && <p className="mt-1 text-xs text-ink-500">Allergens: {f.allergens}</p>}
                <div className="mt-auto flex items-center justify-between border-t border-ink-100 pt-3">
                  <Switch checked={f.is_available} onChange={() => toggle(f)} label={<span className="text-xs">Available</span>} />
                  <div className="flex gap-1">
                    <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => (setEditing(f), setOpen(true))}>Edit</Button>
                    <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del(f)} aria-label="Delete" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <EntityFormModal open={open} onClose={() => setOpen(false)} title={editing?.id ? `Edit ${editing.name}` : 'New dish'} fields={fields} initial={editing} onSubmit={save} size="xl" />
    </div>
  );
}

function Categories() {
  return (
    <CrudPage<Category>
      hideHeader
      title="Categories"
      endpoint="/categories"
      entityName="Category"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'sort_order', label: 'Display order', type: 'number', hint: 'Lower numbers appear first' },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'image_url', label: 'Image', type: 'image' },
        { name: 'is_active', label: 'Active', type: 'switch', placeholder: 'Show on menu' },
      ]}
      transform={(p) => ({ ...p, sort_order: p.sort_order ?? 0 })}
      columns={[
        { key: 'image_url', header: '', sortable: false, render: (c) => <Img src={c.image_url} alt={c.name} className="h-10 w-10 rounded-lg" /> },
        { key: 'name', header: 'Category', render: (c) => <span className="font-semibold text-ink-900">{c.name}</span> },
        { key: 'item_count', header: 'Dishes', align: 'center' },
        { key: 'sort_order', header: 'Order', align: 'center' },
        { key: 'description', header: 'Description', hideOnMobile: true },
        { key: 'is_active', header: 'Status', render: (c) => <StatusBadge status={c.is_active ? 'active' : 'inactive'} /> },
      ]}
    />
  );
}
