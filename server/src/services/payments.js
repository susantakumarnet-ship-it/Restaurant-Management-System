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
import { invalid, makeCode, round2 } from '../utils/common.js';
import { notify } from './notify.js';

let rzp = null;
const razorpay = () => {
  if (config.payments.mode !== 'razorpay') return null;
  if (!rzp) rzp = new Razorpay({ key_id: config.payments.razorpayKeyId, key_secret: config.payments.razorpayKeySecret });
  return rzp;
};

const PAID_STATUSES = ['success', 'partially_refunded'];

/** COALESCE(SUM(amount - refunded_amount), 0) of the live payments for a reservation. */
async function reservationPaid(reservationId) {
  const [row] = await db.aggregate('payments', [
    { $match: { reservation_id: Number(reservationId), status: { $in: PAID_STATUSES } } },
    { $group: { _id: null, s: { $sum: { $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$refunded_amount', 0] }] } } } },
  ]);
  return round2(row?.s || 0);
}

const userIdOfCustomer = async (customerId) => {
  if (customerId == null) return null;
  const cu = await db.byId('customers', customerId, { projection: { user_id: 1 } });
  return cu ? cu.user_id : null;
};

/** Outstanding amount for an order or reservation advance. */
async function dueFor(q, { orderId, reservationId }) { // eslint-disable-line no-unused-vars
  if (orderId) {
    const o = await db.byId('orders', orderId);
    if (!o) throw notFound('Order');
    o.user_id = await userIdOfCustomer(o.customer_id);
    if (o.status === 'cancelled') throw badRequest('This order has been cancelled');
    return { target: o, branchId: o.branch_id, userId: o.user_id, due: round2(Number(o.total) - Number(o.amount_paid)), purpose: 'order' };
  }
  const r = await db.byId('reservations', reservationId);
  if (!r) throw notFound('Reservation');
  r.user_id = await userIdOfCustomer(r.customer_id);
  if (['cancelled', 'rejected', 'no_show'].includes(r.status)) throw badRequest(`This booking is ${r.status}`);
  const paid = await reservationPaid(r.id);
  return { target: r, branchId: r.branch_id, userId: r.user_id, due: round2(Number(r.advance_amount) - paid), purpose: 'advance' };
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
  const p = await db.insert('payments', {
    payment_code: code,
    branch_id: d.branchId,
    order_id: orderId ? Number(orderId) : null,
    reservation_id: reservationId ? Number(reservationId) : null,
    user_id: user.id,
    amount: d.due,
    method: 'online',
    status: 'pending',
    purpose: d.purpose,
    gateway: client ? 'razorpay' : 'mock',
    gateway_order_id: gatewayOrderId,
  });
  const branch = await db.byId('restaurant_branches', d.branchId, { projection: { restaurant_id: 1 } });
  const rest = branch ? await db.byId('restaurants', branch.restaurant_id, { projection: { name: 1 } }) : null;
  return {
    payment_id: p.id,
    payment_code: p.payment_code,
    mode: config.payments.mode,
    key_id: config.payments.razorpayKeyId || null,
    gateway_order_id: gatewayOrderId,
    amount: Number(p.amount),
    amount_paise: Math.round(Number(p.amount) * 100),
    currency: 'INR',
    name: rest?.name || 'Restaurant',
    description: orderId ? `Order ${d.target.order_code}` : `Advance for booking ${d.target.booking_code}`,
    prefill: { name: user.name, email: user.email, contact: user.phone },
  };
}

/** Step 2: verify Razorpay signature and capture. */
export async function verifyOnlinePayment({ paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature, user }) {
  const p = await db.byId('payments', paymentId);
  if (!p || p.user_id !== user.id) throw notFound('Payment');
  if (p.status === 'success') return p;
  if (p.gateway !== 'razorpay') throw badRequest('Not a Razorpay payment');
  if (razorpay_order_id !== p.gateway_order_id) throw badRequest('Order mismatch');
  const expected = crypto.createHmac('sha256', config.payments.razorpayKeySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const ok = expected.length === String(razorpay_signature).length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));
  if (!ok) {
    await db.update('payments', { id: p.id }, { status: 'failed', notes: 'Signature verification failed' });
    throw badRequest('Payment verification failed');
  }
  return markPaymentSuccess(p.id, { gatewayPaymentId: razorpay_payment_id });
}

/** Mock gateway completion (only when Razorpay keys are not configured). */
export async function completeMockPayment({ paymentId, success, user }) {
  if (config.payments.mode !== 'mock') throw forbidden('Mock payments are disabled');
  const p = await db.byId('payments', paymentId);
  if (!p || p.user_id !== user.id) throw notFound('Payment');
  if (p.status !== 'pending') return p;
  if (!success) {
    await db.update('payments', { id: p.id }, { status: 'failed', notes: 'Payment cancelled or declined' });
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
    const p = ent && ent.order_id != null ? await db.findOne('payments', { gateway_order_id: ent.order_id }) : null;
    if (p && p.status === 'pending') await markPaymentSuccess(p.id, { gatewayPaymentId: ent.id });
  }
  return { ok: true };
}

/** Apply a successful payment to its order/reservation inside a transaction. */
export async function markPaymentSuccess(paymentId, { gatewayPaymentId } = {}) {
  const res = await db.tx(async () => {
    // SELECT ... FOR UPDATE: concurrent verify/webhook/mock completions serialise here (idempotent).
    await db.lock('payments', { id: Number(paymentId) });
    const p = await db.byId('payments', paymentId);
    if (!p) throw notFound('Payment');
    if (p.status === 'success') return p;
    const set = { status: 'success', paid_at: new Date() };
    if (gatewayPaymentId) set.gateway_payment_id = gatewayPaymentId;
    const upd = await db.findOneAndUpdate('payments', { id: p.id }, { $set: set });
    await applyToTarget(null, upd);
    return upd;
  });
  await afterPayment(res);
  return res;
}

async function applyToTarget(t, p) { // eslint-disable-line no-unused-vars
  if (p.order_id) {
    await db.lock('orders', { id: p.order_id });
    const cur = await db.byId('orders', p.order_id);
    if (cur) {
      const paid = round2(Number(cur.amount_paid) + Number(p.amount));
      const o = await db.findOneAndUpdate(
        'orders',
        { id: cur.id },
        {
          $set: {
            amount_paid: paid,
            payment_status: paid >= Number(cur.total) ? 'paid' : 'partially_paid',
            payment_method: p.method,
            status: cur.status === 'pending' ? 'confirmed' : cur.status,
            updated_at: new Date(),
          },
        }
      );
      if (o.payment_status === 'paid') await ensureInvoice(null, o.id);
    }
  }
  if (p.reservation_id) {
    const r = await db.byId('reservations', p.reservation_id);
    if (!r) return;
    const paid = await reservationPaid(r.id);
    const ps = paid >= Number(r.advance_amount) ? 'paid' : 'partially_paid';
    const s = await db.findOne('restaurant_settings', { branch_id: r.branch_id }, { projection: { auto_confirm: 1 } });
    const confirm = !!(ps === 'paid' && r.status === 'pending' && s?.auto_confirm);
    const set = { payment_status: ps, updated_at: new Date() };
    if (confirm) set.status = 'confirmed';
    await db.update('reservations', { id: r.id }, { $set: set });
    if (confirm) {
      await db.insert('reservation_status_history', { reservation_id: r.id, from_status: 'pending', to_status: 'confirmed', note: 'Auto-confirmed after advance payment' });
    }
  }
}

async function afterPayment(p) {
  const o = p.order_id ? await db.byId('orders', p.order_id, { projection: { order_code: 1, customer_id: 1 } }) : null;
  const r = p.reservation_id ? await db.byId('reservations', p.reservation_id, { projection: { booking_code: 1, customer_id: 1 } }) : null;
  const customerId = o?.customer_id ?? r?.customer_id ?? null;
  const userId = await userIdOfCustomer(customerId);
  const u = userId != null ? await db.byId('users', userId, { projection: { id: 1, email: 1, phone: 1 } }) : null;
  const info = { user_id: u ? u.id : null, email: u ? u.email : null, phone: u ? u.phone : null, ref: o?.order_code ?? r?.booking_code ?? null };
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
  const res = await db.tx(async () => {
    if (orderId) await db.lock('orders', { id: Number(orderId) });
    else await db.lock('reservations', { id: Number(reservationId) });
    const d = await dueFor(null, { orderId, reservationId });
    if (d.branchId !== branchId) throw notFound(orderId ? 'Order' : 'Reservation');
    if (d.due <= 0) throw badRequest('Nothing is due');
    const amt = round2(amount ?? d.due);
    if (amt <= 0) throw badRequest('Amount must be positive');
    if (amt > d.due) throw badRequest(`Amount exceeds the outstanding balance of ₹${d.due}`);
    let code = makeCode('PAY', 8);
    for (let i = 0; i < 4 && (await db.exists('payments', { payment_code: code })); i++) code = makeCode('PAY', 8);
    const p = await db.insert('payments', {
      payment_code: code,
      branch_id: branchId,
      order_id: orderId ? Number(orderId) : null,
      reservation_id: reservationId ? Number(reservationId) : null,
      user_id: d.userId || null,
      amount: amt,
      method,
      status: 'success',
      is_partial: amt < d.due,
      purpose: d.purpose,
      gateway: 'manual',
      notes: notes || null,
      recorded_by: actor.id,
      paid_at: new Date(),
    });
    await applyToTarget(null, p);
    return p;
  });
  await afterPayment(res);
  return res;
}

/** Refund (full or partial). Razorpay payments are refunded through the gateway. */
export async function refundPayment({ paymentId, amount, reason, actor, branchId }) { // eslint-disable-line no-unused-vars
  // The gateway refund is an external side effect: remember it so a transaction retry never refunds twice.
  let gatewayRefund = null;
  const result = await db.tx(async () => {
    await db.lock('payments', { id: Number(paymentId) });
    const p = await db.byId('payments', paymentId);
    if (!p || (branchId && p.branch_id !== branchId)) throw notFound('Payment');
    if (!PAID_STATUSES.includes(p.status)) throw badRequest('Only successful payments can be refunded');
    const refundable = round2(Number(p.amount) - Number(p.refunded_amount));
    const amt = round2(amount ?? refundable);
    if (amt <= 0 || amt > refundable) throw badRequest(`Refund amount must be between ₹0.01 and ₹${refundable}`);
    let reference = `RF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    if (p.gateway === 'razorpay' && p.gateway_payment_id && razorpay()) {
      if (!gatewayRefund || gatewayRefund.amt !== amt) {
        const rf = await razorpay().payments.refund(p.gateway_payment_id, { amount: Math.round(amt * 100), notes: { reason: reason || '' } });
        gatewayRefund = { amt, id: rf.id };
      }
      reference = gatewayRefund.id;
    }
    const refunded = round2(Number(p.refunded_amount) + amt);
    if (refunded > Number(p.amount)) throw invalid('Refunded amount cannot exceed the payment amount');
    const status = refunded >= Number(p.amount) ? 'refunded' : 'partially_refunded';
    const upd = await db.findOneAndUpdate(
      'payments',
      { id: p.id },
      { $set: { refunded_amount: refunded, status, refund_reference: reference, refund_reason: reason || null } }
    );
    if (p.order_id) {
      await db.lock('orders', { id: p.order_id });
      const o = await db.byId('orders', p.order_id, { projection: { amount_paid: 1 } });
      if (o) {
        const left = round2(Number(o.amount_paid) - amt);
        await db.update('orders', { id: p.order_id }, {
          $set: { amount_paid: Math.max(left, 0), payment_status: left <= 0 ? 'refunded' : 'partially_refunded', updated_at: new Date() },
        });
      }
    }
    if (p.reservation_id) {
      const left = await reservationPaid(p.reservation_id);
      await db.update('reservations', { id: p.reservation_id }, { $set: { payment_status: left <= 0 ? 'refunded' : 'partially_refunded', updated_at: new Date() } });
    }
    return { payment: upd, amount: amt };
  });
  const u = result.payment.user_id != null ? await db.byId('users', result.payment.user_id, { projection: { id: 1, email: 1, phone: 1 } }) : null;
  const info = { user_id: u ? u.id : null, email: u ? u.email : null, phone: u ? u.phone : null };
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
  const ps = await db.find('payments', { order_id: Number(orderId), status: { $in: PAID_STATUSES } }, { projection: { id: 1 } });
  for (const p of ps) await refundPayment({ paymentId: p.id, reason, actor }).catch((e) => console.error('[refund] order', e.message));
}

export async function refundReservationAdvance(reservationId, actor, reason) {
  const ps = await db.find('payments', { reservation_id: Number(reservationId), status: { $in: PAID_STATUSES } }, { projection: { id: 1 } });
  for (const p of ps) await refundPayment({ paymentId: p.id, reason, actor }).catch((e) => console.error('[refund] reservation', e.message));
}

/** Create the GST invoice for an order (idempotent). */
export async function ensureInvoice(q, orderId) { // eslint-disable-line no-unused-vars
  const oid = Number(orderId);
  const existing = await db.findOne('invoices', { order_id: oid });
  if (existing) return existing;
  const o = await db.byId('orders', oid);
  if (!o) throw notFound('Order');
  if (o.status === 'cancelled') throw conflict('Cannot invoice a cancelled order');
  const d = new Date();
  const number = `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${String(o.id).padStart(6, '0')}`;
  const cgst = round2(Number(o.tax) / 2);
  // INSERT ... ON CONFLICT (order_id) DO UPDATE ... RETURNING * -> upsert keyed on the unique order_id.
  const id = await db.nextId('invoices');
  return db.findOneAndUpdate(
    'invoices',
    { order_id: o.id },
    {
      $setOnInsert: {
        id,
        invoice_number: number,
        branch_id: o.branch_id,
        order_id: o.id,
        reservation_id: o.reservation_id ?? null,
        customer_name: o.contact_name ?? null,
        subtotal: o.subtotal,
        discount: o.discount ?? 0,
        cgst,
        sgst: round2(Number(o.tax) - cgst),
        service_charge: o.service_charge ?? 0,
        delivery_charge: o.delivery_charge ?? 0,
        total: o.total,
        issued_at: new Date(),
      },
    },
    { upsert: true }
  );
}
