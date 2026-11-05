import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, CalendarCheck, Clock, XCircle, ClipboardList, IndianRupee, TrendingUp, Users, Armchair, Flame, Boxes, CheckCircle2 } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { compactMoney, fmtDate, fmtDateTime, fmtTime, money, titleCase, toDateInput } from '../../lib/format';
import { Card, EmptyState, ErrorState, Img, PageHeader, Spinner, StatCard, StatusBadge, Tabs } from '../../components/ui';

// Validated categorical palette (dataviz validator: all checks pass on light surface). Fixed order, never cycled.
const CAT = ['#d97706', '#2563eb', '#be123c', '#0891b2', '#7c3aed', '#65a30d'];
const BRAND = CAT[0];
const GRID = '#e7e5e4';
const AXIS = { fontSize: 11, fill: '#78716c' };

const shortDay = (s: string) => fmtDate(s, { day: 'numeric', month: 'short' });
const shortMonth = (s: string) => fmtDate(`${s}-01`, { month: 'short' });

function ChartTip({ active, payload, label, fmtLabel, money: isMoney }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-lift">
      <p className="mb-1 font-semibold text-ink-900">{fmtLabel ? fmtLabel(label) : label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink-700">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          {p.name}: <span className="font-semibold text-ink-900">{isMoney && p.dataKey !== 'orders' && p.dataKey !== 'count' && p.dataKey !== 'quantity' ? money(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Horizontal bar breakdown (status / type / category). Single series => no legend; labels are the categories. */
function Breakdown({ rows, labelKey, valueKey, isMoney, empty }: { rows: any[]; labelKey: string; valueKey: string; isMoney?: boolean; empty: string }) {
  if (!rows?.length) return <EmptyState title={empty} className="py-8" />;
  const data = rows.map((r) => ({ ...r, label: titleCase(r[labelKey]), value: Number(r[valueKey]) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => (isMoney ? compactMoney(v) : v)} />
        <YAxis type="category" dataKey="label" tick={AXIS} axisLine={false} tickLine={false} width={96} />
        <Tooltip cursor={{ fill: '#f5f5f4' }} content={<ChartTip money={isMoney} />} />
        <Bar dataKey="value" name={isMoney ? 'Revenue' : 'Count'} fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState<'7' | '14' | '30' | '90'>('14');
  const nav = useNavigate();
  const { hasPerm } = useAuth();
  // Only make a card clickable when the user can actually open the target page (mirrors the route guards).
  const go = (path: string, ...perms: string[]) => (hasPerm(...perms) ? () => nav(path) : undefined);
  const { data, loading, error, reload } = useApi<any>(() => adminApi.get('/dashboard', { days }), [days]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner label="Loading dashboard..." />;
  const c = data.cards;
  const ch = data.charts;

  return (
    <div className={loading ? 'opacity-70 transition' : 'transition'}>
      <PageHeader
        title="Dashboard"
        subtitle={`Overview for ${fmtDate(toDateInput(), { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={<Tabs value={days} onChange={setDays} tabs={[{ value: '7', label: '7d' }, { value: '14', label: '14d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's revenue" value={money(c.today_revenue, { decimals: false })} icon={<IndianRupee className="h-5 w-5" />} hint={`${c.today_orders} orders today`} onClick={go('/admin/payments', 'payments.manage')} />
        <StatCard label="Monthly revenue" value={compactMoney(c.monthly_revenue)} icon={<TrendingUp className="h-5 w-5" />} tone="green" hint="Net of refunds" onClick={go('/admin/reports', 'reports.view')} />
        <StatCard label="Today's reservations" value={c.today_reservations} icon={<CalendarDays className="h-5 w-5" />} tone="blue" hint={`${c.guests_today} guests expected`} onClick={go('/admin/reservations', 'reservations.view', 'reservations.manage')} />
        <StatCard label="Active orders" value={c.active_orders} icon={<Flame className="h-5 w-5" />} tone="red" hint={`${c.total_orders} orders all-time`} onClick={go('/admin/orders', 'orders.view', 'orders.manage')} />
        <StatCard label="Pending reservations" value={c.pending_reservations} icon={<Clock className="h-5 w-5" />} tone="brand" hint="Awaiting approval" onClick={go('/admin/reservations?status=pending', 'reservations.view', 'reservations.manage')} />
        <StatCard label="Confirmed (upcoming)" value={c.confirmed_reservations} icon={<CalendarCheck className="h-5 w-5" />} tone="green" hint={`${c.total_reservations} total reservations`} />
        <StatCard label="Cancelled this month" value={c.cancelled_reservations} icon={<XCircle className="h-5 w-5" />} tone="gray" />
        <StatCard label="Total customers" value={c.total_customers} icon={<Users className="h-5 w-5" />} tone="purple" onClick={go('/admin/customers', 'customers.view', 'customers.manage')} />
        <StatCard label="Available tables" value={`${c.available_tables} / ${c.total_tables}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" hint={`${c.reserved_tables} reserved soon`} onClick={go('/admin/tables', 'tables.view', 'tables.manage')} />
        <StatCard label="Occupied tables" value={c.occupied_tables} icon={<Armchair className="h-5 w-5" />} tone="red" hint={`${c.maintenance_tables} under maintenance`} onClick={go('/admin/tables', 'tables.view', 'tables.manage')} />
        <StatCard label="Total orders" value={c.total_orders} icon={<ClipboardList className="h-5 w-5" />} tone="blue" />
        <StatCard label="Low stock items" value={c.low_stock_items} icon={<Boxes className="h-5 w-5" />} tone={c.low_stock_items ? 'red' : 'gray'} onClick={go('/admin/inventory', 'inventory.manage')} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Daily revenue" className="xl:col-span-2" actions={<span className="text-xs text-ink-500">Last {days} days</span>}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={ch.daily_revenue} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={AXIS} tickFormatter={compactMoney} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTip money fmtLabel={shortDay} />} cursor={{ stroke: '#a8a29e', strokeDasharray: 3 }} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={BRAND} strokeWidth={2} fill="url(#rev)" activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Orders per day">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ch.daily_revenue} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip fmtLabel={shortDay} />} cursor={{ fill: '#f5f5f4' }} />
              <Bar dataKey="orders" name="Orders" fill={CAT[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Monthly sales" className="xl:col-span-2" actions={<span className="text-xs text-ink-500">Last 12 months</span>}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ch.monthly_sales} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="month" tick={AXIS} tickFormatter={shortMonth} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} tickFormatter={compactMoney} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTip money fmtLabel={(m: string) => fmtDate(`${m}-01`, { month: 'long', year: 'numeric' })} />} cursor={{ fill: '#f5f5f4' }} />
              <Bar dataKey="sales" name="Sales" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Popular dishes" actions={<span className="text-xs text-ink-500">Last 30 days</span>} padded={false}>
          {data.popular_items.length === 0 ? (
            <EmptyState title="No sales yet" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.popular_items.map((p: any, i: number) => (
                <li key={p.id ?? p.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-4 text-xs font-bold text-ink-400">{i + 1}</span>
                  <Img src={p.image} alt={p.name} className="h-10 w-10 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{p.name}</p>
                    <p className="text-xs text-ink-500">{p.quantity} sold</p>
                  </div>
                  <span className="text-sm font-semibold text-ink-800">{compactMoney(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Reservations by day" className="xl:col-span-2" actions={<span className="text-xs text-ink-500">Incl. next 7 days</span>}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ch.reservations_by_day} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip fmtLabel={shortDay} />} cursor={{ fill: '#f5f5f4' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#57534e' }} />
              <Bar dataKey="bookings" name="Bookings" stackId="r" fill={CAT[1]} maxBarSize={22} stroke="#fff" strokeWidth={1} />
              <Bar dataKey="cancelled" name="Cancelled / no-show" stackId="r" fill={CAT[2]} radius={[4, 4, 0, 0]} maxBarSize={22} stroke="#fff" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Reservation status" actions={<span className="text-xs text-ink-500">Last 30 days</span>}>
          <Breakdown rows={ch.reservation_status} labelKey="status" valueKey="count" empty="No reservations" />
        </Card>

        <Card title="Order status" actions={<span className="text-xs text-ink-500">Last 30 days</span>}>
          <Breakdown rows={ch.order_status} labelKey="status" valueKey="count" empty="No orders" />
        </Card>
        <Card title="Revenue by order type" actions={<span className="text-xs text-ink-500">Last 30 days</span>}>
          <Breakdown rows={ch.order_types} labelKey="order_type" valueKey="revenue" isMoney empty="No orders" />
        </Card>
        <Card title="Category performance" actions={<span className="text-xs text-ink-500">Revenue, 30 days</span>}>
          {ch.category_performance.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, ch.category_performance.length * 34)}>
              <BarChart data={ch.category_performance.map((r: any) => ({ ...r, revenue: Number(r.revenue) }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={compactMoney} />
                <YAxis type="category" dataKey="category" tick={AXIS} axisLine={false} tickLine={false} width={104} />
                <Tooltip cursor={{ fill: '#f5f5f4' }} content={<ChartTip money />} />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {ch.category_performance.map((_: any, i: number) => (
                    <Cell key={i} fill={BRAND} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No sales yet" className="py-8" />
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Today's reservations" actions={<Link to="/admin/reservations" className="link text-sm">View all</Link>} padded={false}>
          {data.today_reservations.length === 0 ? (
            <EmptyState title="No reservations today" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.today_reservations.map((r: any) => (
                <li key={r.id}>
                  <Link to={`/admin/reservations?id=${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50">
                    <span className="w-16 text-sm font-semibold text-ink-900">{fmtTime(r.start_at)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{r.customer_name}</p>
                      <p className="text-xs text-ink-500">
                        {r.booking_code} · {r.guests} guests
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent orders" actions={<Link to="/admin/orders" className="link text-sm">View all</Link>} padded={false}>
          {data.recent_orders.length === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.recent_orders.map((o: any) => (
                <li key={o.id}>
                  <Link to={`/admin/orders?id=${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-900">
                        {o.order_code} <span className="font-normal text-ink-500">· {titleCase(o.order_type)}</span>
                      </p>
                      <p className="text-xs text-ink-500">{fmtDateTime(o.created_at)}</p>
                    </div>
                    <span className="text-sm font-semibold">{money(o.total)}</span>
                    <StatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
