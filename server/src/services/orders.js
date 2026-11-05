import { db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { localDate, makeCode, round2 } from '../utils/common.js';
import { getBranchConfig } from './booking.js';
import { notify } from './notify.js';

export const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'delivered', 'completed', 'cancelled'];
export const ORDER_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served', 'delivered', 'completed'],
  served: ['completed'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

const CI = { locale: 'en', strength: 2 }; // case-insensitive (replacement for upper(code) = upper($1))

/** FK existence check (PostgreSQL used to reject dangling references with 23503 -> 409 IN_USE). */
async function mustExist(col, id) {
  if (id == null) return;
  if (!(await db.exists(col, { id: Number(id) }))) {
    const e = new Error('This record is referenced by other data and cannot be removed or linked.');
    e.code = 'IN_USE';
    throw e;
  }
}

/** Validate a coupon for a subtotal. Returns { coupon, discount } or throws a 400 with the reason. */
export async function evaluateCoupon(q, { restaurantId, code, subtotal, customerId }) { // eslint-disable-line no-unused-vars
  const c = await db.findOne('coupons', { restaurant_id: Number(restaurantId), code: String(code).trim() }, { collation: CI });
  if (!c || !c.is_active) throw badRequest('Invalid coupon code');
  const today = localDate();
  if (c.valid_from && today < c.valid_from) throw badRequest('This coupon is not active yet');
  if (c.valid_to && today > c.valid_to) throw badRequest('This coupon has expired');
  if (subtotal < Number(c.min_order_amount)) throw badRequest(`Minimum order of ₹${Number(c.min_order_amount)} required for this coupon`);
  if (c.usage_limit != null && c.used_count >= c.usage_limit) throw badRequest('This coupon has reached its usage limit');
  if (c.per_user_limit != null && customerId) {
    const used = await db.count('orders', { coupon_id: c.id, customer_id: Number(customerId), status: { $ne: 'cancelled' } });
    if (used >= c.per_user_limit) throw badRequest('You have already used this coupon');
  }
  let discount = c.discount_type === 'percent' ? (subtotal * Number(c.discount_value)) / 100 : Number(c.discount_value);
  if (c.max_discount != null) discount = Math.min(discount, Number(c.max_discount));
  discount = round2(Math.min(discount, subtotal));
  return { coupon: c, discount };
}

/** Server-side pricing. Never trust prices from the client. */
export async function priceOrder(q, { branchId, items, couponCode, orderType, customerId }) {
  const cfg = await getBranchConfig(branchId, q);
  if (!items?.length) throw badRequest('Your cart is empty');
  if (!cfg.is_active) throw badRequest('This restaurant is not accepting orders right now');
  if (orderType === 'delivery' && !cfg.accepts_delivery) throw badRequest('This branch does not accept delivery orders');
  if (orderType === 'takeaway' && !cfg.accepts_takeaway) throw badRequest('This branch does not accept takeaway orders');

  const ids = [...new Set(items.map((i) => Number(i.food_item_id)))];
  const foods = await db.find('food_items', { id: { $in: ids }, restaurant_id: cfg.restaurant_id });
  const byId = new Map(foods.map((f) => [f.id, f]));
  const lines = items.map((i) => {
    const f = byId.get(Number(i.food_item_id));
    if (!f) throw badRequest('One of the items is no longer on the menu');
    if (!f.is_available) throw badRequest(`${f.name} is currently unavailable`);
    const unit = Number(f.discounted_price ?? f.price);
    return { food_item_id: f.id, name: f.name, unit_price: unit, quantity: i.quantity, line_total: round2(unit * i.quantity), notes: i.notes || null };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  let discount = 0;
  let coupon = null;
  if (couponCode) ({ coupon, discount } = await evaluateCoupon(q, { restaurantId: cfg.restaurant_id, code: couponCode, subtotal, customerId }));
  const taxable = round2(subtotal - discount);
  const serviceCharge = orderType === 'dine_in' ? round2((taxable * Number(cfg.service_charge_rate)) / 100) : 0;
  const deliveryCharge = orderType === 'delivery' ? Number(cfg.delivery_charge) : 0;
  if (orderType === 'delivery' && subtotal < Number(cfg.min_delivery_order)) throw badRequest(`Minimum order for delivery is ₹${cfg.min_delivery_order}`);
  const tax = round2(((taxable + serviceCharge) * Number(cfg.gst_rate)) / 100);
  const total = round2(taxable + serviceCharge + tax + deliveryCharge);
  return {
    lines,
    subtotal,
    discount,
    coupon: coupon ? { id: coupon.id, code: coupon.code, title: coupon.title } : null,
    gst_rate: Number(cfg.gst_rate),
    service_charge_rate: Number(cfg.service_charge_rate),
    tax,
    cgst: round2(tax / 2),
    sgst: round2(tax - round2(tax / 2)),
    service_charge: serviceCharge,
    delivery_charge: deliveryCharge,
    total,
    cfg,
  };
}

export async function getOrder(id, q = db) { // eslint-disable-line no-unused-vars
  const o = await db.byId('orders', id);
  if (!o) throw notFound('Order');
  const b = await db.byId('restaurant_branches', o.branch_id);
  if (!b) throw notFound('Order');
  const r = await db.byId('restaurants', b.restaurant_id);
  if (!r) throw notFound('Order');
  const t = o.table_id != null ? await db.byId('tables', o.table_id, { projection: { table_number: 1 } }) : null;
  const e = o.assigned_chef_id != null ? await db.byId('employees', o.assigned_chef_id, { projection: { name: 1 } }) : null;
  const cu = o.customer_id != null ? await db.byId('customers', o.customer_id, { projection: { user_id: 1 } }) : null;
  const u = cu?.user_id != null ? await db.byId('users', cu.user_id, { projection: { email: 1, name: 1 } }) : null;
  const inv = await db.findOne('invoices', { order_id: o.id }, { projection: { id: 1, invoice_number: 1 } });
  const items = await db.find('order_items', { order_id: o.id }, { sort: { id: 1 } });
  return {
    ...o,
    branch_name: b.name,
    branch_address: b.address,
    branch_phone: b.phone,
    restaurant_name: r.name,
    gstin: r.gstin,
    table_number: t ? t.table_number : null,
    chef_name: e ? e.name : null,
    user_id: cu ? cu.user_id : null,
    customer_email: u ? u.email : null,
    customer_name: u ? u.name : null,
    invoice_id: inv ? inv.id : null,
    invoice_number: inv ? inv.invoice_number : null,
    items,
  };
}

/**
 * Create an order (customer online order or staff POS order).
 * input: { order_type, items:[{food_item_id, quantity, notes}], coupon_code, contact_name, contact_phone,
 *          delivery_address, notes, table_id, reservation_id, payment_method }
 */
export async function createOrder({ branchId, input, actor, staff = false }) {
  const customerId = staff ? input.customer_id || null : actor.customer_id;
  if (!staff && !customerId) throw forbidden('Only customer accounts can place online orders');
  if (input.order_type === 'delivery' && !input.delivery_address) throw badRequest('Delivery address is required');
  const bid = Number(branchId);

  const created = await db.tx(async () => {
    const price = await priceOrder(db, { branchId, items: input.items, couponCode: input.coupon_code, orderType: input.order_type, customerId });
    if (input.table_id) {
      const tb = await db.findOne('tables', { id: Number(input.table_id), branch_id: bid }, { projection: { id: 1 } });
      if (!tb) throw badRequest('Invalid table');
    }
    if (input.reservation_id) {
      const rs = await db.findOne('reservations', { id: Number(input.reservation_id), branch_id: bid }, { projection: { id: 1, customer_id: 1 } });
      if (!rs || (!staff && rs.customer_id !== customerId)) throw badRequest('Invalid reservation for pre-order');
    }
    if (price.coupon) {
      // Atomic claim: only increments while below the usage limit.
      const upd = await db.findOneAndUpdate(
        'coupons',
        { id: price.coupon.id, $or: [{ usage_limit: null }, { $expr: { $lt: ['$used_count', '$usage_limit'] } }] },
        { $inc: { used_count: 1 } },
        { projection: { id: 1 } }
      );
      if (!upd) throw conflict('This coupon has just reached its usage limit');
    }
    await mustExist('customers', customerId);
    // A duplicate key inside a transaction aborts it, so pick a free code first (ON CONFLICT DO NOTHING retry).
    let code = makeCode('OD');
    for (let i = 0; i < 4 && (await db.exists('orders', { order_code: code })); i++) code = makeCode('OD');
    const order = await db.insert('orders', {
      order_code: code,
      branch_id: bid,
      customer_id: customerId != null ? Number(customerId) : null,
      reservation_id: input.reservation_id ? Number(input.reservation_id) : null,
      table_id: input.table_id ? Number(input.table_id) : null,
      order_type: input.order_type,
      status: staff ? 'confirmed' : 'pending',
      subtotal: price.subtotal,
      discount: price.discount,
      coupon_id: price.coupon?.id || null,
      coupon_code: price.coupon?.code || null,
      tax: price.tax,
      service_charge: price.service_charge,
      delivery_charge: price.delivery_charge,
      total: price.total,
      contact_name: input.contact_name || actor?.name || null,
      contact_phone: input.contact_phone || actor?.phone || null,
      delivery_address: input.delivery_address || null,
      notes: input.notes || null,
      payment_method: input.payment_method || null,
      created_by: actor?.id || null,
    });
    await db.insertMany(
      'order_items',
      price.lines.map((l) => ({
        order_id: order.id,
        food_item_id: l.food_item_id,
        name: l.name,
        unit_price: l.unit_price,
        quantity: l.quantity,
        line_total: l.line_total,
        notes: l.notes,
      }))
    );
    if (input.table_id && input.order_type === 'dine_in') await db.update('tables', { id: Number(input.table_id), status: 'available' }, { status: 'occupied' });
    return order;
  });

  const o = await getOrder(created.id);
  await notify({
    userId: o.user_id,
    branchId,
    adminFeed: !staff,
    type: 'order_placed',
    title: `Order placed - ${o.order_code}`,
    message: `Thank you! Your ${o.order_type.replace('_', '-')} order of ₹${o.total} has been received.`,
    email: o.customer_email,
    phone: o.contact_phone,
    channels: ['in_app', 'email'],
    link: `/my/orders/${o.id}`,
    adminLink: `/admin/orders?id=${o.id}`,
    adminTitle: `New ${o.order_type.replace('_', '-')} order - ${o.order_code}`,
    adminMessage: `${o.contact_name || 'Customer'} placed an order of ${o.items.length} item(s) for ₹${o.total} (${o.payment_method === 'cash' ? 'pay on delivery/pickup' : 'online payment'}).`,
  });
  return o;
}

const ORDER_MSG = {
  confirmed: (o) => [`Order confirmed - ${o.order_code}`, `Your order has been confirmed and will be prepared shortly.`],
  preparing: (o) => [`Being prepared - ${o.order_code}`, `Our chefs are preparing your order.`],
  ready: (o) => [`Order ready - ${o.order_code}`, o.order_type === 'delivery' ? 'Your order is ready and will be out for delivery soon.' : o.order_type === 'takeaway' ? 'Your order is ready for pickup!' : 'Your food is ready and will be served shortly.'],
  delivered: (o) => [`Order delivered - ${o.order_code}`, 'Your order has been delivered. Enjoy your meal!'],
  cancelled: (o) => [`Order cancelled - ${o.order_code}`, `Your order has been cancelled.${o.cancel_reason ? ' Reason: ' + o.cancel_reason : ''}`],
};

export async function changeOrderStatus({ id, status, actor, branchId, reason, byCustomer = false }) {
  if (!ORDER_STATUSES.includes(status)) throw badRequest('Invalid status');
  const o = await getOrder(id);
  if (branchId && o.branch_id !== branchId) throw notFound('Order');
  if (byCustomer) {
    if (o.user_id !== actor.id) throw notFound('Order');
    if (status !== 'cancelled' || !['pending', 'confirmed'].includes(o.status)) throw badRequest('This order can no longer be cancelled');
  }
  if (!ORDER_TRANSITIONS[o.status].includes(status)) throw badRequest(`Cannot change order from ${o.status} to ${status}`);
  if (status === 'served' && o.order_type !== 'dine_in') throw badRequest('Only dine-in orders can be marked served');
  if (status === 'delivered' && o.order_type !== 'delivery') throw badRequest('Only delivery orders can be marked delivered');
  const balance = Math.round((Number(o.total) - Number(o.amount_paid)) * 100) / 100;
  if (status === 'completed' && balance > 0) throw badRequest(`Collect the outstanding ₹${balance} before completing this order`);

  await db.tx(async () => {
    const set = { status, updated_at: new Date() };
    if (status === 'cancelled') set.cancel_reason = reason || null;
    // Guarded transition (replaces SELECT ... FOR UPDATE + status re-check).
    const moved = await db.findOneAndUpdate('orders', { id: o.id, status: o.status }, { $set: set }, { projection: { id: 1 } });
    if (!moved) throw conflict('Order was updated by someone else. Please refresh.');
    if (status === 'completed' && !o.loyalty_awarded && o.customer_id) {
      const awarded = await db.findOneAndUpdate('orders', { id: o.id, loyalty_awarded: { $ne: true } }, { $set: { loyalty_awarded: true } }, { projection: { id: 1 } });
      if (awarded) {
        const cfg = await getBranchConfig(o.branch_id);
        const points = Math.floor(Number(o.total) / 100) * cfg.loyalty_points_per_100;
        const cust = await db.byId('customers', o.customer_id, { projection: { total_spent: 1 } });
        if (cust) {
          await db.update(
            'customers',
            { id: o.customer_id },
            { $inc: { loyalty_points: points }, $set: { total_spent: round2(Number(cust.total_spent || 0) + Number(o.total)) } }
          );
        }
      }
    }
    if (status === 'cancelled' && o.coupon_id) await db.update('coupons', { id: o.coupon_id, used_count: { $gt: 0 } }, { $inc: { used_count: -1 } });
    if (['completed', 'cancelled'].includes(status) && o.table_id && o.order_type === 'dine_in') {
      const open = await db.count('orders', { table_id: o.table_id, id: { $ne: o.id }, status: { $nin: ['completed', 'cancelled'] } });
      const resIds = await db.distinct('reservation_tables', 'reservation_id', { table_id: o.table_id, active: true });
      const seated = resIds.length ? await db.count('reservations', { id: { $in: resIds }, status: 'seated' }) : 0;
      if (open === 0 && seated === 0) await db.update('tables', { id: o.table_id, status: 'occupied' }, { status: 'available' });
    }
  });

  if (status === 'cancelled' && Number(o.amount_paid) > 0) {
    const { refundOrderPayments } = await import('./payments.js');
    await refundOrderPayments(o.id, actor, reason || 'Order cancelled');
  }
  const updated = await getOrder(id);
  const msg = ORDER_MSG[status]?.(updated);
  if (msg) {
    await notify({
      userId: updated.user_id,
      branchId: updated.branch_id,
      adminFeed: byCustomer,
      type: `order_${status}`,
      title: msg[0],
      message: msg[1],
      email: ['confirmed', 'ready', 'cancelled'].includes(status) ? updated.customer_email : null,
      phone: ['ready', 'cancelled'].includes(status) ? updated.contact_phone : null,
      link: `/my/orders/${updated.id}`,
      adminLink: `/admin/orders?id=${updated.id}`,
      adminTitle: `Order ${status} by customer - ${updated.order_code}`,
      adminMessage: `${updated.contact_name || 'The customer'} ${status} order ${updated.order_code}.${reason ? ' Reason: ' + reason : ''}`,
    });
  }
  return updated;
}
