import { useMemo, useState } from 'react';
import { Eye, EyeOff, MessageSquareReply, Trash2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { fmtDate } from '../../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Img, Modal, PageHeader, Select, Spinner, Stars, Textarea, useConfirm } from '../../components/ui';

interface AdminReview {
  id: number;
  rating: number;
  comment: string | null;
  images: string[];
  admin_reply: string | null;
  is_published: boolean;
  created_at: string;
  customer_name: string;
  customer_email: string;
  food_name: string | null;
  food_item_id: number | null;
}

export default function Reviews() {
  const [rating, setRating] = useState('');
  const [type, setType] = useState('');
  const { data, loading, error, reload } = useApi<AdminReview[]>(() => adminApi.get('/reviews', { rating, type }), [rating, type]);
  const [replying, setReplying] = useState<AdminReview | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const confirm = useConfirm();

  const stats = useMemo(() => {
    const list = data || [];
    const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: list.filter((r) => r.rating === s).length }));
    const avg = list.length ? list.reduce((a, r) => a + r.rating, 0) / list.length : 0;
    return { avg, dist, total: list.length, hidden: list.filter((r) => !r.is_published).length };
  }, [data]);

  const patch = async (r: AdminReview, body: Record<string, any>, msg: string) => {
    setBusy(r.id);
    try {
      await adminApi.patch(`/reviews/${r.id}`, body);
      toast.success(msg);
      reload();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const del = async (r: AdminReview) => {
    if (!(await confirm({ title: 'Delete this review?', message: 'The review will be permanently removed.', danger: true, confirmText: 'Delete' })).ok) return;
    setBusy(r.id);
    try {
      await adminApi.delete(`/reviews/${r.id}`);
      toast.success('Review deleted');
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="Moderate guest feedback and reply publicly."
        actions={
          <>
            <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" options={[{ value: 'restaurant', label: 'Restaurant' }, { value: 'food', label: 'Food items' }]} placeholder="All types" />
            <Select value={rating} onChange={(e) => setRating(e.target.value)} className="w-36" options={[5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${n} star${n > 1 ? 's' : ''}` }))} placeholder="All ratings" />
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Star className="h-7 w-7 fill-brand-500 text-brand-500" />
          </div>
          <div>
            <p className="text-3xl font-bold">{stats.avg.toFixed(1)}</p>
            <p className="text-sm text-ink-500">Average of {stats.total} reviews{stats.hidden ? ` • ${stats.hidden} hidden` : ''}</p>
          </div>
        </Card>
        <Card className="md:col-span-2">
          <div className="space-y-1.5">
            {stats.dist.map(({ s, n }) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className="w-10 text-ink-600">{s} ★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${stats.total ? (n / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="w-8 text-right text-ink-500">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Spinner />
      ) : !data?.length ? (
        <Card><EmptyState title="No reviews found" description="Reviews submitted by guests will appear here." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((r) => (
            <div key={r.id} className={`card p-5 ${!r.is_published ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-900">{r.customer_name}</p>
                    {r.food_name ? <Badge tone="purple">{r.food_name}</Badge> : <Badge tone="blue">Restaurant</Badge>}
                    {!r.is_published && <Badge tone="gray">Hidden</Badge>}
                  </div>
                  <p className="text-xs text-ink-500">{r.customer_email} • {fmtDate(r.created_at)}</p>
                </div>
                <Stars value={r.rating} />
              </div>
              {r.comment && <p className="mt-3 text-sm leading-relaxed text-ink-700">{r.comment}</p>}
              {r.images?.length > 0 && (
                <div className="mt-3 flex gap-2">
                  {r.images.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer"><Img src={u} alt="" className="h-16 w-16 rounded-lg" /></a>
                  ))}
                </div>
              )}
              {r.admin_reply && (
                <div className="mt-3 rounded-lg border-l-4 border-brand-500 bg-brand-50/60 p-3 text-sm">
                  <p className="text-xs font-semibold text-brand-800">Your reply</p>
                  <p className="text-ink-700">{r.admin_reply}</p>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                <Button size="sm" variant="secondary" loading={busy === r.id} icon={r.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => patch(r, { is_published: !r.is_published }, r.is_published ? 'Review hidden' : 'Review published')}>
                  {r.is_published ? 'Unpublish' : 'Publish'}
                </Button>
                <Button size="sm" variant="secondary" icon={<MessageSquareReply className="h-4 w-4" />} onClick={() => (setReplying(r), setReply(r.admin_reply || ''))}>
                  {r.admin_reply ? 'Edit reply' : 'Reply'}
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} disabled={busy === r.id} onClick={() => del(r)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!replying}
        onClose={() => setReplying(null)}
        title={`Reply to ${replying?.customer_name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReplying(null)}>Cancel</Button>
            <Button loading={busy === replying?.id} onClick={async () => replying && (await patch(replying, { admin_reply: reply.trim() || null }, 'Reply saved')) && setReplying(null)}>Save reply</Button>
          </>
        }
      >
        <p className="mb-2 text-sm italic text-ink-600">"{replying?.comment || 'No comment'}"</p>
        <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Thank you for your feedback..." autoFocus />
        <p className="mt-1 text-xs text-ink-500">Replies are visible to customers on the reviews page. Leave empty to remove the reply.</p>
      </Modal>
    </div>
  );
}
