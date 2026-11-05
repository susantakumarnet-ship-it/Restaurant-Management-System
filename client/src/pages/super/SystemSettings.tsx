import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { Button, Card, ErrorState, Field, Input, PageHeader, Spinner, Switch } from '../../components/ui';
import { AuditTable, type AuditRow } from '../admin/AuditLogs';

const KNOWN = ['platform_name', 'support_email', 'default_currency', 'maintenance_mode'];

export default function SystemSettings() {
  const { data, loading, error, reload } = useApi<Record<string, any>>(() => api.get('/super/settings'), []);
  const audit = useApi<AuditRow[]>(() => api.get('/super/audit-logs'), []);
  const [values, setValues] = useState<Record<string, any>>({});
  // isString: stored value is a JSON string -> send the text back as-is (so "123" or "true" don't silently become number/boolean)
  const [custom, setCustom] = useState<{ key: string; value: string; isString?: boolean }[]>([]);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setValues({ platform_name: data.platform_name ?? '', support_email: data.support_email ?? '', default_currency: data.default_currency ?? 'INR', maintenance_mode: !!data.maintenance_mode });
    setCustom(Object.entries(data).filter(([k]) => !KNOWN.includes(k)).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value), isString: typeof value === 'string' })));
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;

  const parse = (v: string) => {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const save = async () => {
    const body: Record<string, any> = { ...values };
    for (const c of custom) if (c.key.trim()) body[c.key.trim()] = c.isString ? c.value : parse(c.value);
    setSaving(true);
    try {
      await api.put('/super/settings', body);
      toast.success('System settings saved');
      reload();
      audit.reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  const addKey = () => {
    const k = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!k) return;
    if (KNOWN.includes(k) || custom.some((c) => c.key === k)) return toast.error('This key already exists');
    setCustom([...custom, { key: k, value: '' }]);
    setNewKey('');
  };

  return (
    <div>
      <PageHeader title="System Settings" subtitle="Platform-wide configuration." actions={<Button loading={saving} icon={<Save className="h-4 w-4" />} onClick={save}>Save settings</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="General">
          <div className="space-y-4">
            <Field label="Platform name"><Input value={values.platform_name} onChange={(e) => setValues({ ...values, platform_name: e.target.value })} /></Field>
            <Field label="Support email"><Input type="email" value={values.support_email} onChange={(e) => setValues({ ...values, support_email: e.target.value })} /></Field>
            <Field label="Default currency"><Input maxLength={3} value={values.default_currency} onChange={(e) => setValues({ ...values, default_currency: e.target.value.toUpperCase() })} /></Field>
            <Switch checked={!!values.maintenance_mode} onChange={(v) => setValues({ ...values, maintenance_mode: v })} label="Maintenance mode" description="Flag for showing a maintenance notice across portals." />
          </div>
        </Card>
        <Card title="Custom keys">
          <div className="space-y-3">
            {custom.length === 0 && <p className="text-sm text-ink-500">No custom settings yet.</p>}
            {custom.map((c, i) => (
              <div key={c.key} className="flex items-end gap-2">
                <Field label={c.key} className="flex-1" hint="Text or JSON value">
                  <Input value={c.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                </Field>
                <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label="Remove key" title="Removed from this form; existing value stays stored" />
              </div>
            ))}
            <div className="flex gap-2 border-t border-ink-100 pt-3">
              <Input placeholder="new_setting_key" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKey()} />
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addKey}>Add</Button>
            </div>
          </div>
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Platform audit log</h2>
      {audit.error ? <ErrorState error={audit.error} onRetry={audit.reload} /> : <AuditTable rows={audit.data} loading={audit.loading} />}
    </div>
  );
}
