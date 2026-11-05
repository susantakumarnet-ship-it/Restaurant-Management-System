import ExcelJS from 'exceljs';
import { db, TIMEZONE } from '../db/index.js';
import { badRequest } from '../utils/http.js';
import { localDate, localIso, parseLocal, round2 } from '../utils/common.js';
import { tablePdf } from './pdf.js';

const sum = (rows, k) => round2(rows.reduce((s, r) => s + Number(r[k] || 0), 0));

// ---- date helpers (restaurant-local days, like PostgreSQL `ts::date` in the session time zone) ----
const nextDay = (s) => {
  const d = parseLocal(s);
  d.setDate(d.getDate() + 1);
  return d;
};
/** TIMESTAMPTZ filter equivalent to `col::date BETWEEN from AND to`. */
const dateRange = (from, to) => ({ $gte: parseLocal(from), $lt: nextDay(to) });
const localDay = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TIMEZONE } });
/** 'YYYY-MM-DD' + n days (pure calendar arithmetic). */
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** to_char(ts, 'YYYY-MM-DD HH24:MI') in local time. */
const localMinute = (d) => (d ? localIso(new Date(d)).slice(0, 16).replace('T', ' ') : null);
const roundKeys = (row, keys) => {
  for (const k of keys) row[k] = round2(row[k] || 0);
  return row;
};

/**
 * Report definitions. Each returns { title, columns, rows, summary }.
 * `branchIds` lets the same report run for a single branch or consolidated (super admin).
 */
const REPORTS = {
  sales_daily: {
    title: 'Daily Sales Report',
    async run({ branchIds, from, to }) {
      const grouped = await db.aggregate('orders', [
        { $match: { branch_id: { $in: branchIds }, status: { $ne: 'cancelled' }, created_at: dateRange(from, to) } },
        {
          $group: {
            _id: localDay('$created_at'),
            orders: { $sum: 1 },
            gross: { $sum: '$subtotal' },
            discount: { $sum: '$discount' },
            tax: { $sum: '$tax' },
            charges: { $sum: { $add: ['$service_charge', '$delivery_charge'] } },
            net: { $sum: '$total' },
            collected: { $sum: '$amount_paid' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      const rows = grouped.map((g) =>
        roundKeys(
          { day: g._id, orders: g.orders, gross: g.gross, discount: g.discount, tax: g.tax, charges: g.charges, net: g.net, collected: g.collected },
          ['gross', 'discount', 'tax', 'charges', 'net', 'collected']
        )
      );
      return {
        columns: [
          { key: 'day', label: 'Date' }, { key: 'orders', label: 'Orders' }, { key: 'gross', label: 'Gross', type: 'money' },
          { key: 'discount', label: 'Discount', type: 'money' }, { key: 'tax', label: 'GST', type: 'money' },
          { key: 'charges', label: 'Charges', type: 'money' }, { key: 'net', label: 'Net Sales', type: 'money' },
          { key: 'collected', label: 'Collected', type: 'money' },
        ],
        rows,
        summary: [
          { label: 'Orders', value: sum(rows, 'orders') },
          { label: 'Net sales', value: sum(rows, 'net'), type: 'money' },
          { label: 'Collected', value: sum(rows, 'collected'), type: 'money' },
        ],
      };
    },
  },
  revenue: {
    title: 'Revenue Report (Weekly / Monthly)',
    async run({ branchIds, from, to, period = 'month' }) {
      const unit = period === 'week' ? 'week' : 'month';
      // ISO week (IYYY-"W"IW) or calendar month; both formats sort chronologically as strings.
      const format = unit === 'week' ? '%G-W%V' : '%Y-%m';
      const grouped = await db.aggregate('payments', [
        { $match: { branch_id: { $in: branchIds }, status: { $in: ['success', 'refunded', 'partially_refunded'] }, created_at: dateRange(from, to) } },
        {
          $group: {
            _id: { $dateToString: { format, date: '$created_at', timezone: TIMEZONE } },
            order_payments: { $sum: { $cond: [{ $eq: ['$purpose', 'order'] }, 1, 0] } },
            advance_payments: { $sum: { $cond: [{ $eq: ['$purpose', 'advance'] }, 1, 0] } },
            received: { $sum: '$amount' },
            refunded: { $sum: '$refunded_amount' },
            net: { $sum: { $subtract: ['$amount', '$refunded_amount'] } },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      const rows = grouped.map((g) =>
        roundKeys(
          { period: g._id, order_payments: g.order_payments, advance_payments: g.advance_payments, received: g.received, refunded: g.refunded, net: g.net },
          ['received', 'refunded', 'net']
        )
      );
      return {
        columns: [
          { key: 'period', label: unit === 'week' ? 'Week' : 'Month' }, { key: 'order_payments', label: 'Order Payments' },
          { key: 'advance_payments', label: 'Advance Payments' }, { key: 'received', label: 'Received', type: 'money' },
          { key: 'refunded', label: 'Refunded', type: 'money' }, { key: 'net', label: 'Net Revenue', type: 'money' },
        ],
        rows,
        summary: [{ label: 'Net revenue', value: sum(rows, 'net'), type: 'money' }, { label: 'Refunded', value: sum(rows, 'refunded'), type: 'money' }],
      };
    },
  },
  bookings: {
    title: 'Booking Report',
    async run({ branchIds, from, to, status }) {
      const filter = { branch_id: { $in: branchIds }, booking_date: { $gte: from, $lte: to } };
      if (status) filter.status = status;
      const resv = await db.find('reservations', filter, { sort: { start_at: 1 } });
      const links = resv.length ? await db.find('reservation_tables', { reservation_id: { $in: resv.map((x) => x.id) } }, { projection: { reservation_id: 1, table_id: 1 } }) : [];
      const tables = await db.mapByIds('tables', links.map((l) => l.table_id), { projection: { table_number: 1 } });
      const tablesBy = new Map();
      for (const l of links) {
        const t = tables.get(l.table_id);
        if (!t) continue;
        if (!tablesBy.has(l.reservation_id)) tablesBy.set(l.reservation_id, []);
        tablesBy.get(l.reservation_id).push(t.table_number);
      }
      const rows = resv.map((r) => ({
        booking_code: r.booking_code,
        date: r.booking_date,
        time: r.start_at ? String(r.start_at).slice(11, 16) : null,
        customer_name: r.customer_name,
        phone: r.phone,
        guests: r.guests,
        status: r.status,
        source: r.source,
        occasion: r.occasion,
        tables: (tablesBy.get(r.id) || []).join(', '),
        advance_amount: r.advance_amount,
        payment_status: r.payment_status,
      }));
      const by = (s) => rows.filter((r) => r.status === s).length;
      return {
        columns: [
          { key: 'booking_code', label: 'Booking ID' }, { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' },
          { key: 'customer_name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'guests', label: 'Guests' },
          { key: 'tables', label: 'Tables' }, { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' },
          { key: 'advance_amount', label: 'Advance', type: 'money' },
        ],
        rows,
        summary: [
          { label: 'Total', value: rows.length }, { label: 'Confirmed', value: by('confirmed') }, { label: 'Completed', value: by('completed') },
          { label: 'Cancelled', value: by('cancelled') }, { label: 'No-show', value: by('no_show') }, { label: 'Guests', value: sum(rows, 'guests') },
        ],
      };
    },
  },
  cancelled_bookings: {
    title: 'Cancelled & Rejected Bookings',
    async run({ branchIds, from, to }) {
      const resv = await db.find(
        'reservations',
        { branch_id: { $in: branchIds }, status: { $in: ['cancelled', 'rejected', 'no_show'] }, booking_date: { $gte: from, $lte: to } },
        { sort: { booking_date: -1 } }
      );
      const rows = resv.map((r) => ({
        booking_code: r.booking_code,
        date: r.booking_date,
        time: r.start_at ? String(r.start_at).slice(11, 16) : null,
        customer_name: r.customer_name,
        phone: r.phone,
        guests: r.guests,
        status: r.status,
        reason: r.cancel_reason ?? r.admin_notes ?? '',
        cancelled_at: localMinute(r.cancelled_at),
        payment_status: r.payment_status,
      }));
      return {
        columns: [
          { key: 'booking_code', label: 'Booking ID' }, { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' },
          { key: 'customer_name', label: 'Customer' }, { key: 'guests', label: 'Guests' }, { key: 'status', label: 'Status' },
          { key: 'reason', label: 'Reason' }, { key: 'cancelled_at', label: 'Cancelled At' }, { key: 'payment_status', label: 'Payment' },
        ],
        rows,
        summary: [{ label: 'Total', value: rows.length }],
      };
    },
  },
  customers: {
    title: 'Customer Report',
    async run({ branchIds, from, to }) {
      const scope = { branch_id: { $in: branchIds }, customer_id: { $ne: null } };
      const [rc, oc] = await Promise.all([db.distinct('reservations', 'customer_id', scope), db.distinct('orders', 'customer_id', scope)]);
      const ids = [...new Set([...rc, ...oc])];
      const customers = ids.length ? await db.find('customers', { id: { $in: ids } }) : [];
      const [users, bk, od] = await Promise.all([
        db.mapByIds('users', customers.map((c) => c.user_id), { projection: { name: 1, email: 1, phone: 1 } }),
        db.aggregate('reservations', [
          { $match: { customer_id: { $in: ids }, branch_id: { $in: branchIds }, booking_date: { $gte: from, $lte: to } } },
          { $group: { _id: '$customer_id', n: { $sum: 1 } } },
        ]),
        db.aggregate('orders', [
          { $match: { customer_id: { $in: ids }, branch_id: { $in: branchIds }, status: { $ne: 'cancelled' }, created_at: dateRange(from, to) } },
          { $group: { _id: '$customer_id', n: { $sum: 1 }, spent: { $sum: '$total' } } },
        ]),
      ]);
      const bookingsBy = new Map(bk.map((x) => [x._id, x.n]));
      const ordersBy = new Map(od.map((x) => [x._id, x]));
      const rows = customers
        .filter((c) => users.has(c.user_id))
        .map((c) => {
          const u = users.get(c.user_id);
          const o = ordersBy.get(c.id);
          return {
            name: u.name,
            email: u.email,
            phone: u.phone ?? null,
            loyalty_points: c.loyalty_points,
            status: c.status,
            bookings: bookingsBy.get(c.id) || 0,
            orders: o?.n || 0,
            spent: round2(o?.spent || 0),
            joined: c.created_at ? localDate(new Date(c.created_at)) : null,
          };
        })
        .sort((a, b) => b.spent - a.spent);
      return {
        columns: [
          { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
          { key: 'bookings', label: 'Bookings' }, { key: 'orders', label: 'Orders' }, { key: 'spent', label: 'Spent', type: 'money' },
          { key: 'loyalty_points', label: 'Points' }, { key: 'status', label: 'Status' }, { key: 'joined', label: 'Joined' },
        ],
        rows,
        summary: [{ label: 'Customers', value: rows.length }, { label: 'Total spent', value: sum(rows, 'spent'), type: 'money' }],
      };
    },
  },
  food_sales: {
    title: 'Food Sales Report',
    async run({ branchIds, from, to }) {
      // Group by (item name, food item) in MongoDB, then fold food items into their category name.
      const grouped = await db.aggregate('orders', [
        { $match: { branch_id: { $in: branchIds }, status: { $ne: 'cancelled' }, created_at: dateRange(from, to) } },
        { $project: { _id: 0, id: 1 } },
        { $lookup: { from: 'order_items', localField: 'id', foreignField: 'order_id', as: 'oi' } },
        { $unwind: '$oi' },
        {
          $group: {
            _id: { name: '$oi.name', food_item_id: '$oi.food_item_id' },
            quantity: { $sum: '$oi.quantity' },
            revenue: { $sum: '$oi.line_total' },
            orders: { $addToSet: '$oi.order_id' },
          },
        },
      ]);
      const foods = await db.mapByIds('food_items', grouped.map((g) => g._id.food_item_id), { projection: { category_id: 1 } });
      const cats = await db.mapByIds('food_categories', [...foods.values()].map((f) => f.category_id), { projection: { name: 1 } });
      const acc = new Map();
      for (const g of grouped) {
        const catName = cats.get(foods.get(g._id.food_item_id)?.category_id)?.name ?? null;
        const key = JSON.stringify([g._id.name, catName]);
        if (!acc.has(key)) acc.set(key, { item: g._id.name, category: catName ?? '-', quantity: 0, revenue: 0, orders: new Set() });
        const a = acc.get(key);
        a.quantity += Number(g.quantity || 0);
        a.revenue += Number(g.revenue || 0);
        for (const id of g.orders) a.orders.add(id);
      }
      const rows = [...acc.values()]
        .map((a) => ({ item: a.item, category: a.category, quantity: round2(a.quantity), revenue: round2(a.revenue), orders: a.orders.size }))
        .sort((a, b) => b.revenue - a.revenue);
      return {
        columns: [
          { key: 'item', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'quantity', label: 'Qty Sold' },
          { key: 'orders', label: 'Orders' }, { key: 'revenue', label: 'Revenue', type: 'money' },
        ],
        rows,
        summary: [{ label: 'Items sold', value: sum(rows, 'quantity') }, { label: 'Revenue', value: sum(rows, 'revenue'), type: 'money' }],
      };
    },
  },
  payments: {
    title: 'Payment Report',
    async run({ branchIds, from, to }) {
      const pays = await db.find('payments', { branch_id: { $in: branchIds }, created_at: dateRange(from, to) }, { sort: { created_at: -1 } });
      const [orders, resv] = await Promise.all([
        db.mapByIds('orders', pays.map((p) => p.order_id), { projection: { order_code: 1 } }),
        db.mapByIds('reservations', pays.map((p) => p.reservation_id), { projection: { booking_code: 1 } }),
      ]);
      const rows = pays.map((p) => ({
        payment_code: p.payment_code,
        date: localMinute(p.created_at),
        method: p.method,
        purpose: p.purpose,
        status: p.status,
        reference: orders.get(p.order_id)?.order_code ?? resv.get(p.reservation_id)?.booking_code ?? null,
        amount: p.amount,
        refunded_amount: p.refunded_amount,
        gateway: p.gateway ?? null,
        gateway_ref: p.gateway_payment_id ?? '',
      }));
      const ok = rows.filter((r) => ['success', 'refunded', 'partially_refunded'].includes(r.status));
      const byMethod = ['cash', 'upi', 'card', 'online'].map((m) => ({ label: m.toUpperCase(), value: sum(ok.filter((r) => r.method === m), 'amount'), type: 'money' }));
      return {
        columns: [
          { key: 'payment_code', label: 'Txn ID' }, { key: 'date', label: 'Date' }, { key: 'reference', label: 'Reference' },
          { key: 'method', label: 'Method' }, { key: 'purpose', label: 'Purpose' }, { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount', type: 'money' }, { key: 'refunded_amount', label: 'Refunded', type: 'money' },
          { key: 'gateway_ref', label: 'Gateway Ref' },
        ],
        rows,
        summary: [...byMethod, { label: 'Refunded', value: sum(rows, 'refunded_amount'), type: 'money' }],
      };
    },
  },
  gst: {
    title: 'GST Report',
    async run({ branchIds, from, to }) {
      const grouped = await db.aggregate('invoices', [
        { $match: { branch_id: { $in: branchIds }, issued_at: dateRange(from, to) } },
        {
          $group: {
            _id: localDay('$issued_at'),
            invoices: { $sum: 1 },
            taxable: { $sum: { $add: [{ $subtract: ['$subtotal', '$discount'] }, '$service_charge'] } },
            cgst: { $sum: '$cgst' },
            sgst: { $sum: '$sgst' },
            total_tax: { $sum: { $add: ['$cgst', '$sgst'] } },
            invoice_value: { $sum: '$total' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      const rows = grouped.map((g) =>
        roundKeys(
          { day: g._id, invoices: g.invoices, taxable: g.taxable, cgst: g.cgst, sgst: g.sgst, total_tax: g.total_tax, invoice_value: g.invoice_value },
          ['taxable', 'cgst', 'sgst', 'total_tax', 'invoice_value']
        )
      );
      return {
        columns: [
          { key: 'day', label: 'Date' }, { key: 'invoices', label: 'Invoices' }, { key: 'taxable', label: 'Taxable Value', type: 'money' },
          { key: 'cgst', label: 'CGST', type: 'money' }, { key: 'sgst', label: 'SGST', type: 'money' },
          { key: 'total_tax', label: 'Total GST', type: 'money' }, { key: 'invoice_value', label: 'Invoice Value', type: 'money' },
        ],
        rows,
        summary: [
          { label: 'Taxable', value: sum(rows, 'taxable'), type: 'money' }, { label: 'CGST', value: sum(rows, 'cgst'), type: 'money' },
          { label: 'SGST', value: sum(rows, 'sgst'), type: 'money' }, { label: 'Total GST', value: sum(rows, 'total_tax'), type: 'money' },
        ],
      };
    },
  },
  inventory: {
    title: 'Inventory Report',
    async run({ branchIds, from, to }) {
      const items = await db.find('inventory_items', { branch_id: { $in: branchIds }, is_active: true });
      const [suppliers, moves] = await Promise.all([
        db.mapByIds('suppliers', items.map((i) => i.supplier_id), { projection: { name: 1 } }),
        items.length
          ? db.aggregate('inventory_transactions', [
              { $match: { inventory_item_id: { $in: items.map((i) => i.id) }, type: { $in: ['stock_in', 'stock_out', 'wastage'] }, created_at: dateRange(from, to) } },
              {
                $group: {
                  _id: '$inventory_item_id',
                  stock_in: { $sum: { $cond: [{ $eq: ['$type', 'stock_in'] }, '$quantity', 0] } },
                  used: { $sum: { $cond: [{ $in: ['$type', ['stock_out', 'wastage']] }, '$quantity', 0] } },
                },
              },
            ])
          : [],
      ]);
      const movesBy = new Map(moves.map((m) => [m._id, m]));
      const soon = addDays(localDate(), 7);
      const rows = items
        .map((i) => {
          const q = Number(i.quantity || 0);
          const min = Number(i.min_quantity || 0);
          const m = movesBy.get(i.id);
          return {
            name: i.name,
            category: i.category ?? '',
            unit: i.unit,
            quantity: i.quantity,
            min_quantity: i.min_quantity,
            cost_per_unit: i.cost_per_unit,
            stock_value: round2(q * Number(i.cost_per_unit || 0)),
            supplier: suppliers.get(i.supplier_id)?.name ?? '',
            expiry_date: i.expiry_date ?? '',
            stock_in: round2(m?.stock_in || 0),
            used: round2(m?.used || 0),
            stock_status: q <= min ? 'LOW' : i.expiry_date && i.expiry_date <= soon ? 'EXPIRING' : 'OK',
          };
        })
        .sort((a, b) => (a.stock_status === b.stock_status ? String(a.name).localeCompare(String(b.name)) : a.stock_status < b.stock_status ? -1 : 1));
      return {
        columns: [
          { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'quantity', label: 'In Stock' },
          { key: 'unit', label: 'Unit' }, { key: 'min_quantity', label: 'Min Level' }, { key: 'stock_in', label: 'Stock In' },
          { key: 'used', label: 'Used' }, { key: 'stock_value', label: 'Value', type: 'money' }, { key: 'expiry_date', label: 'Expiry' },
          { key: 'stock_status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Items', value: rows.length }, { label: 'Low stock', value: rows.filter((r) => r.stock_status === 'LOW').length },
          { label: 'Stock value', value: sum(rows, 'stock_value'), type: 'money' },
        ],
      };
    },
  },
};

export const REPORT_TYPES = Object.fromEntries(Object.entries(REPORTS).map(([k, v]) => [k, v.title]));

export async function runReport(type, params) {
  const def = REPORTS[type];
  if (!def) throw badRequest('Unknown report type');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!isDate(params.from) || !isDate(params.to)) throw badRequest('from and to dates are required (YYYY-MM-DD)');
  if (params.from > params.to) throw badRequest('"from" must be before "to"');
  const out = await def.run(params);
  return { type, title: def.title, from: params.from, to: params.to, ...out };
}

export async function sendReport(res, report, format, scopeLabel) {
  const filename = `${report.type}_${report.from}_${report.to}`;
  if (format === 'pdf') {
    return tablePdf(res, { ...report, subtitle: `${scopeLabel} | ${report.from} to ${report.to}`, filename });
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Smart RMS';
    const ws = wb.addWorksheet(report.title.slice(0, 31));
    ws.addRow([report.title]).font = { bold: true, size: 14 };
    ws.addRow([`${scopeLabel} | ${report.from} to ${report.to}`]);
    if (report.summary?.length) ws.addRow(report.summary.map((s) => `${s.label}: ${s.value}`));
    ws.addRow([]);
    const head = ws.addRow(report.columns.map((c) => c.label));
    head.font = { bold: true, color: { argb: 'FFFBBF24' } };
    head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1917' } }));
    for (const r of report.rows) ws.addRow(report.columns.map((c) => (c.type === 'money' ? Number(r[c.key] || 0) : r[c.key] ?? '')));
    report.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.max(12, c.label.length + 4);
      if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  res.json(report);
}
