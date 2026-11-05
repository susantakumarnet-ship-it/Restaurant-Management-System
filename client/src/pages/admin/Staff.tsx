import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, KeyRound, LogIn, LogOut, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { addDays, fmtDate, money, parseDate, titleCase, toDateInput } from '../../lib/format';
import { CrudPage, type FieldDef } from '../../components/CrudPage';
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Switch, Tabs, Textarea, useConfirm } from '../../components/ui';

interface Employee {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  position: string;
  salary: number | null;
  hire_date: string | null;
  status: string;
  address: string | null;
  user_id: number | null;
  login_email: string | null;
  login_role: string | null;
  login_active: boolean | null;
  upcoming_shifts: number;
}
interface Shift { id: number; employee_id: number; employee_name: string; position: string; shift_date: string; start_time: string; end_time: string; attendance_status: string; check_in_at: string | null; check_out_at: string | null; notes: string | null }

const POSITIONS = ['manager', 'waiter', 'chef', 'cashier', 'host', 'cleaner', 'delivery'];
const ATTENDANCE = ['scheduled', 'present', 'late', 'absent', 'leave'];
const hhmm = (t: string) => t.slice(0, 5);
const clock = (ts: string | null) => (ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null);

// ---------------- Employees ----------------
function AccountModal({ emp, onClose, onSaved }: { emp: Employee | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [f, setF] = useState({ email: '', password: '', role: 'waiter', is_active: true });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (emp) {
      const role = ['manager', 'waiter', 'chef', 'cashier'].includes(emp.login_role || '') ? emp.login_role! : ['manager', 'waiter', 'chef', 'cashier'].includes(emp.position) ? emp.position : 'waiter';
      setF({ email: emp.login_email || emp.email || '', password: '', role, is_active: emp.login_active ?? true });
    }
  }, [emp]);
  const canManager = user?.role === 'restaurant_admin' || user?.role === 'super_admin';
  const save = async () => {
    if (!emp) return;
    if (!emp.user_id && f.password.length < 8) return toast.error('Password must be at least 8 characters');
    if (f.password && f.password.length < 8) return toast.error('Password must be at least 8 characters');
    setSaving(true);
    try {
      await adminApi.post(`/employees/${emp.id}/account`, { email: f.email, role: f.role, is_active: f.is_active, ...(f.password ? { password: f.password } : {}) });
      toast.success(emp.user_id ? 'Login access updated' : 'Login account created');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={!!emp} onClose={onClose} title={`Login access - ${emp?.name || ''}`} description="Staff log in to the dashboard with these credentials." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>{emp?.user_id ? 'Update access' : 'Create login'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Login email" required className="sm:col-span-2"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={emp?.user_id ? 'New password (optional)' : 'Password'} required={!emp?.user_id} hint="Minimum 8 characters">
          <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="Role" required>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={['waiter', 'chef', 'cashier', ...(canManager ? ['manager'] : [])].map((r) => ({ value: r, label: titleCase(r) }))} />
        </Field>
        <div className="sm:col-span-2"><Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Account active" description="Inactive accounts cannot log in." /></div>
      </div>
    </Modal>
  );
}

function Employees({ onChanged }: { onChanged: () => void }) {
  const [account, setAccount] = useState<Employee | null>(null);
  const [version, setVersion] = useState(0);
  const fields: FieldDef[] = [
    { name: 'name', label: 'Full name', required: true },
    { name: 'position', label: 'Position', type: 'select', required: true, options: POSITIONS.map((p) => ({ value: p, label: titleCase(p) })) },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'salary', label: 'Monthly salary (₹)', type: 'number', min: 0 },
    { name: 'hire_date', label: 'Hire date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On leave' }, { value: 'terminated', label: 'Terminated' }], default: 'active', hint: 'Terminating disables the login account' },
    { name: 'address', label: 'Address', type: 'textarea' },
  ];
  return (
    <>
      <CrudPage<Employee>
        key={version}
        hideHeader
        title="Employees"
        endpoint="/employees"
        entityName="Employee"
        fields={fields}
        transform={(p) => ({ ...p, status: p.status || 'active' })}
        onSaved={onChanged}
        rowActions={(row) => (
          <Button size="xs" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setAccount(row)}>
            {row.user_id ? 'Access' : 'Give login'}
          </Button>
        )}
        columns={[
          { key: 'name', header: 'Name', render: (e) => <div><p className="font-medium text-ink-900">{e.name}</p><p className="text-xs text-ink-500">{e.phone || e.email || '-'}</p></div> },
          { key: 'position', header: 'Position', render: (e) => <Badge tone="blue">{titleCase(e.position)}</Badge> },
          { key: 'salary', header: 'Salary', align: 'right', hideOnMobile: true, render: (e) => (e.salary != null ? money(e.salary) : '-') },
          { key: 'hire_date', header: 'Hired', hideOnMobile: true, render: (e) => fmtDate(e.hire_date) },
          { key: 'login_email', header: 'Login', hideOnMobile: true, render: (e) => (e.login_email ? <div><p className="text-xs">{e.login_email}</p><span className="text-[11px] text-ink-500">{titleCase(e.login_role)}{e.login_active === false ? ' • disabled' : ''}</span></div> : <span className="text-xs text-ink-400">No access</span>) },
          { key: 'upcoming_shifts', header: 'Upcoming shifts', align: 'right', hideOnMobile: true },
          { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
        ]}
      />
      <AccountModal emp={account} onClose={() => setAccount(null)} onSaved={() => (setVersion((v) => v + 1), onChanged())} />
    </>
  );
}

// ---------------- Shifts ----------------
const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7)); // Monday

function ShiftModal({ open, onClose, employees, shift, defaultDate, onSaved }: { open: boolean; onClose: () => void; employees: Employee[]; shift: Shift | null; defaultDate: string; onSaved: () => void }) {
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF(shift ? { employee_id: String(shift.employee_id), shift_date: shift.shift_date, start_time: hhmm(shift.start_time), end_time: hhmm(shift.end_time), notes: shift.notes || '', attendance_status: shift.attendance_status, repeat_days: 0 } : { employee_id: '', shift_date: defaultDate, start_time: '10:00', end_time: '18:00', notes: '', attendance_status: 'scheduled', repeat_days: 0 });
  }, [open, shift, defaultDate]);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!shift && !f.employee_id) return toast.error('Select an employee');
    if (f.end_time <= f.start_time) return toast.error('End time must be after start time');
    setSaving(true);
    try {
      if (shift) await adminApi.put(`/shifts/${shift.id}`, { shift_date: f.shift_date, start_time: f.start_time, end_time: f.end_time, notes: f.notes || null, attendance_status: f.attendance_status });
      else {
        const created = await adminApi.post('/shifts', { employee_id: Number(f.employee_id), shift_date: f.shift_date, start_time: f.start_time, end_time: f.end_time, notes: f.notes || null, repeat_days: Number(f.repeat_days) || 0 });
        toast.success(`${created.length} shift(s) scheduled`);
      }
      if (shift) toast.success('Shift updated');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={shift ? `Edit shift - ${shift.employee_name}` : 'Schedule shift'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!shift && (
          <Field label="Employee" required className="sm:col-span-2">
            <Select value={f.employee_id || ''} onChange={(e) => set('employee_id', e.target.value)} placeholder="Select employee..." options={employees.filter((e) => e.status !== 'terminated').map((e) => ({ value: e.id, label: `${e.name} (${titleCase(e.position)})` }))} />
          </Field>
        )}
        <Field label="Date" required><Input type="date" value={f.shift_date || ''} onChange={(e) => set('shift_date', e.target.value)} /></Field>
        {!shift ? (
          <Field label="Repeat for next days" hint="0 = single shift"><Input type="number" min={0} max={30} value={f.repeat_days} onChange={(e) => set('repeat_days', e.target.value)} /></Field>
        ) : (
          <Field label="Attendance"><Select value={f.attendance_status} onChange={(e) => set('attendance_status', e.target.value)} options={ATTENDANCE.map((a) => ({ value: a, label: titleCase(a) }))} /></Field>
        )}
        <Field label="Start" required><Input type="time" value={f.start_time || ''} onChange={(e) => set('start_time', e.target.value)} /></Field>
        <Field label="End" required><Input type="time" value={f.end_time || ''} onChange={(e) => set('end_time', e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Shifts({ employees }: { employees: Employee[] }) {
  const [start, setStart] = useState(() => weekStart(new Date()));
  const from = toDateInput(start);
  const to = toDateInput(addDays(start, 6));
  const { data, loading, error, reload } = useApi<Shift[]>(() => adminApi.get('/shifts', { from, to }), [from]);
  const [modal, setModal] = useState<{ open: boolean; shift: Shift | null; date: string }>({ open: false, shift: null, date: toDateInput() });
  const [busy, setBusy] = useState<number | null>(null);
  const confirm = useConfirm();
  const days = useMemo(() => [...Array(7)].map((_, i) => toDateInput(addDays(start, i))), [start]);
  const today = toDateInput();

  const act = async (s: Shift, fn: () => Promise<any>, msg: string) => {
    setBusy(s.id);
    try {
      await fn();
      toast.success(msg);
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const del = async (s: Shift) => {
    if (!(await confirm({ title: 'Delete this shift?', message: `${s.employee_name} on ${fmtDate(s.shift_date)}`, danger: true, confirmText: 'Delete' })).ok) return;
    act(s, () => adminApi.delete(`/shifts/${s.id}`), 'Shift deleted');
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setStart(addDays(start, -7))} aria-label="Previous week" />
        <Input type="date" className="w-40" value={from} onChange={(e) => e.target.value && setStart(weekStart(parseDate(e.target.value)))} aria-label="Week of" />
        <Button variant="secondary" size="sm" icon={<ChevronRight className="h-4 w-4" />} onClick={() => setStart(addDays(start, 7))} aria-label="Next week" />
        <Button variant="ghost" size="sm" onClick={() => setStart(weekStart(new Date()))}>This week</Button>
        <span className="text-sm text-ink-500">{fmtDate(from)} - {fmtDate(to)}</span>
        <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, shift: null, date: from < today && to >= today ? today : from })}>Schedule shift</Button>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((d) => {
            const list = (data || []).filter((s) => s.shift_date === d);
            return (
              <div key={d} className={`card flex flex-col p-3 ${d === today ? 'ring-2 ring-brand-500' : ''}`}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">{parseDate(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                  <button className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" onClick={() => setModal({ open: true, shift: null, date: d })} aria-label="Add shift"><Plus className="h-4 w-4" /></button>
                </div>
                <div className="space-y-2">
                  {list.length === 0 && <p className="py-3 text-center text-xs text-ink-400">No shifts</p>}
                  {list.map((s) => (
                    <div key={s.id} className="rounded-lg border border-ink-100 bg-ink-50/60 p-2 text-xs">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-900">{s.employee_name}</p>
                          <p className="text-ink-500">{titleCase(s.position)} • {hhmm(s.start_time)}-{hhmm(s.end_time)}</p>
                        </div>
                        <StatusBadge status={s.attendance_status} />
                      </div>
                      {(s.check_in_at || s.check_out_at) && <p className="mt-1 text-ink-500">In {clock(s.check_in_at) || '-'} • Out {clock(s.check_out_at) || '-'}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {!s.check_in_at && <Button size="xs" variant="success" loading={busy === s.id} icon={<LogIn className="h-3 w-3" />} onClick={() => act(s, () => adminApi.post(`/shifts/${s.id}/check-in`), `${s.employee_name} checked in`)}>In</Button>}
                        {s.check_in_at && !s.check_out_at && <Button size="xs" variant="dark" loading={busy === s.id} icon={<LogOut className="h-3 w-3" />} onClick={() => act(s, () => adminApi.post(`/shifts/${s.id}/check-out`), `${s.employee_name} checked out`)}>Out</Button>}
                        {!s.check_in_at && s.attendance_status === 'scheduled' && d <= today && (
                          <Button size="xs" variant="ghost" className="text-red-600" disabled={busy === s.id} onClick={() => act(s, () => adminApi.put(`/shifts/${s.id}`, { attendance_status: 'absent' }), 'Marked absent')}>Absent</Button>
                        )}
                        <button className="ml-auto rounded p-1 text-ink-400 hover:bg-white hover:text-ink-700" onClick={() => setModal({ open: true, shift: s, date: d })} aria-label="Edit shift"><Pencil className="h-3 w-3" /></button>
                        <button className="rounded p-1 text-ink-400 hover:bg-white hover:text-red-600" onClick={() => del(s)} aria-label="Delete shift"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ShiftModal open={modal.open} onClose={() => setModal((m) => ({ ...m, open: false }))} employees={employees} shift={modal.shift} defaultDate={modal.date} onSaved={reload} />
    </div>
  );
}

// ---------------- Attendance summary ----------------
function Attendance() {
  const [range, setRange] = useState({ from: toDateInput(addDays(new Date(), -29)), to: toDateInput() });
  const { data, loading, error, reload } = useApi<any[]>(() => adminApi.get('/attendance/summary', range), [range.from, range.to]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data}
      loading={loading}
      toolbar={
        <>
          <Input type="date" className="w-40" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
          <Input type="date" className="w-40" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
        </>
      }
      columns={[
        { key: 'name', header: 'Employee', render: (r: any) => <div><p className="font-medium text-ink-900">{r.name}</p><p className="text-xs text-ink-500">{titleCase(r.position)}</p></div> },
        { key: 'shifts', header: 'Shifts', align: 'right' },
        { key: 'present', header: 'Present', align: 'right', render: (r: any) => <span className="text-emerald-700">{r.present}</span> },
        { key: 'late', header: 'Late', align: 'right', render: (r: any) => <span className="text-amber-700">{r.late}</span> },
        { key: 'absent', header: 'Absent', align: 'right', render: (r: any) => <span className="text-red-700">{r.absent}</span> },
        { key: 'leave', header: 'Leave', align: 'right', hideOnMobile: true },
        { key: 'hours', header: 'Hours', align: 'right', render: (r: any) => Number(r.hours).toFixed(1) },
        {
          key: 'rate',
          header: 'Attendance',
          align: 'right',
          value: (r: any) => (r.present + r.late + r.absent ? (r.present + r.late) / (r.present + r.late + r.absent) : 0),
          render: (r: any) => {
            const tot = r.present + r.late + r.absent;
            return tot ? `${Math.round(((r.present + r.late) / tot) * 100)}%` : '-';
          },
        },
      ]}
    />
  );
}

// ---------------- Roles & permissions ----------------
interface RoleRow { id: number; name: string; display_name: string; permissions: string[] }
function Roles() {
  const { hasPerm, user } = useAuth();
  const { data, loading, error, reload } = useApi<{ roles: RoleRow[]; permissions: { code: string; module: string; description: string }[] }>(() => adminApi.get('/roles'), []);
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  const [saving, setSaving] = useState<number | null>(null);
  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.roles.map((r) => [r.id, [...r.permissions]])));
  }, [data]);
  const modules = useMemo(() => {
    const m: Record<string, { code: string; description: string }[]> = {};
    (data?.permissions || []).forEach((p) => (m[p.module] ||= []).push(p));
    return m;
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const canEdit = (r: RoleRow) => hasPerm('roles.manage') && (r.name !== 'restaurant_admin' || user?.role === 'super_admin');
  const dirty = (r: RoleRow) => JSON.stringify([...(draft[r.id] || [])].sort()) !== JSON.stringify([...r.permissions].sort());
  const toggle = (r: RoleRow, code: string, on: boolean) => setDraft((d) => ({ ...d, [r.id]: on ? [...(d[r.id] || []), code] : (d[r.id] || []).filter((c) => c !== code) }));
  const save = async (r: RoleRow) => {
    setSaving(r.id);
    try {
      await adminApi.put(`/roles/${r.id}/permissions`, { permissions: draft[r.id] || [] });
      toast.success(`${r.display_name} permissions saved`);
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card padded={false}>
      {!hasPerm('roles.manage') && <p className="border-b border-ink-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">You can view permissions but need the "roles.manage" permission to change them.</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-ink-50">
            <tr>
              <th className="sticky left-0 z-10 bg-ink-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Permission</th>
              {data.roles.map((r) => (
                <th key={r.id} className="px-3 py-3 text-center text-xs font-semibold text-ink-700">
                  <div>{r.display_name}</div>
                  {canEdit(r) && (
                    <Button size="xs" className="mt-1" variant={dirty(r) ? 'primary' : 'ghost'} disabled={!dirty(r)} loading={saving === r.id} icon={<Save className="h-3 w-3" />} onClick={() => save(r)}>
                      Save
                    </Button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(modules).map(([mod, perms]) => (
              <Fragment key={mod}>
                <tr className="bg-ink-100/60">
                  <td colSpan={data.roles.length + 1} className="sticky left-0 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-ink-500">{mod}</td>
                </tr>
                {perms.map((p) => (
                  <tr key={p.code} className="border-t border-ink-100">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <p className="font-mono text-xs text-ink-800">{p.code}</p>
                      <p className="text-xs text-ink-500">{p.description}</p>
                    </td>
                    {data.roles.map((r) => (
                      <td key={r.id} className="px-3 py-2 text-center">
                        {canEdit(r) ? (
                          <Checkbox checked={(draft[r.id] || []).includes(p.code)} onChange={(on) => toggle(r, p.code, on)} />
                        ) : (
                          <span className={(draft[r.id] || []).includes(p.code) ? 'text-emerald-600' : 'text-ink-300'}>{(draft[r.id] || []).includes(p.code) ? '✓' : '–'}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Staff() {
  const [tab, setTab] = useState<'employees' | 'shifts' | 'attendance' | 'roles'>('employees');
  const employees = useApi<Employee[]>(() => adminApi.get('/employees'), [tab]);
  return (
    <div>
      <PageHeader title="Staff" subtitle="Employees, login access, shift scheduling, attendance and role permissions." />
      <Tabs
        className="mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'employees', label: 'Employees', count: employees.data?.length },
          { value: 'shifts', label: 'Shifts' },
          { value: 'attendance', label: 'Attendance' },
          { value: 'roles', label: 'Roles & permissions' },
        ]}
      />
      {tab === 'employees' && <Employees onChanged={employees.reload} />}
      {tab === 'shifts' && (employees.data ? <Shifts employees={employees.data} /> : employees.error ? <ErrorState error={employees.error} onRetry={employees.reload} /> : <Spinner />)}
      {tab === 'attendance' && <Attendance />}
      {tab === 'roles' && <Roles />}
    </div>
  );
}
