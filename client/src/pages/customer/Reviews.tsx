import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareQuote, Star } from 'lucide-react';
import { toast } from 'sonner';
import { api, assetUrl } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import type { Review } from '../../lib/types';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useShop } from '../../context/ShopContext';
import { Button, Card, EmptyState, ImageUpload, Select, Skeleton, Stars, Textarea } from '../../components/ui';

export default function Reviews() {
  const { user } = useAuth();
  const { branchId, branch } = useShop();
  const { data, loading, reload } = useApi<Review[]>(branchId ? () => api.get(`/public/branches/${branchId}/reviews`) : null, [branchId]);
  const [filter, setFilter] = useState<'all' | 'restaurant' | 'food' | '5' | '4' | 'low'>('all');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => {
    const list = data || [];
    const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: list.filter((r) => r.rating === s).length }));
    const avg = list.length ? list.reduce((a, r) => a + r.rating, 0) / list.length : 0;
    return { dist, avg, total: list.length };
  }, [data]);

  const list = (data || []).filter((r) =>
    filter === 'all' ? true : filter === 'restaurant' ? !r.food_item_id : filter === 'food' ? !!r.food_item_id : filter === 'low' ? r.rating <= 3 : r.rating === Number(filter)
  );

  const submit = async () => {
    if (!comment.trim()) return toast.error('Please write a few words about your experience');
    setBusy(true);
    try {
      await api.post('/customer/reviews', { branch_id: branchId, rating, comment: comment.trim(), images });
      toast.success('Thank you for your review!');
      setComment('');
      setImages([]);
      setRating(5);
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{branch?.restaurant_name}</p>
      <h1 className="font-display text-3xl font-bold sm:text-4xl">Guest reviews</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-4">
              <p className="font-display text-5xl font-bold">{stats.avg.toFixed(1)}</p>
              <div>
                <Stars value={stats.avg} size={18} />
                <p className="mt-1 text-sm text-ink-500">{stats.total} reviews</p>
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              {stats.dist.map((d) => (
                <div key={d.s} className="flex items-center gap-2 text-xs">
                  <span className="w-3 text-ink-600">{d.s}</span>
                  <Star className="h-3 w-3 fill-brand-500 text-brand-500" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${stats.total ? (d.n / stats.total) * 100 : 0}%` }} />
                  </div>
                  <span className="w-6 text-right text-ink-500">{d.n}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Share your experience">
            {!user ? (
              <p className="text-sm text-ink-600">
                <Link to="/login" state={{ from: '/reviews' }} className="link">
                  Sign in
                </Link>{' '}
                to write a review.
              </p>
            ) : user.is_staff ? (
              <p className="text-sm text-ink-600">Staff accounts cannot post reviews.</p>
            ) : (
              <div className="space-y-3">
                <Stars value={rating} onChange={setRating} size={28} />
                <Textarea rows={4} placeholder="Tell us about the food, service and ambience..." value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
                <ImageUpload value={images} onChange={setImages} max={5} label="Photo" />
                <Button block loading={busy} onClick={submit}>
                  Post review
                </Button>
                <p className="text-xs text-ink-500">To rate individual dishes, open a completed order in My orders.</p>
              </div>
            )}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-500">{list.length} reviews</p>
            <Select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="w-auto">
              <option value="all">All reviews</option>
              <option value="restaurant">Restaurant</option>
              <option value="food">Dishes</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars</option>
              <option value="low">3 stars & below</option>
            </Select>
          </div>
          {loading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : !list.length ? (
            <EmptyState icon={<MessageSquareQuote className="h-6 w-6" />} title="No reviews yet" />
          ) : (
            <div className="space-y-3">
              {list.map((r) => (
                <div key={r.id} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800">{r.customer_name?.[0]}</span>
                      <div>
                        <p className="font-semibold">{r.customer_name}</p>
                        <div className="flex items-center gap-2">
                          <Stars value={r.rating} size={12} />
                          {r.food_name && <span className="text-xs text-ink-500">on {r.food_name}</span>}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-ink-400">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.comment && <p className="mt-3 text-sm leading-relaxed text-ink-700">{r.comment}</p>}
                  {r.images?.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {r.images.map((u) => (
                        <a key={u} href={assetUrl(u)} target="_blank" rel="noreferrer">
                          <img src={assetUrl(u)} alt="" className="h-20 w-20 rounded-lg object-cover" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  )}
                  {r.admin_reply && (
                    <div className="mt-3 rounded-xl bg-ink-50 p-3 text-sm">
                      <p className="text-xs font-semibold text-ink-700">Response from {branch?.restaurant_name}</p>
                      <p className="mt-1 text-ink-600">{r.admin_reply}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
