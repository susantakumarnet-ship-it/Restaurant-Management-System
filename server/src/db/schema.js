/**
 * MongoDB collection registry - the MongoDB equivalent of the old SQL schema.
 *
 * For every collection:
 *   autoId   - documents get an integer `id` from the `counters` collection (default true)
 *   defaults - column defaults applied by db.insert(); functions are evaluated per insert
 *   refs     - foreign keys { field: [targetCollection, onDelete] } with onDelete in
 *              'cascade' | 'set_null' | 'restrict'. Enforced by db.remove().
 *   indexes  - [keys, options] pairs created by ensureIndexes()
 *
 * Value conventions (identical to what the PostgreSQL API used to return):
 *   TIMESTAMPTZ columns (created_at, paid_at, ...)   -> JS Date
 *   TIMESTAMP local columns (start_at, end_at)       -> string 'YYYY-MM-DDTHH:mm:ss'
 *   DATE columns (booking_date, valid_to, ...)       -> string 'YYYY-MM-DD'
 *   TIME columns (opening_time, start_time, ...)     -> string 'HH:mm:ss'
 *   NUMERIC columns                                  -> JS number
 *   JSONB columns                                    -> native arrays / objects
 */

const now = () => new Date();
const ci = { collation: { locale: 'en', strength: 2 } }; // case-insensitive
const partialNotNull = (field, type = 'string') => ({ partialFilterExpression: { [field]: { $type: type } } });

export const COLLECTIONS = {
  roles: {
    defaults: { description: null, is_staff: false, is_system: false, created_at: now },
    indexes: [[{ name: 1 }, { unique: true }]],
  },
  permissions: {
    defaults: { description: null },
    indexes: [[{ code: 1 }, { unique: true }]],
  },
  role_permissions: {
    autoId: false,
    refs: { role_id: ['roles', 'cascade'], permission_id: ['permissions', 'cascade'] },
    indexes: [[{ role_id: 1, permission_id: 1 }, { unique: true }], [{ permission_id: 1 }]],
  },
  restaurants: {
    defaults: {
      logo_url: null, cover_url: null, description: null, cuisine: null, email: null, phone: null, website: null, gstin: null,
      subscription_plan: 'basic', subscription_status: 'active', subscription_expires_at: null, is_active: true,
      created_at: now, updated_at: now,
    },
    indexes: [[{ slug: 1 }, { unique: true }]],
  },
  restaurant_branches: {
    refs: { restaurant_id: ['restaurants', 'cascade'] },
    defaults: {
      address: null, city: null, state: null, postal_code: null, latitude: null, longitude: null, map_url: null, phone: null, email: null,
      opening_time: '11:00:00', closing_time: '23:00:00', weekly_holidays: () => [], images: () => [], is_active: true,
      created_at: now, updated_at: now,
    },
    indexes: [[{ restaurant_id: 1 }]],
  },
  restaurant_settings: {
    refs: { branch_id: ['restaurant_branches', 'cascade'] },
    defaults: {
      reservation_duration_min: 90, buffer_min: 15, slot_interval_min: 30, min_guests: 1, max_guests: 20, max_advance_days: 60,
      min_notice_minutes: 60, cancellation_deadline_hours: 2, auto_confirm: false, advance_payment_required: false,
      advance_payment_amount: 0, gst_rate: 5, service_charge_rate: 0, delivery_charge: 40, min_delivery_order: 0,
      accepts_delivery: true, accepts_takeaway: true, loyalty_points_per_100: 5, currency: 'INR', booking_policy: null, updated_at: now,
    },
    indexes: [[{ branch_id: 1 }, { unique: true }]],
  },
  system_settings: {
    autoId: false,
    defaults: { updated_at: now },
    indexes: [[{ key: 1 }, { unique: true }]],
  },
  users: {
    refs: { role_id: ['roles', 'restrict'], restaurant_id: ['restaurants', 'set_null'], branch_id: ['restaurant_branches', 'set_null'] },
    defaults: {
      restaurant_id: null, branch_id: null, phone: null, password_hash: null, google_id: null, avatar_url: null,
      is_active: true, email_verified: false, phone_verified: false, last_login_at: null, created_at: now, updated_at: now,
    },
    indexes: [
      [{ email: 1 }, { unique: true, name: 'uq_users_email', ...ci }],
      [{ phone: 1 }, { unique: true, name: 'uq_users_phone', ...partialNotNull('phone') }],
      [{ google_id: 1 }, { unique: true, name: 'uq_users_google_id', ...partialNotNull('google_id') }],
      [{ role_id: 1 }],
      [{ restaurant_id: 1 }],
    ],
  },
  otp_codes: {
    refs: { user_id: ['users', 'cascade'] },
    defaults: { attempts: 0, used_at: null, created_at: now },
    indexes: [[{ user_id: 1, purpose: 1 }]],
  },
  customers: {
    refs: { user_id: ['users', 'cascade'] },
    defaults: { loyalty_points: 0, total_spent: 0, date_of_birth: null, anniversary: null, address: null, notes: null, status: 'active', created_at: now },
    indexes: [[{ user_id: 1 }, { unique: true }]],
  },
  table_sections: {
    refs: { branch_id: ['restaurant_branches', 'cascade'] },
    defaults: { location_type: 'indoor', description: null, is_active: true },
    indexes: [[{ branch_id: 1, name: 1 }, { unique: true }]],
  },
  tables: {
    refs: { branch_id: ['restaurant_branches', 'cascade'], section_id: ['table_sections', 'set_null'] },
    defaults: { section_id: null, name: null, min_capacity: 1, table_type: '4_seater', status: 'available', maintenance_note: null, is_active: true, created_at: now },
    indexes: [[{ branch_id: 1, table_number: 1 }, { unique: true, name: 'uq_tables_table_number' }], [{ branch_id: 1, is_active: 1 }]],
  },
  food_categories: {
    refs: { restaurant_id: ['restaurants', 'cascade'] },
    defaults: { description: null, image_url: null, sort_order: 0, is_active: true },
    indexes: [[{ restaurant_id: 1, name: 1 }, { unique: true }]],
  },
  food_items: {
    refs: { restaurant_id: ['restaurants', 'cascade'], category_id: ['food_categories', 'restrict'] },
    defaults: {
      description: null, discounted_price: null, diet_type: 'veg', is_available: true, prep_time_min: 15, is_bestseller: false,
      is_recommended: false, spice_level: 0, ingredients: null, allergens: null, avg_rating: 0, rating_count: 0, created_at: now, updated_at: now,
    },
    indexes: [[{ restaurant_id: 1, category_id: 1 }]],
  },
  food_images: {
    refs: { food_item_id: ['food_items', 'cascade'] },
    defaults: { is_primary: false, sort_order: 0 },
    indexes: [[{ food_item_id: 1 }]],
  },
  coupons: {
    refs: { restaurant_id: ['restaurants', 'cascade'] },
    defaults: {
      description: null, min_order_amount: 0, max_discount: null, valid_from: null, valid_to: null, usage_limit: null, per_user_limit: null,
      used_count: 0, is_public: true, is_active: true, image_url: null, created_at: now,
    },
    indexes: [[{ restaurant_id: 1, code: 1 }, { unique: true, name: 'uq_coupons_code', ...ci }]],
  },
  reservations: {
    refs: {
      branch_id: ['restaurant_branches', 'cascade'], customer_id: ['customers', 'set_null'],
      section_id: ['table_sections', 'set_null'], created_by: ['users', 'set_null'],
    },
    defaults: {
      customer_id: null, email: null, section_id: null, seating_preference: null, occasion: null, special_requests: null,
      status: 'pending', source: 'online', advance_amount: 0, payment_status: 'not_required', admin_notes: null,
      cancel_reason: null, cancelled_at: null, reminder_sent_at: null, created_by: null, created_at: now, updated_at: now,
    },
    indexes: [
      [{ booking_code: 1 }, { unique: true, name: 'uq_reservations_booking_code' }],
      [{ branch_id: 1, booking_date: 1 }], [{ customer_id: 1 }], [{ branch_id: 1, status: 1 }],
    ],
  },
  reservation_tables: {
    autoId: false,
    refs: { reservation_id: ['reservations', 'cascade'], table_id: ['tables', 'cascade'] },
    defaults: { active: true },
    indexes: [[{ reservation_id: 1, table_id: 1 }, { unique: true }], [{ table_id: 1, start_at: 1, end_at: 1 }]],
  },
  reservation_status_history: {
    refs: { reservation_id: ['reservations', 'cascade'], changed_by: ['users', 'set_null'] },
    defaults: { from_status: null, note: null, changed_by: null, created_at: now },
    indexes: [[{ reservation_id: 1 }]],
  },
  employees: {
    refs: { branch_id: ['restaurant_branches', 'cascade'], user_id: ['users', 'set_null'] },
    defaults: { user_id: null, email: null, phone: null, salary: null, hire_date: null, status: 'active', address: null, created_at: now },
    indexes: [[{ branch_id: 1, position: 1 }], [{ user_id: 1 }, { unique: true, ...partialNotNull('user_id', 'number') }]],
  },
  staff_shifts: {
    refs: { employee_id: ['employees', 'cascade'] },
    defaults: { attendance_status: 'scheduled', check_in_at: null, check_out_at: null, notes: null },
    indexes: [[{ employee_id: 1, shift_date: 1, start_time: 1 }, { unique: true }], [{ shift_date: 1 }]],
  },
  orders: {
    refs: {
      branch_id: ['restaurant_branches', 'cascade'], customer_id: ['customers', 'set_null'], reservation_id: ['reservations', 'set_null'],
      table_id: ['tables', 'set_null'], assigned_chef_id: ['employees', 'set_null'], coupon_id: ['coupons', 'set_null'], created_by: ['users', 'set_null'],
    },
    defaults: {
      customer_id: null, reservation_id: null, table_id: null, assigned_chef_id: null, status: 'pending', payment_status: 'pending',
      payment_method: null, subtotal: 0, discount: 0, coupon_id: null, coupon_code: null, tax: 0, service_charge: 0, delivery_charge: 0,
      total: 0, amount_paid: 0, contact_name: null, contact_phone: null, delivery_address: null, notes: null, cancel_reason: null,
      loyalty_awarded: false, created_by: null, created_at: now, updated_at: now,
    },
    indexes: [
      [{ order_code: 1 }, { unique: true, name: 'uq_orders_order_code' }],
      [{ branch_id: 1, created_at: -1 }], [{ customer_id: 1 }], [{ branch_id: 1, status: 1 }],
    ],
  },
  order_items: {
    refs: { order_id: ['orders', 'cascade'], food_item_id: ['food_items', 'set_null'] },
    defaults: { notes: null },
    indexes: [[{ order_id: 1 }], [{ food_item_id: 1 }]],
  },
  payments: {
    refs: {
      branch_id: ['restaurant_branches', 'cascade'], order_id: ['orders', 'set_null'], reservation_id: ['reservations', 'set_null'],
      user_id: ['users', 'set_null'], recorded_by: ['users', 'set_null'],
    },
    defaults: {
      order_id: null, reservation_id: null, user_id: null, status: 'pending', is_partial: false, purpose: 'order', gateway: null,
      gateway_order_id: null, gateway_payment_id: null, refunded_amount: 0, refund_reference: null, refund_reason: null, notes: null,
      recorded_by: null, paid_at: null, created_at: now,
    },
    indexes: [
      [{ payment_code: 1 }, { unique: true, name: 'uq_payments_payment_code' }],
      [{ branch_id: 1, created_at: -1 }], [{ order_id: 1 }], [{ reservation_id: 1 }],
      [{ gateway_order_id: 1 }, { unique: true, name: 'uq_payments_gateway_order', ...partialNotNull('gateway_order_id') }],
    ],
  },
  invoices: {
    refs: { branch_id: ['restaurant_branches', 'cascade'], order_id: ['orders', 'set_null'], reservation_id: ['reservations', 'set_null'] },
    defaults: {
      order_id: null, reservation_id: null, customer_name: null, discount: 0, cgst: 0, sgst: 0, service_charge: 0, delivery_charge: 0, issued_at: now,
    },
    indexes: [
      [{ invoice_number: 1 }, { unique: true, name: 'uq_invoices_invoice_number' }],
      [{ order_id: 1 }, { unique: true, name: 'uq_invoices_order', ...partialNotNull('order_id', 'number') }],
      [{ branch_id: 1, issued_at: -1 }],
    ],
  },
  reviews: {
    refs: {
      user_id: ['users', 'cascade'], branch_id: ['restaurant_branches', 'cascade'], food_item_id: ['food_items', 'cascade'], order_id: ['orders', 'set_null'],
    },
    defaults: { food_item_id: null, order_id: null, comment: null, images: () => [], is_published: true, admin_reply: null, created_at: now },
    indexes: [[{ branch_id: 1, created_at: -1 }], [{ food_item_id: 1 }]],
  },
  suppliers: {
    refs: { restaurant_id: ['restaurants', 'cascade'] },
    defaults: { contact_person: null, phone: null, email: null, address: null, gstin: null, is_active: true, created_at: now },
    indexes: [[{ restaurant_id: 1 }]],
  },
  inventory_items: {
    refs: { branch_id: ['restaurant_branches', 'cascade'], supplier_id: ['suppliers', 'set_null'] },
    defaults: {
      supplier_id: null, sku: null, category: null, unit: 'kg', quantity: 0, min_quantity: 0, cost_per_unit: 0, expiry_date: null, is_active: true, created_at: now,
    },
    indexes: [[{ branch_id: 1, name: 1 }, { unique: true }]],
  },
  inventory_transactions: {
    refs: { inventory_item_id: ['inventory_items', 'cascade'], supplier_id: ['suppliers', 'set_null'], created_by: ['users', 'set_null'] },
    defaults: { unit_cost: null, total_cost: null, supplier_id: null, reference: null, notes: null, created_by: null, created_at: now },
    indexes: [[{ inventory_item_id: 1, created_at: -1 }]],
  },
  notifications: {
    refs: { user_id: ['users', 'cascade'], branch_id: ['restaurant_branches', 'cascade'] },
    defaults: {
      user_id: null, branch_id: null, channel: 'in_app', recipient: null, status: 'sent', error: null, link: null, is_read: false, created_at: now,
    },
    indexes: [[{ user_id: 1, is_read: 1, created_at: -1 }], [{ branch_id: 1, created_at: -1 }]],
  },
  audit_logs: {
    refs: { user_id: ['users', 'set_null'], branch_id: ['restaurant_branches', 'set_null'] },
    defaults: { user_id: null, branch_id: null, entity: null, entity_id: null, details: null, ip: null, created_at: now },
    indexes: [[{ created_at: -1 }], [{ branch_id: 1, created_at: -1 }]],
  },
};

/** Reverse FK map: target collection -> [{ collection, field, onDelete }]. */
export const INBOUND = {};
for (const [name, def] of Object.entries(COLLECTIONS)) {
  for (const [field, [target, onDelete]] of Object.entries(def.refs || {})) {
    (INBOUND[target] ||= []).push({ collection: name, field, onDelete });
  }
}
