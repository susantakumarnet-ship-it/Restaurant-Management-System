import { useState } from 'react';
import { Clock, Flame, Star } from 'lucide-react';
import type { FoodItem, Review } from '../lib/types';
import { api } from '../lib/api';
import { DIET_LABEL, timeAgo } from '../lib/format';
import { useApi } from '../hooks/useApi';
import { useShop } from '../context/ShopContext';
import { DietDot, Img, Modal, Stars } from './ui';
import { AddToCart, Price } from './FoodCard';

export function FoodDetailModal({ item, onClose }: { item: FoodItem | null; onClose: () => void }) {
  const { branchId } = useShop();
  const [img, setImg] = useState(0);
  const { data: reviews } = useApi<Review[]>(item && branchId ? () => api.get(`/public/branches/${branchId}/reviews`, { foodItemId: item.id }) : null, [item?.id, branchId]);
  if (!item) return null;
  return (
    <Modal open={!!item} onClose={() => (setImg(0), onClose())} size="lg" title={item.name}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Img src={item.images?.[img]} alt={item.name} className="aspect-square w-full rounded-2xl" />
          {item.images.length > 1 && (
            <div className="mt-2 flex gap-2">
              {item.images.map((u, i) => (
                <button key={u} onClick={() => setImg(i)} className={`h-14 w-14 overflow-hidden rounded-lg ring-2 ${i === img ? 'ring-brand-500' : 'ring-transparent'}`}>
                  <Img src={u} alt="" className="h-full w-full" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <DietDot type={item.diet_type} />
            <span className="font-medium text-ink-700">{DIET_LABEL[item.diet_type]}</span>
            {item.rating_count > 0 && (
              <span className="inline-flex items-center gap-1 text-ink-600">
                <Star className="h-4 w-4 fill-brand-500 text-brand-500" /> {Number(item.avg_rating).toFixed(1)} ({item.rating_count} reviews)
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-ink-600">
              <Clock className="h-4 w-4" /> {item.prep_time_min} min
            </span>
            {item.spice_level > 0 && (
              <span className="inline-flex text-red-500">
                {[...Array(item.spice_level)].map((_, i) => (
                  <Flame key={i} className="h-4 w-4" />
                ))}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-ink-600">{item.description}</p>
          {item.ingredients && (
            <div>
              <p className="label">Ingredients</p>
              <p className="text-sm text-ink-700">{item.ingredients}</p>
            </div>
          )}
          {item.allergens && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">Allergens:</span> {item.allergens}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-ink-100 pt-4">
            <Price item={item} className="text-lg" />
            <AddToCart item={item} />
          </div>
          {!!reviews?.length && (
            <div className="border-t border-ink-100 pt-4">
              <p className="label">What guests say</p>
              <div className="max-h-48 space-y-3 overflow-y-auto">
                {reviews.slice(0, 5).map((r) => (
                  <div key={r.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Stars value={r.rating} size={12} />
                      <span className="font-medium text-ink-800">{r.customer_name}</span>
                      <span className="text-xs text-ink-400">{timeAgo(r.created_at)}</span>
                    </div>
                    {r.comment && <p className="mt-0.5 text-ink-600">{r.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
