import ExcelJS from 'exceljs';
import { db } from '../db/index.js';
import { badRequest } from '../utils/http.js';
import { round2 } from '../utils/common.js';
import { tablePdf } from './pdf.js';

const sum = (rows, k) => round2(rows.reduce((s, r) => s + Number(r[k] || 0), 0));

/**
 * Report definitions. Each returns { title, columns, rows, summary }.
 * `branchIds` lets the same report run for a single branch or consolidated (super admin).
 */
const REPORTS = {
  sales_daily: {
    title: 'Daily Sales Report',
    async run({ branchIds, from, to }) {
      const rows = await db.many(
        `SELECT to_char(o.created_at::date, 'YYYY-MM-DD') AS day, COUNT(*) AS orders,
                SUM(o.subtotal) AS gross, SUM(o.discount) AS discount, SUM(o.tax) AS tax,
                SUM(o.service_charge + o.delivery_charge) AS charges, SUM(o.total) AS net,
                SUM(o.amount_paid) AS collected
           FROM orders o
          WHERE o.branch_id = ANY($1::int[]) AND o.status <> 'cancelled' AND o.created_at::date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY 1`,
        [branchIds, from, to]
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
      const rows = await db.many(
        `SELECT to_char(date_trunc('${unit}', p.created_at), '${unit === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM'}') AS period,
                COUNT(*) FILTER (WHERE p.purpose = 'order') AS order_payments,
                COUNT(*) FILTER (WHERE p.purpose = 'advance') AS advance_payments,
                SUM(p.amount) AS received, SUM(p.refunded_amount) AS refunded, SUM(p.amount - p.refunded_amount) AS net
           FROM payments p
          WHERE p.branch_id = ANY($1::int[]) AND p.status IN ('success','refunded','partially_refunded')
            AND p.created_at::date BETWEEN $2 AND $3
          GROUP BY date_trunc('${unit}', p.created_at) ORDER BY date_trunc('${unit}', p.created_at)`,
        [branchIds, from, to]
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
      const rows = await db.many(
        `SELECT r.booking_code, r.booking_date::text AS date, to_char(r.start_at, 'HH24:MI') AS time, r.customer_name, r.phone,
                r.guests, r.status, r.source, r.occasion,
                COALESCE((SELECT string_agg(t.table_number, ', ') FROM reservation_tables rt JOIN tables t ON t.id = rt.table_id WHERE rt.reservation_id = r.id), '') AS tables,
                r.advance_amount, r.payment_status
           FROM reservations r
          WHERE r.branch_id = ANY($1::int[]) AND r.booking_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR r.status = $4)
          ORDER BY r.start_at`,
        [branchIds, from, to, status || null]
      );
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
      const rows = await db.many(
        `SELECT r.booking_code, r.booking_date::text AS date, to_char(r.start_at, 'HH24:MI') AS time, r.customer_name, r.phone, r.guests,
                r.status, COALESCE(r.cancel_reason, r.admin_notes, '') AS reason,
                to_char(r.cancelled_at, 'YYYY-MM-DD HH24:MI') AS cancelled_at, r.payment_status
           FROM reservations r
          WHERE r.branch_id = ANY($1::int[]) AND r.status IN ('cancelled','rejected','no_show') AND r.booking_date BETWEEN $2 AND $3
          ORDER BY r.booking_date DESC`,
        [branchIds, from, to]
      );
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
      const rows = await db.many(
        `SELECT u.name, u.email, u.phone, c.loyalty_points, c.status,
                (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.branch_id = ANY($1::int[]) AND r.booking_date BETWEEN $2 AND $3) AS bookings,
                (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.branch_id = ANY($1::int[]) AND o.status <> 'cancelled' AND o.created_at::date BETWEEN $2 AND $3) AS orders,
                (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id = c.id AND o.branch_id = ANY($1::int[]) AND o.status <> 'cancelled' AND o.created_at::date BETWEEN $2 AND $3) AS spent,
                to_char(c.created_at, 'YYYY-MM-DD') AS joined
           FROM customers c JOIN users u ON u.id = c.user_id
          WHERE EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id AND r.branch_id = ANY($1::int[]))
             OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.branch_id = ANY($1::int[]))
          ORDER BY spent DESC`,
        [branchIds, from, to]
      );
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
      const rows = await db.many(
        `SELECT oi.name AS item, COALESCE(fc.name, '-') AS category, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue,
                COUNT(DISTINCT oi.order_id) AS orders
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
           LEFT JOIN food_items fi ON fi.id = oi.food_item_id LEFT JOIN food_categories fc ON fc.id = fi.category_id
          WHERE o.branch_id = ANY($1::int[]) AND o.status <> 'cancelled' AND o.created_at::date BETWEEN $2 AND $3
          GROUP BY oi.name, fc.name ORDER BY revenue DESC`,
        [branchIds, from, to]
      );
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
      const rows = await db.many(
        `SELECT p.payment_code, to_char(p.created_at, 'YYYY-MM-DD HH24:MI') AS date, p.method, p.purpose, p.status,
                COALESCE(o.order_code, r.booking_code) AS reference, p.amount, p.refunded_amount, p.gateway, COALESCE(p.gateway_payment_id,'') AS gateway_ref
           FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN reservations r ON r.id = p.reservation_id
          WHERE p.branch_id = ANY($1::int[]) AND p.created_at::date BETWEEN $2 AND $3
          ORDER BY p.created_at DESC`,
        [branchIds, from, to]
      );
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
      const rows = await db.many(
        `SELECT to_char(i.issued_at::date, 'YYYY-MM-DD') AS day, COUNT(*) AS invoices,
                SUM(i.subtotal - i.discount + i.service_charge) AS taxable, SUM(i.cgst) AS cgst, SUM(i.sgst) AS sgst,
                SUM(i.cgst + i.sgst) AS total_tax, SUM(i.total) AS invoice_value
           FROM invoices i
          WHERE i.branch_id = ANY($1::int[]) AND i.issued_at::date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY 1`,
        [branchIds, from, to]
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
      const rows = await db.many(
        `SELECT i.name, COALESCE(i.category,'') AS category, i.unit, i.quantity, i.min_quantity, i.cost_per_unit,
                round(i.quantity * i.cost_per_unit, 2) AS stock_value, COALESCE(s.name,'') AS supplier,
                COALESCE(i.expiry_date::text,'') AS expiry_date,
                COALESCE((SELECT SUM(t.quantity) FROM inventory_transactions t WHERE t.inventory_item_id = i.id AND t.type = 'stock_in' AND t.created_at::date BETWEEN $2 AND $3),0) AS stock_in,
                COALESCE((SELECT SUM(t.quantity) FROM inventory_transactions t WHERE t.inventory_item_id = i.id AND t.type IN ('stock_out','wastage') AND t.created_at::date BETWEEN $2 AND $3),0) AS used,
                CASE WHEN i.quantity <= i.min_quantity THEN 'LOW' WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= CURRENT_DATE + 7 THEN 'EXPIRING' ELSE 'OK' END AS stock_status
           FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id
          WHERE i.branch_id = ANY($1::int[]) AND i.is_active
          ORDER BY stock_status, i.name`,
        [branchIds, from, to]
      );
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
