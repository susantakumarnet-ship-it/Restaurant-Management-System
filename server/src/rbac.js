/** Single source of truth for roles & permissions. Synced into the DB on every migrate. */
export const PERMISSIONS = {
  'dashboard.view': ['dashboard', 'View dashboard & analytics widgets'],
  'restaurant.manage': ['restaurant', 'Edit restaurant profile, branches and settings'],
  'tables.view': ['tables', 'View tables & live floor status'],
  'tables.manage': ['tables', 'Create / edit / delete tables and sections'],
  'menu.manage': ['menu', 'Manage food categories and items'],
  'reservations.view': ['reservations', 'View reservations'],
  'reservations.manage': ['reservations', 'Create, approve, modify and cancel reservations'],
  'orders.view': ['orders', 'View orders / kitchen board'],
  'orders.manage': ['orders', 'Create orders and update order status'],
  'payments.manage': ['payments', 'Record payments, refunds and invoices'],
  'customers.view': ['customers', 'View customers'],
  'customers.manage': ['customers', 'Update customer status & loyalty points'],
  'staff.manage': ['staff', 'Manage employees, shifts and attendance'],
  'roles.manage': ['staff', 'Edit role permissions'],
  'inventory.manage': ['inventory', 'Manage inventory, suppliers and stock movements'],
  'coupons.manage': ['coupons', 'Manage offers & coupons'],
  'reviews.manage': ['reviews', 'Moderate reviews'],
  'reports.view': ['reports', 'View and export reports'],
  'audit.view': ['audit', 'View audit logs'],
};

const ALL_BRANCH = Object.keys(PERMISSIONS);

export const ROLES = {
  super_admin: { display: 'Super Admin', staff: true, perms: ALL_BRANCH },
  // Roles are platform-wide, so editing role permissions (roles.manage) is reserved for super admins.
  restaurant_admin: { display: 'Restaurant Admin', staff: true, perms: ALL_BRANCH.filter((p) => p !== 'roles.manage') },
  manager: {
    display: 'Branch Manager',
    staff: true,
    perms: ALL_BRANCH.filter((p) => !['restaurant.manage', 'roles.manage', 'audit.view'].includes(p)),
  },
  waiter: {
    display: 'Waiter',
    staff: true,
    perms: ['dashboard.view', 'tables.view', 'reservations.view', 'reservations.manage', 'orders.view', 'orders.manage'],
  },
  chef: { display: 'Chef', staff: true, perms: ['orders.view', 'orders.manage', 'inventory.manage'] },
  cashier: {
    display: 'Cashier',
    staff: true,
    perms: ['dashboard.view', 'orders.view', 'orders.manage', 'payments.manage', 'customers.view', 'tables.view'],
  },
  customer: { display: 'Customer', staff: false, perms: [] },
};

export const STAFF_ROLES = Object.entries(ROLES)
  .filter(([, r]) => r.staff)
  .map(([k]) => k);

/** Insert missing roles/permissions. Existing role-permission edits made by admins are preserved. */
export async function syncRbac(db) {
  for (const [code, [module, description]] of Object.entries(PERMISSIONS)) {
    await db.query(
      `INSERT INTO permissions(code, module, description) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
      [code, module, description]
    );
  }
  // roles.manage is never granted to tenant roles (roles are shared across restaurants).
  await db.query(
    `DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'roles.manage')
       AND role_id IN (SELECT id FROM roles WHERE name <> 'super_admin')`
  );
  for (const [name, r] of Object.entries(ROLES)) {
    const existing = await db.one('SELECT id FROM roles WHERE name = $1', [name]);
    if (existing) continue;
    const role = await db.one(
      `INSERT INTO roles(name, display_name, is_staff, is_system) VALUES ($1,$2,$3,true) RETURNING id`,
      [name, r.display, r.staff]
    );
    if (r.perms.length) {
      await db.query(
        `INSERT INTO role_permissions(role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
        [role.id, r.perms]
      );
    }
  }
}
