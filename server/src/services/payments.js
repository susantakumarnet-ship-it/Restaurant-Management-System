/**
 * Payments: Razorpay (when keys configured) or a built-in mock gateway for dev/demo.
 * Supports online checkout, manual cash/UPI/card capture at the counter, partial payments,
 * full/partial refunds, booking advance payments and invoice generation.
 */
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { makeCode, round2 } from '../utils/common.js';
import { notify } from './notify.js';

let rzp = null;
const razorpay = () => {
  if (config.payments.mode !== 'razorpay') return null;
  if (!rzp) rzp = new Razorpay({ key_id: config.payments.razorpayKeyId, key_secret: config.payments.razorpayKeySecret });
  return rzp;
};

/** Outstanding amount for an order or reservation advance. */
async function dueFor(q, { orderId, reservationId }) {
  if (orderId) {
    const o = await q.one(
      `SELECT o.*, cu.user_id FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id WHERE o.id = $1`,
      [orderId]
    );
    if (!o) throw notFound('Order');
    if (o.status === 'cancelled') throw badRequest('This order has been cancelled');
    return { target: o, branchId: o.branch_id, userId: o.user_id, due: round2(Number(o.total) - Number(o.amount_paid)), purpose: 'order' };
  }
  const r = await q.one(
    `SELECT r.*, cu.user_id FROM reservations r LEFT JOIN customers cu ON cu.id = r.customer_id WHERE r.id = $1`,
    [reservationId]
  );
  if (!r) throw notFound('Reservation');
  if (['cancelled', 'rejected', 'no_show'].includes(r.status)) throw badRequest(`This booking is ${r.status}`);
  const paid = await q.one(`SELECT COALESCE(SUM(amount - refunded_amount),0) AS s FROM payments WHERE reservation_id = $1 AND status IN ('success','partially_refunded')`, [reservationId]);
  return { target: r, branchId: r.branch_id, userId: r.user_id, due: round2(Number(r.advance_amount) - Number(paid.s)), purpose: 'advance' };
}

/** Step 1 of online checkout: create a pending payment (+ Razorpay order). */
export async function createOnlinePayment({ orderId, reservationId, user }) {
  const d = await dueFor(db, { orderId, reservationId });
  if (d.userId !== user.id) throw notFound(orderId ? 'Order' : 'Reservation');
  if (d.due <= 0) throw badRequest('Nothing to pay - this is already paid');
  const code = makeCode('PAY', 8);
  let gatewayOrderId = `mock_${code}`;
  const client = razorpay();
  if (client) {
    const rOrder = await client.orders.create({ amount: Math.round(d.due * 100), currency: 'INR', receipt: code, notes: { orderId: orderId || '', reservationId: reservationId || '' } });
    gatewayOrderId = rOrder.id;
  }
  const p = await db.one(
    `INSERT INTO payments(payment_code, branch_id, order_id, reservation_id, user_id, amount, method, status, purpose, gateway, gateway_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,'online','pending',$7,$8,$9) RETURNING *`,
    [code, d.branchId, orderId || null, reservationId || null, user.id, d.due, d.purpose, client ? 'razorpay' : 'mock', gatewayOrderId]
  );
  const branch = await db.one(`SELECT r.name FROM restaurant_branches b JOIN restaurants r ON r.id = b.restaurant_id WHERE b.id = $1`, [d.branchId]);
  return {
    payment_id: p.id,
    payment_code: p.payment_code,
    mode: config.payments.mode,
    key_id: config.payments.razorpayKeyId || null,
    gateway_order_id: gatewayOrderId,
    amount: Number(p.amount),
    amount_paise: Math.round(Number(p.amount) * 100),
    currency: 'INR',
    name: branch?.name || 'Restaurant',
    description: orderId ? `Order ${d.target.order_code}` : `Advance for booking ${d.target.booking_code}`,
    prefill: { name: user.name, email: user.email, contact: user.phone },
  };
}

/** Step 2: verify Razorpay signature and capture. */
export async function verifyOnlinePayment({ paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature, user }) {
  const p = await db.one('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!p || p.user_id !== user.id) throw notFound('Payment');
  if (p.status === 'success') return p;
  if (p.gateway !== 'razorpay') throw badRequest('Not a Razorpay payment');
  if (razorpay_order_id !== p.gateway_order_id) throw badRequest('Order mismatch');
  const expected = crypto.createHmac('sha256', config.payments.razorpayKeySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const ok = expected.length === String(razorpay_signature).length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));
  if (!ok) {
    await db.query(`UPDATE payments SET status = 'failed', notes = 'Signature verification failed' WHERE id = $1`, [p.id]);
    throw badRequest('Payment verification failed');
  }
  return markPaymentSuccess(p.id, { gatewayPaymentId: razorpay_payment_id });
}

/** Mock gateway completion (only when Razorpay keys are not configured). */
export async function completeMockPayment({ paymentId, success, user }) {
  if (config.payments.mode !== 'mock') throw forbidden('Mock payments are disabled');
  const p = await db.one('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!p || p.user_id !== user.id) throw notFound('Payment');
  if (p.status !== 'pending') return p;
  if (!success) {
    await db.query(`UPDATE payments SET status = 'failed', notes = 'Payment cancelled or declined' WHERE id = $1`, [p.id]);
    throw badRequest('Payment failed or was cancelled');
  }
  return markPaymentSuccess(p.id, { gatewayPaymentId: `mockpay_${crypto.randomBytes(6).toString('hex')}` });
}

/** Razorpay webhook (payment.captured) - idempotent safety net if the browser closes before verify. */
export async function handleWebhook(rawBody, signature) {
  if (!config.payments.razorpayWebhookSecret) throw forbidden('Webhook not configured');
  const expected = crypto.createHmac('sha256', config.payments.razorpayWebhookSecret).update(rawBody).digest('hex');
  if (!signature || expected !== signature) throw forbidden('Invalid signature');
  const event = JSON.parse(rawBody.toString('utf8'));
  if (event.event === 'payment.captured') {
    const ent = event.payload?.payment?.entity;
    const p = ent && (await db.one('SELECT * FROM payments WHERE gateway_order_id = $1', [ent.order_id]));
    if (p && p.status === 'pending') await markPaymentSuccess(p.id, { gatewayPaymentId: ent.id });
  }
  return { ok: true };
}

/** Apply a successful payment to its order/reservation inside a transaction. */
export async function markPaymentSuccess(paymentId, { gatewayPaymentId } = {}) {
  const res = await db.tx(async (t) => {
    const p = await t.one('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    if (p.status === 'success') return p;
    const upd = await t.one(
      `UPDATE payments SET status = 'success', paid_at = now(), gateway_payment_id = COALESCE($2, gateway_payment_id) WHERE id = $1 RETURNING *`,
      [paymentId, gatewayPaymentId || null]
    );
    await applyToTarget(t, upd);
    return upd;
  });
  await afterPayment(res);
  return res;
}

async function applyToTarget(t, p) {
  if (p.order_id) {
    const o = await t.one(
      `UPDATE orders SET amount_paid = amount_paid + $2,
          payment_status = CASE WHEN amount_paid + $2 >= total THEN 'paid' ELSE 'partially_paid' END,
          payment_method = $3,
          status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
          updated_at = now()
        WHERE id = $1 RETURNING *`,
      [p.order_id, p.amount, p.method]
    );
    if (o.payment_status === 'paid') await ensureInvoice(t, o.id);
  }
  if (p.reservation_id) {
    const r = await t.one('SELECT * FROM reservations WHERE id = $1', [p.reservation_id]);
    const paid = await t.one(`SELECT COALESCE(SUM(amount - refunded_amount),0) AS s FROM payments WHERE reservation_id = $1 AND status IN ('success','partially_refunded')`, [r.id]);
    const ps = Number(paid.s) >= Number(r.advance_amount) ? 'paid' : 'partially_paid';
    const s = await t.one('SELECT auto_confirm FROM restaurant_settings WHERE branch_id = $1', [r.branch_id]);
    const confirm = ps === 'paid' && r.status === 'pending' && s?.auto_confirm;
    await t.query(`UPDATE reservations SET payment_status = $2, status = CASE WHEN $3::boolean THEN 'confirmed' ELSE status END, updated_at = now() WHERE id = $1`, [r.id, ps, confirm]);
    if (confirm) {
      await t.query(`INSERT INTO reservation_status_history(reservation_id, from_status, to_status, note) VALUES ($1,'pending','confirmed','Auto-confirmed after advance payment')`, [r.id]);
    }
  }
}

async function afterPayment(p) {
  const info = await db.one(
    `SELECT u.id AS user_id, u.email, u.phone, COALESCE(o.order_code, r.booking_code) AS ref
       FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN reservations r ON r.id = p.reservation_id
       LEFT JOIN customers cu ON cu.id = COALESCE(o.customer_id, r.customer_id) LEFT JOIN users u ON u.id = cu.user_id
      WHERE p.id = $1`,
    [p.id]
  );
  await notify({
    userId: info?.user_id,
    branchId: p.branch_id,
    adminFeed: p.method === 'online',
    type: 'payment_success',
    title: `Payment received - ₹${Number(p.amount)}`,
    message: `We received your payment of ₹${Number(p.amount)} for ${info?.ref}. Transaction ${p.payment_code}.`,
    email: info?.email,
    phone: info?.phone,
    channels: ['in_app', 'email', 'sms'],
    link: p.order_id ? `/my/orders/${p.order_id}` : `/my/bookings/${p.reservation_id}`,
    adminLink: '/admin/payments',
    adminTitle: `Online payment received - ₹${Number(p.amount)}`,
    adminMessage: `${p.purpose === 'advance' ? 'Booking advance' : 'Order payment'} of ₹${Number(p.amount)} received for ${info?.ref} (txn ${p.payment_code}).`,
  });
}

/** Staff records a cash/UPI/card payment at the counter (supports partial payments). */
export async function recordManualPayment({ branchId, orderId, reservationId, amount, method, notes, actor }) {
  const res = await db.tx(async (t) => {
    if (orderId) await t.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    else await t.query('SELECT id FROM reservations WHERE id = $1 FOR UPDATE', [reservationId]);
    const d = await dueFor(t, { orderId, reservationId });
    if (d.branchId !== branchId) throw notFound(orderId ? 'Order' : 'Reservation');
    if (d.due <= 0) throw badRequest('Nothing is due');
    const amt = round2(amount ?? d.due);
    if (amt <= 0) throw badRequest('Amount must be positive');
    if (amt > d.due) throw badRequest(`Amount exceeds the outstanding balance of ₹${d.due}`);
    const p = await t.one(
      `INSERT INTO payments(payment_code, branch_id, order_id, reservation_id, user_id, amount, method, status, is_partial, purpose, gateway, notes, recorded_by, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'success',$8,$9,'manual',$10,$11, now()) RETURNING *`,
      [makeCode('PAY', 8), branchId, orderId || null, reservationId || null, d.userId || null, amt, method, amt < d.due, d.purpose, notes || null, actor.id]
    );
    await applyToTarget(t, p);
    return p;
  });
  await afterPayment(res);
  return res;
}

/** Refund (full or partial). Razorpay payments are refunded through the gateway. */
export async function refundPayment({ paymentId, amount, reason, actor, branchId }) {
  const result = await db.tx(async (t) => {
    const p = await t.one('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    if (!p || (branchId && p.branch_id !== branchId)) throw notFound('Payment');
    if (!['success', 'partially_refunded'].includes(p.status)) throw badRequest('Only successful payments can be refunded');
    const refundable = round2(Number(p.amount) - Number(p.refunded_amount));
    const amt = round2(amount ?? refundable);
    if (amt <= 0 || amt > refundable) throw badRequest(`Refund amount must be between ₹0.01 and ₹${refundable}`);
    let reference = `RF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    if (p.gateway === 'razorpay' && p.gateway_payment_id && razorpay()) {
      const rf = await razorpay().payments.refund(p.gateway_payment_id, { amount: Math.round(amt * 100), notes: { reason: reason || '' } });
      reference = rf.id;
    }
    const refunded = round2(Number(p.refunded_amount) + amt);
    const status = refunded >= Number(p.amount) ? 'refunded' : 'partially_refunded';
    const upd = await t.one(
      `UPDATE payments SET refunded_amount = $2, status = $3, refund_reference = $4, refund_reason = $5 WHERE id = $1 RETURNING *`,
      [p.id, refunded, status, reference, reason || null]
    );
    if (p.order_id) {
      await t.query(
        `UPDATE orders SET amount_paid = GREATEST(amount_paid - $2, 0),
            payment_status = CASE WHEN amount_paid - $2 <= 0 THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now()
          WHERE id = $1`,
        [p.order_id, amt]
      );
    }
    if (p.reservation_id) {
      const left = await t.one(`SELECT COALESCE(SUM(amount - refunded_amount),0) AS s FROM payments WHERE reservation_id = $1 AND status IN ('success','partially_refunded')`, [p.reservation_id]);
      await t.query(`UPDATE reservations SET payment_status = $2, updated_at = now() WHERE id = $1`, [p.reservation_id, Number(left.s) <= 0 ? 'refunded' : 'partially_refunded']);
    }
    return { payment: upd, amount: amt };
  });
  const info = await db.one(
    `SELECT u.id AS user_id, u.email, u.phone FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [paymentId]
  );
  await notify({
    userId: info?.user_id,
    branchId: result.payment.branch_id,
    type: 'refund_processed',
    title: `Refund processed - ₹${result.amount}`,
    message: `A refund of ₹${result.amount} for transaction ${result.payment.payment_code} has been processed. It may take 5-7 working days to reflect.`,
    email: info?.email,
    phone: info?.phone,
    channels: ['in_app', 'email', 'sms'],
  });
  return result.payment;
}

export async function refundOrderPayments(orderId, actor, reason) {
  const ps = await db.many(`SELECT id FROM payments WHERE order_id = $1 AND status IN ('success','partially_refunded')`, [orderId]);
  for (const p of ps) await refundPayment({ paymentId: p.id, reason, actor }).catch((e) => console.error('[refund] order', e.message));
}

export async function refundReservationAdvance(reservationId, actor, reason) {
  const ps = await db.many(`SELECT id FROM payments WHERE reservation_id = $1 AND status IN ('success','partially_refunded')`, [reservationId]);
  for (const p of ps) await refundPayment({ paymentId: p.id, reason, actor }).catch((e) => console.error('[refund] reservation', e.message));
}

/** Create the GST invoice for an order (idempotent). */
export async function ensureInvoice(q, orderId) {
  const existing = await q.one('SELECT * FROM invoices WHERE order_id = $1', [orderId]);
  if (existing) return existing;
  const o = await q.one('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!o) throw notFound('Order');
  if (o.status === 'cancelled') throw conflict('Cannot invoice a cancelled order');
  const d = new Date();
  const number = `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${String(o.id).padStart(6, '0')}`;
  const cgst = round2(Number(o.tax) / 2);
  return q.one(
    `INSERT INTO invoices(invoice_number, branch_id, order_id, reservation_id, customer_name, subtotal, discount, cgst, sgst, service_charge, delivery_charge, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (order_id) DO UPDATE SET invoice_number = invoices.invoice_number RETURNING *`,
    [number, o.branch_id, o.id, o.reservation_id, o.contact_name, o.subtotal, o.discount, cgst, round2(Number(o.tax) - cgst), o.service_charge, o.delivery_charge, o.total]
  );
}
