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
  // Upsert permissions (ON CONFLICT (code) DO UPDATE). Ids are allocated only for new codes.
  const permIds = new Map();
  for (const [code, [module, description]] of Object.entries(PERMISSIONS)) {
    let p = await db.findOneAndUpdate('permissions', { code }, { $set: { module, description } });
    if (!p) {
      const id = await db.nextId('permissions');
      try {
        p = await db.findOneAndUpdate('permissions', { code }, { $set: { module, description }, $setOnInsert: { id } }, { upsert: true });
      } catch (e) {
        if (e.code !== 11000) throw e; // concurrent startup inserted it first
        p = await db.findOne('permissions', { code });
      }
    }
    permIds.set(code, p.id);
  }
  // roles.manage is never granted to tenant roles (roles are shared across restaurants).
  const superAdmin = await db.findOne('roles', { name: 'super_admin' }, { projection: { id: 1 } });
  await db.remove('role_permissions', {
    permission_id: permIds.get('roles.manage'),
    ...(superAdmin ? { role_id: { $ne: superAdmin.id } } : {}),
  });
  for (const [name, r] of Object.entries(ROLES)) {
    const existing = await db.findOne('roles', { name }, { projection: { id: 1 } });
    if (existing) continue;
    const id = await db.nextId('roles');
    const role = await db.findOneAndUpdate(
      'roles',
      { name },
      { $setOnInsert: { id, name, display_name: r.display, is_staff: r.staff, is_system: true, description: null, created_at: new Date() } },
      { upsert: true, returnNew: false }
    );
    if (role) continue; // created concurrently by another process
    for (const code of r.perms) {
      const permission_id = permIds.get(code);
      if (permission_id == null) continue;
      await db.findOneAndUpdate('role_permissions', { role_id: id, permission_id }, { $setOnInsert: { role_id: id, permission_id } }, { upsert: true });
    }
  }
}
