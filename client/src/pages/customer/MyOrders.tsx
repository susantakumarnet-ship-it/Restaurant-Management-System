import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ShoppingBag, Bike, Store, UtensilsCrossed } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime, money, titleCase } from '../../lib/format';
import { useApi } from '../../hooks/useApi';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, Tabs } from '../../components/ui';
import { AccountNav } from './AccountNav';

const TYPE_ICON = { delivery: Bike, takeaway: Store, dine_in: UtensilsCrossed } as const;

export default function MyOrders() {
  const { data, loading, error, reload } = useApi<any[]>(() => api.get('/customer/orders'), []);
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const list = (data || []).filter((o) => (tab === 'active' ? !['completed', 'cancelled'].includes(o.status) : true));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <AccountNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">My orders</h1>
        <Link to="/menu">
          <Button icon={<ShoppingBag className="h-4 w-4" />}>Order food</Button>
        </Link>
      </div>
      <Tabs
        className="mb-5 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'active', label: 'Active', count: (data || []).filter((o) => !['completed', 'cancelled'].includes(o.status)).length },
          { value: 'all', label: 'All orders', count: data?.length || 0 },
        ]}
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<ShoppingBag className="h-6 w-6" />} title={tab === 'active' ? 'No active orders' : 'No orders yet'} action={<Link to="/menu"><Button>Browse menu</Button></Link>} />
      ) : (
        <div className="space-y-3">
          {list.map((o) => {
            const I = TYPE_ICON[o.order_type as keyof typeof TYPE_ICON] || ShoppingBag;
            return (
              <Link key={o.id} to={`/my/orders/${o.id}`} className="card flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <I className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{o.order_code}</span>
                    <StatusBadge status={o.status} />
                    <StatusBadge status={o.payment_status} />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink-600">{o.summary}</p>
                  <p className="text-xs text-ink-500">
                    {titleCase(o.order_type)} • {o.branch_name} • {fmtDateTime(o.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{money(o.total)}</p>
                  <p className="text-xs text-ink-500">{o.item_count} items</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-300" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
