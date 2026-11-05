import { Flame, Minus, Plus, Star, Clock } from 'lucide-react';
import clsx from 'clsx';
import type { FoodItem } from '../lib/types';
import { money } from '../lib/format';
import { useShop } from '../context/ShopContext';
import { DietDot, Img } from './ui';

export function QtyStepper({ qty, onChange, size = 'md' }: { qty: number; onChange: (q: number) => void; size?: 'sm' | 'md' }) {
  return (
    <div className={clsx('inline-flex items-center rounded-full border border-brand-600 bg-white font-semibold text-brand-700', size === 'sm' ? 'h-8' : 'h-9')}>
      <button type="button" onClick={() => onChange(qty - 1)} className="flex h-full w-8 items-center justify-center rounded-l-full hover:bg-brand-50" aria-label="Decrease quantity">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-6 text-center text-sm tabular-nums">{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} className="flex h-full w-8 items-center justify-center rounded-r-full hover:bg-brand-50" aria-label="Increase quantity">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AddToCart({ item, compact }: { item: FoodItem; compact?: boolean }) {
  const { qtyOf, add, setQty } = useShop();
  const q = qtyOf(item.id);
  if (!item.is_available) return <span className="rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-500">Unavailable</span>;
  if (q > 0) return <QtyStepper qty={q} onChange={(n) => setQty(item.id, n)} size={compact ? 'sm' : 'md'} />;
  return (
    <button type="button" onClick={() => add(item)} className={clsx('inline-flex items-center gap-1 rounded-full bg-brand-600 font-semibold text-white shadow-sm transition hover:bg-brand-700', compact ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm')}>
      <Plus className="h-4 w-4" /> Add
    </button>
  );
}

export function Price({ item, className }: { item: Pick<FoodItem, 'price' | 'discounted_price'>; className?: string }) {
  const hasDiscount = item.discounted_price != null && Number(item.discounted_price) < Number(item.price);
  return (
    <span className={clsx('inline-flex items-baseline gap-1.5', className)}>
      <span className="font-semibold text-ink-900">{money(hasDiscount ? item.discounted_price! : item.price)}</span>
      {hasDiscount && <span className="text-xs text-ink-400 line-through">{money(item.price)}</span>}
    </span>
  );
}

/** Menu card used on Home and Menu pages. */
export function FoodCard({ item, onOpen }: { item: FoodItem; onOpen?: (i: FoodItem) => void }) {
  return (
    <div className={clsx('group flex flex-col overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift', !item.is_available && 'opacity-70')}>
      <button type="button" onClick={() => onOpen?.(item)} className="relative aspect-[4/3] overflow-hidden text-left">
        <Img src={item.images?.[0]} alt={item.name} className="h-full w-full transition duration-500 group-hover:scale-105" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {item.is_bestseller && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">Bestseller</span>}
          {item.is_recommended && <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold text-ink-800 shadow">Chef's pick</span>}
        </div>
        {item.discounted_price != null && Number(item.discounted_price) < Number(item.price) && (
          <span className="absolute right-3 top-3 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">{Math.round((1 - Number(item.discounted_price) / Number(item.price)) * 100)}% OFF</span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <span className="mt-1">
            <DietDot type={item.diet_type} />
          </span>
          <button type="button" onClick={() => onOpen?.(item)} className="text-left font-semibold leading-snug text-ink-900 hover:text-brand-700">
            {item.name}
          </button>
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink-500">{item.description}</p>
        <div className="mt-2 flex items-center gap-3 text-xs text-ink-500">
          {item.rating_count > 0 && (
            <span className="inline-flex items-center gap-0.5 font-medium text-ink-700">
              <Star className="h-3.5 w-3.5 fill-brand-500 text-brand-500" /> {Number(item.avg_rating).toFixed(1)} <span className="text-ink-400">({item.rating_count})</span>
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Clock className="h-3.5 w-3.5" /> {item.prep_time_min} min
          </span>
          {item.spice_level > 0 && (
            <span className="inline-flex text-red-500" title={`Spice level ${item.spice_level}`}>
              {[...Array(item.spice_level)].map((_, i) => (
                <Flame key={i} className="h-3.5 w-3.5" />
              ))}
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between pt-4">
          <Price item={item} />
          <AddToCart item={item} />
        </div>
      </div>
    </div>
  );
}
