import { Router } from 'express';
import { db } from '../../db/index.js';
import { ah } from '../../utils/http.js';
import { authenticate, branchScope, requireStaff } from '../../middleware/auth.js';
import { auditMutations } from '../../middleware/audit.js';
import { publicUser } from '../auth.js';
import { config } from '../../config.js';
import { providers } from '../../services/notify.js';
import restaurant from './restaurant.js';
import catalog from './catalog.js';
import operations from './operations.js';
import people from './people.js';
import finance from './finance.js';
import insights from './insights.js';

const r = Router();
r.use(authenticate, requireStaff);

/** Bootstrap for the admin app: who am I + which branches can I operate. (No branch header needed.) */
r.get(
  '/context',
  ah(async (req, res) => {
    const u = req.user;
    let filter = null;
    if (u.role === 'super_admin') filter = {};
    else if (u.restaurant_id != null) filter = u.branch_id != null ? { restaurant_id: u.restaurant_id, id: u.branch_id } : { restaurant_id: u.restaurant_id };
    const rows = filter ? await db.find('restaurant_branches', filter, { sort: { restaurant_id: 1, id: 1 }, projection: { id: 1, name: 1, city: 1, restaurant_id: 1 } }) : [];
    const restaurants = await db.mapByIds('restaurants', rows.map((b) => b.restaurant_id), { projection: { name: 1, logo_url: 1 } });
    // INNER JOIN restaurants; ORDER BY r.id, b.id (super admin) / b.id (single restaurant)
    const branches = rows
      .filter((b) => restaurants.has(b.restaurant_id))
      .map((b) => {
        const r = restaurants.get(b.restaurant_id);
        return { id: b.id, name: b.name, city: b.city ?? null, restaurant_id: r.id, restaurant_name: r.name, logo_url: r.logo_url ?? null };
      });
    res.json({
      user: publicUser(u),
      branches,
      integrations: { payments: config.payments.mode, email: providers.email(), sms: providers.sms(), whatsapp: providers.whatsapp() },
    });
  })
);

r.use(branchScope, auditMutations);
r.use(restaurant);
r.use(catalog);
r.use(operations);
r.use(people);
r.use(finance);
r.use(insights);

export default r;
