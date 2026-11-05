import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, FileSpreadsheet, FileText, Play } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { adminApi, downloadFile } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { addDays, compactMoney, money, toDateInput } from '../../lib/format';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, type Column } from '../../components/ui';

export interface ReportResult {
  type: string;
  title: string;
  from: string;
  to: string;
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, any>[];
  summary?: { label: string; value: number; type?: string }[];
}

export const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

export function presetRange(p: string): { from: string; to: string } | null {
  const now = new Date();
  const today = toDateInput(now);
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: toDateInput(addDays(now, -6)), to: today };
    case 'month':
      return { from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last_month':
      return { from: toDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: toDateInput(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case '90d':
      return { from: toDateInput(addDays(now, -89)), to: today };
    default:
      return null;
  }
}

const SERIES_KEY: Record<string, { x: string; y: string; label: string }> = {
  sales_daily: { x: 'day', y: 'net', label: 'Net sales' },
  revenue: { x: 'period', y: 'net', label: 'Net revenue' },
  gst: { x: 'day', y: 'total_tax', label: 'Total GST' },
};

const fmtCell = (v: any, type?: string) => (v == null || v === '' ? '-' : type === 'money' ? money(v) : String(v));

function TrendChart({ report }: { report: ReportResult }) {
  const s = SERIES_KEY[report.type];
  if (!s || report.rows.length < 2) return null;
  const data = report.rows.map((r) => ({ x: String(r[s.x]).slice(5) || r[s.x], y: Number(r[s.y] || 0) }));
  return (
    <Card title={s.label} className="mb-4">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="#e7e5e4" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#d6d3d1' }} minTickGap={12} />
            <YAxis tickFormatter={(v) => compactMoney(v)} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} width={56} />
            <Tooltip cursor={{ fill: '#fef3c7', opacity: 0.6 }} formatter={(v: any) => [money(v), s.label]} contentStyle={{ borderRadius: 10, border: '1px solid #e7e5e4', fontSize: 12 }} />
            <Bar dataKey="y" fill="#d97706" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function ReportOutput({ report, loading, error }: { report: ReportResult | null; loading: boolean; error: string | null }) {
  const columns = useMemo<Column<any>[]>(
    () =>
      (report?.columns || []).map((c) => ({
        key: c.key,
        header: c.label,
        align: c.type === 'money' ? 'right' : undefined,
        value: (r: any) => (c.type === 'money' ? Number(r[c.key] || 0) : r[c.key]),
        render: (r: any) => fmtCell(r[c.key], c.type),
      })),
    [report]
  );
  if (error) return <ErrorState error={error} />;
  if (loading && !report) return <Spinner label="Generating report..." />;
  if (!report) return <Card><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Choose a report" description="Select a report type and date range, then click Run report." /></Card>;
  return (
    <div className={loading ? 'opacity-60 transition' : ''}>
      {report.summary?.length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {report.summary.map((s) => (
            <div key={s.label} className="rounded-xl border border-ink-200 bg-white px-4 py-2 shadow-soft">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{s.label}</p>
              <p className="text-lg font-bold text-ink-900">{s.type === 'money' ? money(s.value) : s.value}</p>
            </div>
          ))}
        </div>
      ) : null}
      <TrendChart report={report} />
      <DataTable rows={report.rows.map((r, i) => ({ ...r, __i: i }))} rowKey={(r) => r.__i} columns={columns} pageSize={20} empty={<EmptyState title="No data for this period" />} />
    </div>
  );
}

/** Report type + date range + extra params form. Shared by branch and platform reports. */
export function ReportControls({
  types,
  onRun,
  onExport,
  running,
  extra,
  statusFilter = true,
}: {
  types: Record<string, string>;
  onRun: (type: string, params: Record<string, any>) => void;
  onExport: (type: string, params: Record<string, any>, format: 'xlsx' | 'pdf') => Promise<void>;
  running: boolean;
  extra?: ReactNode;
  /** show the booking-status filter (only honoured by the branch report endpoint) */
  statusFilter?: boolean;
}) {
  const showStatus = (t: string) => statusFilter && t === 'bookings';
  const [type, setType] = useState('');
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(presetRange('month')!);
  const [period, setPeriod] = useState('month');
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    if (!type && Object.keys(types).length) setType(Object.keys(types)[0]);
  }, [types, type]);

  const params = () => ({ from: range.from, to: range.to, ...(type === 'revenue' ? { period } : {}), ...(showStatus(type) && status ? { status } : {}) });
  const exp = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      await onExport(type, params(), format);
    } catch (e: any) {
      toast.error(e.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <Card className="mb-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Report" className="lg:col-span-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} options={Object.entries(types).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Period">
          <Select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              const r = presetRange(e.target.value);
              if (r) setRange(r);
            }}
            options={PRESETS}
          />
        </Field>
        <Field label="From">
          <Input type="date" value={range.from} max={range.to} onChange={(e) => (setPreset('custom'), setRange((r) => ({ ...r, from: e.target.value })))} />
        </Field>
        <Field label="To">
          <Input type="date" value={range.to} min={range.from} onChange={(e) => (setPreset('custom'), setRange((r) => ({ ...r, to: e.target.value })))} />
        </Field>
        {type === 'revenue' ? (
          <Field label="Group by">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
          </Field>
        ) : showStatus(type) ? (
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={['pending', 'confirmed', 'checked_in', 'seated', 'completed', 'cancelled', 'rejected', 'no_show'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
          </Field>
        ) : (
          extra || <div className="hidden lg:block" />
        )}
      </div>
      {(type === 'revenue' || showStatus(type)) && extra &&<div className="mt-3">{extra}</div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button icon={<Play className="h-4 w-4" />} loading={running} disabled={!type} onClick={() => onRun(type, params())}>
          Run report
        </Button>
        <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting === 'xlsx'} disabled={!type || !!exporting} onClick={() => exp('xlsx')}>
          Export Excel
        </Button>
        <Button variant="secondary" icon={<FileText className="h-4 w-4" />} loading={exporting === 'pdf'} disabled={!type || !!exporting} onClick={() => exp('pdf')}>
          Export PDF
        </Button>
      </div>
    </Card>
  );
}

export default function Reports() {
  const types = useApi<Record<string, string>>(() => adminApi.get('/reports'), []);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (type: string, params: Record<string, any>) => {
    setRunning(true);
    setError(null);
    try {
      setReport(await adminApi.get(`/reports/${type}`, params));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Sales, bookings, customers, GST, payments and inventory - export to Excel or PDF." />
      {types.error ? (
        <ErrorState error={types.error} onRetry={types.reload} />
      ) : (
        <ReportControls
          types={types.data || {}}
          running={running}
          onRun={run}
          onExport={(type, params, format) => downloadFile(`/admin/reports/${type}`, { ...params, format }, { branch: true })}
        />
      )}
      <ReportOutput report={report} loading={running} error={error} />
    </div>
  );
}
