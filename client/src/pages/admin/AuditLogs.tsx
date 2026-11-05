import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, DataTable, ErrorState, Input, Modal, PageHeader } from '../../components/ui';

export interface AuditRow {
  id: number;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  branch_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  ip: string | null;
  details: any;
}

const methodTone = (a: string) => (a.startsWith('DELETE') ? 'red' : a.startsWith('POST') ? 'green' : a.startsWith('PATCH') ? 'purple' : 'blue');

/** Shared audit-log table (also used by the super admin console). */
export function AuditTable({ rows, loading }: { rows: AuditRow[] | null; loading: boolean }) {
  const [selected, setSelected] = useState<AuditRow | null>(null);
  return (
    <>
      <DataTable<AuditRow>
        rows={rows}
        loading={loading}
        searchable={false}
        onRowClick={setSelected}
        columns={[
          { key: 'created_at', header: 'Time', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</span> },
          { key: 'user_name', header: 'User', render: (r) => <div><p className="font-medium text-ink-900">{r.user_name || 'System'}</p><p className="text-xs text-ink-500">{r.user_email}</p></div> },
          { key: 'branch_name', header: 'Branch', hideOnMobile: true, render: (r) => r.branch_name || '-' },
          {
            key: 'action',
            header: 'Action',
            render: (r) => {
              const [m, ...p] = r.action.split(' ');
              return (
                <span className="flex items-center gap-2">
                  <Badge tone={methodTone(r.action) as any}>{m}</Badge>
                  <span className="break-all font-mono text-xs text-ink-600">{p.join(' ')}</span>
                </span>
              );
            },
          },
          { key: 'entity', header: 'Entity', hideOnMobile: true, render: (r) => (r.entity ? `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` : '-') },
          { key: 'ip', header: 'IP', hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.ip || '-'}</span> },
        ]}
      />
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Audit entry" description={selected ? fmtDateTime(selected.created_at) : ''} size="lg" footer={<Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>}>
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="label">User</p>{selected.user_name || 'System'} <span className="text-ink-500">{selected.user_email}</span></div>
              <div><p className="label">Branch</p>{selected.branch_name || '-'}</div>
              <div className="col-span-2"><p className="label">Action</p><span className="break-all font-mono text-xs">{selected.action}</span></div>
              <div><p className="label">Entity</p>{selected.entity || '-'} {selected.entity_id && `#${selected.entity_id}`}</div>
              <div><p className="label">IP address</p>{selected.ip || '-'}</div>
            </div>
            <div>
              <p className="label">Request details</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-ink-900 p-3 text-xs text-ink-100">{selected.details ? JSON.stringify(selected.details, null, 2) : 'No payload'}</pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function AuditLogs() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error, reload } = useApi<AuditRow[]>(() => adminApi.get('/audit-logs', { q: debounced }), [debounced]);

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Every create, update and delete made by staff in this restaurant." />
      <div className="mb-3 sm:w-80">
        <Input icon={<Search className="h-4 w-4" />} placeholder="Search action, entity or user..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : <AuditTable rows={data} loading={loading} />}
    </div>
  );
}
