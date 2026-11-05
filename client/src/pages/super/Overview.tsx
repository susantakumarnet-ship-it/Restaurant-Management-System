import { useState } from 'react';
import { Building2, CalendarDays, ClipboardList, IndianRupee, Store, Users, UserCog } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadFile } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { compactMoney, fmtDate, money, parseDate, titleCase } from '../../lib/format';
import { Badge, Card, DataTable, ErrorState, Field, PageHeader, Select, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { ReportControls, ReportOutput, type ReportResult } from '../admin/Reports';

const REPORT_TYPES: Record<string, string> = {
  revenue: 'Revenue Report (Weekly / Monthly)',
  sales_daily: 'Daily Sales Report',
  bookings: 'Booking Report',
  cancelled_bookings: 'Cancelled & Rejected Bookings',
  customers: 'Customer Report',
  food_sales: 'Food Sales Report',
  payments: 'Payment Report',
  gst: 'GST Report',
  inventory: 'Inventory Report',
};

interface OverviewData {
  totals: Record<string, number>;
  restaurants: { id: number; name: string; subscription_plan: string; subscription_status: string; subscription_expires_at: string | null; is_active: boolean; branches: number; reservations_30d: number; orders_30d: number; revenue_30d: number }[];
  monthly: { month: string; revenue: number }[];
}

export default function Overview() {
  const { data, loading, error, reload } = useApi<OverviewData>(() => api.get('/super/overview'), []);
  const [restaurantId, setRestaurantId] = useState('');
  const [report, setReport] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [repErr, setRepErr] = useState<string | null>(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner label="Loading platform overview..." />;
  const t = data.totals;
  const chart = data.monthly.map((m) => ({ x: parseDate(m.month + '-01').toLocaleDateString('en-IN', { month: 'short' }), y: Number(m.revenue) }));

  const run = async (type: string, params: Record<string, any>) => {
    setRunning(true);
    setRepErr(null);
    try {
      setReport(await api.get(`/super/reports/${type}`, { ...params, restaurantId }));
    } catch (e: any) {
      setRepErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader title="Platform Overview" subtitle="All restaurants and branches on Smart RMS - last 30 days." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Restaurants" value={t.restaurants} hint={`${t.active_restaurants} active`} icon={<Store className="h-5 w-5" />} />
        <StatCard label="Branches" value={t.branches} icon={<Building2 className="h-5 w-5" />} tone="blue" />
        <StatCard label="Customers" value={t.customers} icon={<Users className="h-5 w-5" />} tone="purple" />
        <StatCard label="Staff users" value={t.staff_users} icon={<UserCog className="h-5 w-5" />} tone="gray" />
        <StatCard label="Revenue (30d)" value={compactMoney(t.revenue_30d)} hint={money(t.revenue_30d)} icon={<IndianRupee className="h-5 w-5" />} tone="green" />
        <StatCard label="Reservations (30d)" value={t.reservations_30d} icon={<CalendarDays className="h-5 w-5" />} tone="blue" />
        <StatCard label="Orders (30d)" value={t.orders_30d} icon={<ClipboardList className="h-5 w-5" />} />
      </div>

      <Card title="Platform revenue - last 12 months" className="mb-6">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e7e5e4" />
              <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#d6d3d1' }} />
              <YAxis tickFormatter={(v) => compactMoney(v)} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} width={56} />
              <Tooltip cursor={{ fill: '#fef3c7', opacity: 0.6 }} formatter={(v: any) => [money(v), 'Net revenue']} contentStyle={{ borderRadius: 10, border: '1px solid #e7e5e4', fontSize: 12 }} />
              <Bar dataKey="y" fill="#d97706" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Restaurants</h2>
      <DataTable
        className="mb-8"
        rows={data.restaurants}
        columns={[
          { key: 'name', header: 'Restaurant', render: (r) => <span className="font-medium text-ink-900">{r.name}</span> },
          { key: 'subscription_plan', header: 'Plan', render: (r) => <Badge tone={r.subscription_plan === 'enterprise' ? 'purple' : r.subscription_plan === 'pro' ? 'amber' : 'gray'}>{titleCase(r.subscription_plan)}</Badge> },
          { key: 'subscription_status', header: 'Subscription', render: (r) => <div><StatusBadge status={r.subscription_status} />{r.subscription_expires_at && <p className="mt-0.5 text-[11px] text-ink-500">until {fmtDate(r.subscription_expires_at)}</p>}</div> },
          { key: 'is_active', header: 'Status', hideOnMobile: true, render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
          { key: 'branches', header: 'Branches', align: 'right', hideOnMobile: true },
          { key: 'reservations_30d', header: 'Bookings', align: 'right', hideOnMobile: true },
          { key: 'orders_30d', header: 'Orders', align: 'right', hideOnMobile: true },
          { key: 'revenue_30d', header: 'Revenue', align: 'right', render: (r) => money(r.revenue_30d) },
        ]}
      />

      <h2 className="mb-3 text-lg font-semibold">Consolidated reports</h2>
      <ReportControls
        types={REPORT_TYPES}
        running={running}
        statusFilter={false}
        onRun={run}
        onExport={(type, params, format) => downloadFile(`/super/reports/${type}`, { ...params, restaurantId, format })}
        extra={
          <Field label="Restaurant">
            <Select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} placeholder="All restaurants" options={data.restaurants.map((r) => ({ value: r.id, label: r.name }))} />
          </Field>
        }
      />
      <ReportOutput report={report} loading={running} error={repErr} />
    </div>
  );
}
