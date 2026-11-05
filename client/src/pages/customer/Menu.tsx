import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, ShoppingBag, SlidersHorizontal, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import type { Category, FoodItem } from '../../lib/types';
import { useApi } from '../../hooks/useApi';
import { useShop } from '../../context/ShopContext';
import { DietDot, EmptyState, ErrorState, Input, Select, Skeleton } from '../../components/ui';
import { FoodCard } from '../../components/FoodCard';
import { FoodDetailModal } from '../../components/FoodDetailModal';

type Diet = 'all' | 'veg' | 'non_veg' | 'vegan';
type Sort = 'popular' | 'price_asc' | 'price_desc' | 'rating';

export default function Menu() {
  const { branchId, branch, count, subtotal, setCartOpen } = useShop();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useApi<{ categories: Category[]; items: FoodItem[] }>(branchId ? () => api.get(`/public/branches/${branchId}/menu`) : null, [branchId]);
  const [q, setQ] = useState('');
  const [diet, setDiet] = useState<Diet>('all');
  const [sort, setSort] = useState<Sort>('popular');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [open, setOpen] = useState<FoodItem | null>(null);
  const activeCat = params.get('category') ? Number(params.get('category')) : null;
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({});

  const filtered = useMemo(() => {
    let list = data?.items || [];
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((i) => `${i.name} ${i.description || ''} ${i.ingredients || ''}`.toLowerCase().includes(s));
    if (diet !== 'all') list = list.filter((i) => (diet === 'veg' ? i.diet_type === 'veg' || i.diet_type === 'vegan' : i.diet_type === diet));
    if (onlyAvailable) list = list.filter((i) => i.is_available);
    const price = (i: FoodItem) => Number(i.discounted_price ?? i.price);
    const sorted = [...list];
    if (sort === 'price_asc') sorted.sort((a, b) => price(a) - price(b));
    if (sort === 'price_desc') sorted.sort((a, b) => price(b) - price(a));
    if (sort === 'rating') sorted.sort((a, b) => Number(b.avg_rating) - Number(a.avg_rating));
    if (sort === 'popular') sorted.sort((a, b) => Number(b.is_bestseller) - Number(a.is_bestseller) || Number(b.times_ordered || 0) - Number(a.times_ordered || 0));
    return sorted;
  }, [data, q, diet, sort, onlyAvailable]);

  const grouped = useMemo(
    () => (data?.categories || []).map((c) => ({ cat: c, items: filtered.filter((i) => i.category_id === c.id) })).filter((g) => g.items.length && (!activeCat || g.cat.id === activeCat)),
    [data, filtered, activeCat]
  );

  useEffect(() => {
    if (activeCat && sectionRefs.current[activeCat]) sectionRefs.current[activeCat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeCat, data]);

  const setCat = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('category', String(id));
    else p.delete('category');
    setParams(p, { replace: true });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{branch?.restaurant_name}</p>
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">Our Menu</h1>
        <p className="mt-1 text-sm text-ink-500">Order for delivery, takeaway or dine-in. Freshly prepared, every time.</p>
      </div>

      {/* Filters */}
      <div className="sticky top-16 z-20 -mx-4 mb-6 space-y-3 border-b border-ink-200/60 bg-[#fbf8f3]/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input icon={<Search className="h-4 w-4" />} placeholder="Search dishes, ingredients..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-ink-200 bg-white p-0.5">
              {(['all', 'veg', 'non_veg', 'vegan'] as Diet[]).map((d) => (
                <button key={d} onClick={() => setDiet(d)} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition', diet === d ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100')}>
                  {d !== 'all' && <DietDot type={d} />}
                  {d === 'all' ? 'All' : d === 'veg' ? 'Veg' : d === 'non_veg' ? 'Non-Veg' : 'Vegan'}
                </button>
              ))}
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto" aria-label="Sort">
              <option value="popular">Popular</option>
              <option value="rating">Top rated</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </Select>
          </div>
        </div>
        <div className="scrollbar-thin flex items-center gap-2 overflow-x-auto">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-ink-400" />
          <button onClick={() => setCat(null)} className={clsx('shrink-0 rounded-full px-3 py-1 text-sm font-medium', !activeCat ? 'bg-brand-600 text-white' : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50')}>
            All
          </button>
          {data?.categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={clsx('shrink-0 rounded-full px-3 py-1 text-sm font-medium', activeCat === c.id ? 'bg-brand-600 text-white' : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50')}>
              {c.name}
            </button>
          ))}
          <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-600">
            <input type="checkbox" className="accent-brand-600" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> Available now
          </label>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-80" />)}</div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No dishes match your filters"
          action={
            <button
              className="link inline-flex items-center gap-1"
              onClick={() => {
                setQ('');
                setDiet('all');
                setCat(null);
                setOnlyAvailable(false);
              }}
            >
              <X className="h-4 w-4" /> Clear filters
            </button>
          }
        />
      ) : (
        <div className="space-y-12">
          {grouped.map(({ cat, items }) => (
            <section key={cat.id} ref={(el) => (sectionRefs.current[cat.id] = el)} className="scroll-mt-48">
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="font-display text-2xl font-bold text-ink-900">{cat.name}</h2>
                <span className="text-sm text-ink-400">{items.length} items</span>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((i) => (
                  <FoodCard key={i.id} item={i} onOpen={setOpen} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="fixed bottom-20 left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between rounded-2xl bg-ink-900 px-5 py-3.5 text-white shadow-lift transition hover:bg-ink-800 md:bottom-6">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShoppingBag className="h-5 w-5 text-brand-400" /> {count} item{count > 1 ? 's' : ''} • {money(subtotal)}
          </span>
          <span className="text-sm font-semibold text-brand-400">View cart →</span>
        </button>
      )}
      <FoodDetailModal item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
