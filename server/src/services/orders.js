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

/** Validate a coupon for a subtotal. Returns { coupon, discount } or throws a 400 with the reason. */
export async function evaluateCoupon(q, { restaurantId, code, subtotal, customerId }) {
  const c = await q.one(`SELECT * FROM coupons WHERE restaurant_id = $1 AND upper(code) = upper($2)`, [restaurantId, code.trim()]);
  if (!c || !c.is_active) throw badRequest('Invalid coupon code');
  const today = localDate();
  if (c.valid_from && today < c.valid_from) throw badRequest('This coupon is not active yet');
  if (c.valid_to && today > c.valid_to) throw badRequest('This coupon has expired');
  if (subtotal < Number(c.min_order_amount)) throw badRequest(`Minimum order of ₹${Number(c.min_order_amount)} required for this coupon`);
  if (c.usage_limit != null && c.used_count >= c.usage_limit) throw badRequest('This coupon has reached its usage limit');
  if (c.per_user_limit != null && customerId) {
    const used = await q.one(`SELECT COUNT(*) AS n FROM orders WHERE coupon_id = $1 AND customer_id = $2 AND status <> 'cancelled'`, [c.id, customerId]);
    if (used.n >= c.per_user_limit) throw badRequest('You have already used this coupon');
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

  const ids = [...new Set(items.map((i) => i.food_item_id))];
  const foods = await q.many(`SELECT * FROM food_items WHERE id = ANY($1::int[]) AND restaurant_id = $2`, [ids, cfg.restaurant_id]);
  const byId = new Map(foods.map((f) => [f.id, f]));
  const lines = items.map((i) => {
    const f = byId.get(i.food_item_id);
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

export async function getOrder(id, q = db) {
  const o = await q.one(
    `SELECT o.*, b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
            r.name AS restaurant_name, r.gstin, t.table_number, e.name AS chef_name,
            cu.user_id, u.email AS customer_email, u.name AS customer_name,
            inv.id AS invoice_id, inv.invoice_number,
            COALESCE((SELECT json_agg(oi ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id), '[]'::json) AS items
       FROM orders o
       JOIN restaurant_branches b ON b.id = o.branch_id
       JOIN restaurants r ON r.id = b.restaurant_id
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN employees e ON e.id = o.assigned_chef_id
       LEFT JOIN customers cu ON cu.id = o.customer_id
       LEFT JOIN users u ON u.id = cu.user_id
       LEFT JOIN invoices inv ON inv.order_id = o.id
      WHERE o.id = $1`,
    [id]
  );
  if (!o) throw notFound('Order');
  return o;
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

  const created = await db.tx(async (t) => {
    const price = await priceOrder(t, { branchId, items: input.items, couponCode: input.coupon_code, orderType: input.order_type, customerId });
    if (input.table_id) {
      const tb = await t.one('SELECT id FROM tables WHERE id = $1 AND branch_id = $2', [input.table_id, branchId]);
      if (!tb) throw badRequest('Invalid table');
    }
    if (input.reservation_id) {
      const rs = await t.one('SELECT id, customer_id FROM reservations WHERE id = $1 AND branch_id = $2', [input.reservation_id, branchId]);
      if (!rs || (!staff && rs.customer_id !== customerId)) throw badRequest('Invalid reservation for pre-order');
    }
    if (price.coupon) {
      const upd = await t.one(
        `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit) RETURNING id`,
        [price.coupon.id]
      );
      if (!upd) throw conflict('This coupon has just reached its usage limit');
    }
    let order;
    for (let i = 0; i < 5 && !order; i++) {
      order = await t.one(
        `INSERT INTO orders(order_code, branch_id, customer_id, reservation_id, table_id, order_type, status, subtotal, discount,
             coupon_id, coupon_code, tax, service_charge, delivery_charge, total, contact_name, contact_phone, delivery_address,
             notes, payment_method, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (order_code) DO NOTHING RETURNING id`,
        [
          makeCode('OD'), branchId, customerId, input.reservation_id || null, input.table_id || null, input.order_type,
          staff ? 'confirmed' : 'pending', price.subtotal, price.discount, price.coupon?.id || null, price.coupon?.code || null,
          price.tax, price.service_charge, price.delivery_charge, price.total, input.contact_name || actor?.name || null,
          input.contact_phone || actor?.phone || null, input.delivery_address || null, input.notes || null,
          input.payment_method || null, actor?.id || null,
        ]
      );
    }
    for (const l of price.lines) {
      await t.query(
        `INSERT INTO order_items(order_id, food_item_id, name, unit_price, quantity, line_total, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.id, l.food_item_id, l.name, l.unit_price, l.quantity, l.line_total, l.notes]
      );
    }
    if (input.table_id && input.order_type === 'dine_in') await t.query(`UPDATE tables SET status = 'occupied' WHERE id = $1 AND status = 'available'`, [input.table_id]);
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

  await db.tx(async (t) => {
    const cur = await t.one('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (cur.status !== o.status) throw conflict('Order was updated by someone else. Please refresh.');
    await t.query(
      `UPDATE orders SET status = $2::varchar, cancel_reason = CASE WHEN $2::varchar = 'cancelled' THEN $3::text ELSE cancel_reason END, updated_at = now() WHERE id = $1`,
      [id, status, reason || null]
    );
    if (status === 'completed' && !o.loyalty_awarded && o.customer_id) {
      const cfg = await getBranchConfig(o.branch_id, t);
      const points = Math.floor(Number(o.total) / 100) * cfg.loyalty_points_per_100;
      await t.query(`UPDATE customers SET loyalty_points = loyalty_points + $2, total_spent = total_spent + $3 WHERE id = $1`, [o.customer_id, points, o.total]);
      await t.query('UPDATE orders SET loyalty_awarded = true WHERE id = $1', [id]);
    }
    if (status === 'cancelled' && o.coupon_id) await t.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1', [o.coupon_id]);
    if (['completed', 'cancelled'].includes(status) && o.table_id && o.order_type === 'dine_in') {
      const open = await t.one(`SELECT COUNT(*) AS n FROM orders WHERE table_id = $1 AND id <> $2 AND status NOT IN ('completed','cancelled')`, [o.table_id, id]);
      const seated = await t.one(
        `SELECT COUNT(*) AS n FROM reservation_tables rt JOIN reservations r ON r.id = rt.reservation_id WHERE rt.table_id = $1 AND rt.active AND r.status = 'seated'`,
        [o.table_id]
      );
      if (open.n === 0 && seated.n === 0) await t.query(`UPDATE tables SET status = 'available' WHERE id = $1 AND status = 'occupied'`, [o.table_id]);
    }
  });

  if (status === 'cancelled' && Number(o.amount_paid) > 0) {
    const { refundOrderPayments } = await import('./payments.js');
    await refundOrderPayments(id, actor, reason || 'Order cancelled');
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
