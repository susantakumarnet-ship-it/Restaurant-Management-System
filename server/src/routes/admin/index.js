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
    const branches =
      u.role === 'super_admin'
        ? await db.many(`SELECT b.id, b.name, b.city, r.id AS restaurant_id, r.name AS restaurant_name, r.logo_url FROM restaurant_branches b JOIN restaurants r ON r.id = b.restaurant_id ORDER BY r.id, b.id`)
        : await db.many(
            `SELECT b.id, b.name, b.city, r.id AS restaurant_id, r.name AS restaurant_name, r.logo_url FROM restaurant_branches b JOIN restaurants r ON r.id = b.restaurant_id
              WHERE b.restaurant_id = $1 AND ($2::int IS NULL OR b.id = $2) ORDER BY b.id`,
            [u.restaurant_id, u.branch_id]
          );
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
