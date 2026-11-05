import PDFDocument from 'pdfkit';

// Built-in PDF fonts have no rupee glyph, so amounts are printed as "Rs.".
const money = (n) => `Rs. ${Number(n || 0).toFixed(2)}`;
const BRAND = '#b45309';

function header(doc, title, sub) {
  doc.rect(0, 0, doc.page.width, 80).fill('#1c1917');
  doc.fillColor('#fbbf24').fontSize(20).font('Helvetica-Bold').text(title, 50, 24);
  if (sub) doc.fillColor('#e7e5e4').fontSize(10).font('Helvetica').text(sub, 50, 50);
  doc.fillColor('#111').moveDown(3);
  doc.y = 100;
}

function kv(doc, rows, x = 50, width = 495) {
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#57534e').text(k, x, y, { width: 150 });
    doc.font('Helvetica').fillColor('#111').text(v == null || v === '' ? '-' : String(v), x + 160, y, { width: width - 160 });
    doc.moveDown(0.4);
  }
}

function startDoc(res, filename) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

export function invoicePdf(res, { invoice, order, restaurant }) {
  const doc = startDoc(res, `${invoice.invoice_number}.pdf`);
  header(doc, restaurant.name, `${restaurant.branch_name || ''}${restaurant.address ? ' - ' + restaurant.address : ''}`);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text('TAX INVOICE', 50, 100);
  doc.moveDown(0.5);
  kv(doc, [
    ['Invoice No.', invoice.invoice_number],
    ['Invoice Date', new Date(invoice.issued_at).toLocaleString('en-IN')],
    ['Order No.', order.order_code],
    ['Order Type', order.order_type.replace('_', '-')],
    ['Customer', order.contact_name],
    ['Phone', order.contact_phone],
    ['GSTIN', restaurant.gstin],
    ...(order.table_number ? [['Table', order.table_number]] : []),
    ...(order.delivery_address ? [['Delivery Address', order.delivery_address]] : []),
  ]);
  doc.moveDown();
  const cols = [50, 300, 370, 450];
  const y0 = doc.y;
  doc.rect(50, y0 - 4, 495, 20).fill('#f5f5f4');
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(10);
  ['Item', 'Qty', 'Rate', 'Amount'].forEach((h, i) => doc.text(h, cols[i], y0, { width: i === 0 ? 240 : 90, align: i === 0 ? 'left' : 'right' }));
  doc.moveDown(0.8).font('Helvetica');
  for (const it of order.items) {
    const y = doc.y;
    doc.text(it.name, cols[0], y, { width: 240 });
    doc.text(String(it.quantity), cols[1], y, { width: 60, align: 'right' });
    doc.text(money(it.unit_price), cols[2], y, { width: 75, align: 'right' });
    doc.text(money(it.line_total), cols[3], y, { width: 95, align: 'right' });
    doc.moveDown(0.5);
  }
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d6d3d1').stroke().moveDown(0.5);
  const totals = [
    ['Subtotal', invoice.subtotal],
    ...(Number(invoice.discount) ? [[`Discount${order.coupon_code ? ' (' + order.coupon_code + ')' : ''}`, -invoice.discount]] : []),
    ...(Number(invoice.service_charge) ? [['Service charge', invoice.service_charge]] : []),
    ['CGST', invoice.cgst],
    ['SGST', invoice.sgst],
    ...(Number(invoice.delivery_charge) ? [['Delivery charge', invoice.delivery_charge]] : []),
  ];
  for (const [k, v] of totals) {
    const y = doc.y;
    doc.font('Helvetica').text(k, 300, y, { width: 140, align: 'right' }).text(money(v), 450, y, { width: 95, align: 'right' });
    doc.moveDown(0.3);
  }
  const y = doc.y + 4;
  doc.rect(300, y - 4, 245, 22).fill('#1c1917');
  doc.fillColor('#fbbf24').font('Helvetica-Bold').text('TOTAL', 305, y, { width: 135, align: 'right' }).text(money(invoice.total), 450, y, { width: 90, align: 'right' });
  doc.fillColor('#111').moveDown(2);
  doc.font('Helvetica').fontSize(10).text(`Payment status: ${order.payment_status.replace('_', ' ')}  |  Amount paid: ${money(order.amount_paid)}`, 50);
  doc.moveDown(2).fontSize(9).fillColor('#78716c').text('Thank you for dining with us! This is a computer generated invoice.', { align: 'center' });
  doc.end();
}

export function bookingPdf(res, r) {
  const doc = startDoc(res, `booking-${r.booking_code}.pdf`);
  header(doc, r.restaurant_name, `${r.branch_name}${r.branch_address ? ' - ' + r.branch_address : ''}`);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text('BOOKING CONFIRMATION', 50, 100);
  doc.moveDown(0.3).fontSize(28).fillColor('#111').text(r.booking_code);
  doc.moveDown(0.5);
  kv(doc, [
    ['Status', r.status.replace('_', ' ').toUpperCase()],
    ['Guest name', r.customer_name],
    ['Mobile', r.phone],
    ['Email', r.email],
    ['Date', new Date(r.booking_date + 'T00:00:00').toDateString()],
    ['Time', `${r.start_at.slice(11, 16)} - ${r.end_at.slice(11, 16)}`],
    ['Guests', r.guests],
    ['Table(s)', r.tables.map((t) => `${t.table_number}${t.section_name ? ' (' + t.section_name + ')' : ''}`).join(', ') || 'To be assigned'],
    ['Occasion', r.occasion],
    ['Special requests', r.special_requests],
    ['Advance', Number(r.advance_amount) ? `${money(r.advance_amount)} (${r.payment_status.replace('_', ' ')})` : 'Not required'],
    ['Restaurant phone', r.branch_phone],
  ]);
  doc.moveDown(2).fontSize(9).fillColor('#78716c').text('Please arrive 10 minutes before your booking time. Show this confirmation at the host desk.', { align: 'center' });
  doc.end();
}

export function tablePdf(res, { title, subtitle, columns, rows, summary, filename }) {
  const doc = new PDFDocument({ size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  const width = doc.page.width - 72;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text(title);
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor('#57534e').text(subtitle);
  doc.moveDown();
  if (summary?.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#111').text(summary.map((s) => `${s.label}: ${fmt(s.value, s.type)}`).join('    |    '));
    doc.moveDown();
  }
  const colW = width / columns.length;
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(36, y - 3, width, 16).fill('#1c1917');
    doc.fillColor('#fbbf24').font('Helvetica-Bold').fontSize(8);
    columns.forEach((c, i) => doc.text(c.label, 38 + i * colW, y, { width: colW - 4, ellipsis: true, lineBreak: false }));
    doc.y = y + 16;
    doc.fillColor('#111').font('Helvetica');
  };
  drawHeader();
  rows.forEach((row, idx) => {
    if (doc.y > doc.page.height - 50) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (idx % 2) doc.rect(36, y - 2, width, 14).fill('#f5f5f4').fillColor('#111');
    columns.forEach((c, i) => doc.fontSize(8).text(fmt(row[c.key], c.type), 38 + i * colW, y, { width: colW - 4, ellipsis: true, lineBreak: false }));
    doc.y = y + 14;
  });
  if (!rows.length) doc.fontSize(10).text('No data for the selected period.');
  doc.end();
}

export function fmt(v, type) {
  if (v == null) return '';
  if (type === 'money') return money(v);
  if (type === 'datetime') return new Date(v).toLocaleString('en-IN');
  return String(v);
}
