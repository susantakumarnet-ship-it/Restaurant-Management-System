import { describe, expect, it } from 'vitest';
import { compactMoney, fmtTime, money, parseDate, titleCase, toDateInput, addDays } from './format';
import { formToPayload, rowToForm, type FieldDef } from '../components/CrudPage';

describe('format helpers', () => {
  it('formats rupees', () => {
    expect(money(1234)).toBe('₹1,234');
    expect(money(99.5)).toBe('₹99.50');
    expect(compactMoney(250000)).toBe('₹2.5L');
    expect(compactMoney(1500)).toBe('₹1.5k');
  });
  it('formats local reservation times without timezone shifts', () => {
    expect(fmtTime('2026-11-06T19:30:00')).toBe('7:30 PM');
    expect(fmtTime('12:00')).toBe('12:00 PM');
    expect(fmtTime('00:15')).toBe('12:15 AM');
  });
  it('parses YYYY-MM-DD as a local date', () => {
    const d = parseDate('2026-01-31');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 31]);
    expect(toDateInput(addDays(d, 1))).toBe('2026-02-01');
  });
  it('title-cases enum values', () => {
    expect(titleCase('checked_in')).toBe('Checked In');
  });
});

describe('CRUD form mapping', () => {
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', required: true },
    { name: 'capacity', label: 'Capacity', type: 'number', required: true },
    { name: 'min', label: 'Min', type: 'number' },
    { name: 'section_id', label: 'Section', type: 'select', numeric: true },
    { name: 'is_active', label: 'Active', type: 'switch' },
    { name: 'logo', label: 'Logo', type: 'image' },
    { name: 'opening_time', label: 'Opens', type: 'time' },
    { name: 'password', label: 'Password', type: 'password' },
  ];
  it('converts form strings into typed API payloads', () => {
    const p = formToPayload(fields, { name: ' T1 ', capacity: '4', min: '', section_id: '3', is_active: true, logo: ['/uploads/a.png'], opening_time: '11:00', password: '' }, false);
    expect(p).toEqual({ name: 'T1', capacity: 4, min: null, section_id: 3, is_active: true, logo: '/uploads/a.png', opening_time: '11:00' });
  });
  it('hydrates form state from API rows', () => {
    const f = rowToForm(fields, { name: 'T1', capacity: 4, min: null, section_id: 3, logo: '/x.png', opening_time: '11:00:00' });
    expect(f.logo).toEqual(['/x.png']);
    expect(f.opening_time).toBe('11:00');
    expect(f.min).toBe('');
    expect(f.is_active).toBe(true);
  });
  it('applies defaults only when creating', () => {
    const defs: FieldDef[] = [{ name: 'status', label: 'Status', type: 'select', default: 'available' }];
    expect(rowToForm(defs, null).status).toBe('available');
    expect(rowToForm(defs, { id: 1, status: 'maintenance' }).status).toBe('maintenance');
  });
});
