import { useEffect, useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Button, Checkbox, DataTable, Field, ImageUpload, Input, Modal, PageHeader, Select, Switch, Textarea, useConfirm, type Column } from './ui';

export type FieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'switch' | 'date' | 'time' | 'image' | 'images' | 'weekdays' | 'password';

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string | number; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  /** span both columns in the 2-col form grid */
  full?: boolean;
  step?: string;
  min?: number;
  max?: number;
  /** numeric select values (e.g. foreign keys) */
  numeric?: boolean;
  /** only shown when creating */
  createOnly?: boolean;
  hidden?: (values: Record<string, any>) => boolean;
  /** initial value when creating a new record */
  default?: any;
}

/** Convert form state -> API payload using field types. */
export function formToPayload(fields: FieldDef[], values: Record<string, any>, isEdit: boolean) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (f.createOnly && isEdit) continue;
    if (f.hidden?.(values)) continue;
    let v = values[f.name];
    if (f.type === 'number') v = v === '' || v == null ? (f.required ? 0 : null) : Number(v);
    else if (f.type === 'select' && f.numeric) v = v === '' || v == null ? null : Number(v);
    else if (f.type === 'switch') v = !!v;
    else if (f.type === 'image') v = Array.isArray(v) ? v[0] || null : v || null;
    else if (f.type === 'images' || f.type === 'weekdays') v = Array.isArray(v) ? v : [];
    else if (f.type === 'password' && !v) continue;
    else if (typeof v === 'string') v = v.trim() === '' && !f.required ? null : v.trim();
    out[f.name] = v;
  }
  return out;
}

export function rowToForm(fields: FieldDef[], row?: Record<string, any> | null) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    let v = row?.[f.name];
    if (!row?.id && v === undefined && f.default !== undefined) v = f.default;
    if (f.type === 'switch') v = v ?? (f.name === 'is_active' || f.name === 'is_available' || f.name === 'is_public');
    else if (f.type === 'image') v = v ? [v] : [];
    else if (f.type === 'images' || f.type === 'weekdays') v = Array.isArray(v) ? v : [];
    else if (f.type === 'time') v = v ? String(v).slice(0, 5) : '';
    else if (f.type === 'date') v = v ? String(v).slice(0, 10) : '';
    else v = v ?? '';
    out[f.name] = v;
  }
  return out;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function FormFields({ fields, values, set, isEdit }: { fields: FieldDef[]; values: Record<string, any>; set: (name: string, v: any) => void; isEdit: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields
        .filter((f) => !(f.createOnly && isEdit) && !f.hidden?.(values))
        .map((f) => {
          const v = values[f.name];
          const full = f.full || ['textarea', 'images', 'image', 'weekdays'].includes(f.type || '');
          let control: ReactNode;
          switch (f.type) {
            case 'textarea':
              control = <Textarea value={v} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />;
              break;
            case 'select':
              control = <Select value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} options={f.options} placeholder={f.required ? 'Select...' : '- None -'} />;
              break;
            case 'switch':
              control = <Switch checked={!!v} onChange={(b) => set(f.name, b)} label={f.placeholder || 'Enabled'} />;
              break;
            case 'image':
              control = <ImageUpload value={v || []} onChange={(u) => set(f.name, u)} max={1} />;
              break;
            case 'images':
              control = <ImageUpload value={v || []} onChange={(u) => set(f.name, u)} max={8} label="Add" />;
              break;
            case 'weekdays':
              control = (
                <div className="flex flex-wrap gap-3">
                  {DAYS.map((d, i) => (
                    <Checkbox key={d} label={d} checked={(v || []).includes(i)} onChange={(c) => set(f.name, c ? [...(v || []), i].sort() : (v || []).filter((x: number) => x !== i))} />
                  ))}
                </div>
              );
              break;
            default:
              control = (
                <Input
                  type={f.type === 'number' ? 'number' : f.type || 'text'}
                  value={v ?? ''}
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  placeholder={f.placeholder}
                  required={f.required}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              );
          }
          return (
            <Field key={f.name} label={f.type === 'switch' ? f.label : f.label} required={f.required} hint={f.hint} className={full ? 'sm:col-span-2' : ''}>
              {control}
            </Field>
          );
        })}
    </div>
  );
}

/** Create/edit modal for a field-config driven form. */
export function EntityFormModal({ open, onClose, title, fields, initial, onSubmit, size = 'lg' }: { open: boolean; onClose: () => void; title: string; fields: FieldDef[]; initial?: Record<string, any> | null; onSubmit: (payload: Record<string, any>) => Promise<any>; size?: 'md' | 'lg' | 'xl' }) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial?.id;
  useEffect(() => {
    if (open) setValues(rowToForm(fields, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing = fields.find((f) => f.required && !(f.createOnly && isEdit) && !f.hidden?.(values) && (values[f.name] === '' || values[f.name] == null || (Array.isArray(values[f.name]) && f.type !== 'weekdays' && !values[f.name].length)));
    if (missing) return toast.error(`${missing.label} is required`);
    setSaving(true);
    try {
      await onSubmit(formToPayload(fields, values, isEdit));
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => submit()}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <FormFields fields={fields} values={values} set={(n, v) => setValues((s) => ({ ...s, [n]: v }))} isEdit={isEdit} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

interface CrudPageProps<T> {
  title: string;
  subtitle?: ReactNode;
  /** admin endpoint, e.g. '/coupons' */
  endpoint: string;
  entityName: string;
  columns: Column<T>[];
  fields: FieldDef[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  params?: Record<string, any>;
  toolbar?: ReactNode;
  headerActions?: ReactNode;
  rowActions?: (row: T, reload: () => void) => ReactNode;
  /** adjust payload before sending */
  transform?: (payload: Record<string, any>, isEdit: boolean) => Record<string, any>;
  onRowClick?: (row: T) => void;
  hideHeader?: boolean;
  /** called after a successful create/update/delete (e.g. to refresh data shown outside the table) */
  onSaved?: () => void;
}

/** Generic list + create/edit/delete page backed by an admin CRUD endpoint. */
export function CrudPage<T extends Record<string, any>>({ title, subtitle, endpoint, entityName, columns, fields, canCreate = true, canEdit = true, canDelete = true, params, toolbar, headerActions, rowActions, transform, onRowClick, hideHeader, onSaved }: CrudPageProps<T>) {
  const { data, loading, reload } = useApi<T[]>(() => adminApi.get(endpoint, params), [endpoint, JSON.stringify(params || {})]);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();

  const save = async (payload: Record<string, any>) => {
    const isEdit = !!editing?.id;
    const body = transform ? transform(payload, isEdit) : payload;
    if (isEdit) await adminApi.put(`${endpoint}/${editing!.id}`, body);
    else await adminApi.post(endpoint, body);
    toast.success(`${entityName} ${isEdit ? 'updated' : 'created'}`);
    reload();
    onSaved?.();
  };

  const del = async (row: T) => {
    const { ok } = await confirm({ title: `Delete this ${entityName.toLowerCase()}?`, message: 'This action cannot be undone.', danger: true, confirmText: 'Delete' });
    if (!ok) return;
    try {
      await adminApi.delete(`${endpoint}/${row.id}`);
      toast.success(`${entityName} deleted`);
      reload();
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const actionCol: Column<T> | null =
    canEdit || canDelete || rowActions
      ? {
          key: '_actions',
          header: '',
          sortable: false,
          align: 'right',
          render: (row) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {rowActions?.(row, reload)}
              {canEdit && (
                <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => (setEditing(row), setOpen(true))} aria-label="Edit">
                  <span className="sr-only">Edit</span>
                </Button>
              )}
              {canDelete && (
                <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del(row)} aria-label="Delete">
                  <span className="sr-only">Delete</span>
                </Button>
              )}
            </div>
          ),
        }
      : null;

  return (
    <div>
      {!hideHeader && (
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {headerActions}
              {canCreate && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => (setEditing(null), setOpen(true))}>
                  Add {entityName}
                </Button>
              )}
            </>
          }
        />
      )}
      {hideHeader && canCreate && (
        <div className="mb-3 flex justify-end gap-2">
          {headerActions}
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => (setEditing(null), setOpen(true))}>
            Add {entityName}
          </Button>
        </div>
      )}
      <DataTable rows={data} loading={loading} columns={actionCol ? [...columns, actionCol] : columns} toolbar={toolbar} onRowClick={onRowClick || (canEdit ? (r) => (setEditing(r), setOpen(true)) : undefined)} />
      <EntityFormModal open={open} onClose={() => setOpen(false)} title={editing?.id ? `Edit ${entityName}` : `New ${entityName}`} fields={fields} initial={editing} onSubmit={save} />
    </div>
  );
}
