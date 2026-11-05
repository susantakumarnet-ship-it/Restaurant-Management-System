/**
 * Demo data. Run:  npm run seed      (adds data to an empty DB)
 *                  npm run db:reset  (drops everything, migrates, seeds)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { db, initDb } from './index.js';
import { migrate } from './migrate.js';
import { addMinutes, localDate, localIso, parseLocal, round2 } from '../utils/common.js';

// Deterministic PRNG so demo data is stable between runs.
let seedState = 42;
const rand = () => ((seedState = (seedState * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

const U = (id, w = 800) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

const MENU = {
  Starters: [
    ['Paneer Tikka', 'Cottage cheese cubes marinated in yogurt & spices, chargrilled in the tandoor.', 320, 289, 'veg', 'photo-1599487488170-d11ec9c172f0', { best: 1, spice: 2, allergens: 'Dairy' }],
    ['Crispy Vegetable Samosa', 'Golden pastry filled with spiced potatoes and peas, served with tamarind chutney.', 180, null, 'vegan', 'photo-1601050690597-df0568f70950', { spice: 1, allergens: 'Gluten' }],
    ['Tandoori Chicken Wings', 'Smoky wings glazed with a tangy tandoori masala.', 380, null, 'non_veg', 'photo-1527477396000-e27163b481c2', { best: 1, spice: 2 }],
    ['Prawn Koliwada', 'Mumbai-style crispy fried prawns with garlic dip.', 520, 469, 'non_veg', 'photo-1565680018434-b513d5e5fd47', { rec: 1, spice: 2, allergens: 'Shellfish, Gluten' }],
  ],
  'Soups & Salads': [
    ['Roasted Tomato Shorba', 'Slow-roasted tomato soup with cumin and fresh coriander.', 190, null, 'vegan', 'photo-1547592166-23ac45744acd', {}],
    ['Garden Buddha Bowl', 'Quinoa, chickpeas, avocado, greens and lemon-tahini dressing.', 340, null, 'vegan', 'photo-1512621776951-a57141f2eefd', { rec: 1, allergens: 'Sesame' }],
    ['Mediterranean Salad', 'Crisp greens, feta, olives, cucumber and herb vinaigrette.', 310, null, 'veg', 'photo-1540189549336-e6e99c3679fe', { allergens: 'Dairy' }],
  ],
  'Main Course': [
    ['Butter Chicken', 'Tandoori chicken simmered in a velvety tomato-butter gravy.', 460, null, 'non_veg', 'photo-1603894584373-5ac82b2ae398', { best: 1, spice: 1, allergens: 'Dairy, Nuts' }],
    ['Paneer Butter Masala', 'Soft paneer in a rich, mildly spiced makhani gravy.', 390, null, 'veg', 'photo-1631452180519-c014fe946bc7', { best: 1, spice: 1, allergens: 'Dairy, Nuts' }],
    ['Dal Makhani', 'Black lentils slow-cooked overnight with butter and cream.', 320, null, 'veg', 'photo-1546833999-b9f581a1996d', { rec: 1, allergens: 'Dairy' }],
    ['Chana Masala', 'Chickpeas in a robust onion-tomato masala.', 290, null, 'vegan', 'photo-1585937421612-70a008356fbe', { spice: 2 }],
    ['Grilled Fish with Lemon Butter', 'Catch of the day, herb crust, lemon butter sauce, sauteed greens.', 640, 590, 'non_veg', 'photo-1519708227418-c8fd9a32b7a2', { rec: 1, allergens: 'Fish, Dairy' }],
    ['Peppercorn Tenderloin', 'Grilled tenderloin, peppercorn jus, mash and seasonal veg.', 790, null, 'non_veg', 'photo-1600891964599-f61ba0e24092', { allergens: 'Dairy' }],
    ['Penne Arrabbiata', 'Penne tossed in a spicy garlic-tomato sauce with basil.', 360, null, 'vegan', 'photo-1621996346565-e3dbc646d9a9', { spice: 2, allergens: 'Gluten' }],
  ],
  'Biryani & Rice': [
    ['Hyderabadi Chicken Biryani', 'Fragrant basmati layered with spiced chicken, dum-cooked in a sealed handi.', 480, 449, 'non_veg', 'photo-1563379091339-03b21ab4a4f8', { best: 1, spice: 2 }],
    ['Subz Dum Biryani', 'Seasonal vegetables and basmati with saffron and fried onions.', 380, null, 'veg', 'photo-1589302168068-964664d93dc0', { spice: 1, allergens: 'Dairy' }],
    ['Jeera Rice', 'Basmati tempered with cumin and ghee.', 190, null, 'veg', 'photo-1516684732162-798a0062be99', { allergens: 'Dairy' }],
  ],
  Breads: [
    ['Butter Naan', 'Soft tandoor-baked bread brushed with butter.', 70, null, 'veg', 'photo-1565557623262-b51c2513a641', { best: 1, allergens: 'Gluten, Dairy' }],
    ['Garlic Naan', 'Naan topped with garlic and coriander.', 90, null, 'veg', 'photo-1600628421055-4d30de868b8f', { allergens: 'Gluten, Dairy' }],
    ['Tandoori Roti', 'Whole-wheat bread from the clay oven.', 50, null, 'vegan', 'photo-1626074353765-517a681e40be', { allergens: 'Gluten' }],
  ],
  'Pizza & Burgers': [
    ['Margherita Pizza', 'San Marzano tomato, fresh mozzarella and basil on a wood-fired crust.', 420, null, 'veg', 'photo-1565299624946-b28f40a0ae38', { rec: 1, allergens: 'Gluten, Dairy' }],
    ['Smoky BBQ Chicken Burger', 'Grilled chicken, BBQ glaze, cheddar, slaw, brioche bun, fries.', 410, null, 'non_veg', 'photo-1568901346375-23c9450c58cd', { allergens: 'Gluten, Dairy, Egg' }],
  ],
  Desserts: [
    ['Chocolate Lava Cake', 'Warm molten chocolate cake with vanilla ice cream.', 280, null, 'veg', 'photo-1606313564200-e75d5e30476c', { best: 1, allergens: 'Gluten, Dairy, Egg' }],
    ['Kulfi Falooda', 'Saffron-pistachio kulfi with vermicelli, basil seeds and rose syrup.', 240, null, 'veg', 'photo-1563805042-7684c019e1cb', { rec: 1, allergens: 'Dairy, Nuts' }],
    ['Berry Cheesecake', 'Baked New York cheesecake with mixed berry compote.', 310, null, 'veg', 'photo-1488477181946-6428a0291777', { allergens: 'Gluten, Dairy, Egg' }],
  ],
  Beverages: [
    ['Mango Lassi', 'Thick yogurt smoothie with Alphonso mango.', 160, null, 'veg', 'photo-1571934811356-5cc061b6821f', { best: 1, allergens: 'Dairy' }],
    ['Fresh Lime Soda', 'Sweet, salted or mixed - always refreshing.', 110, null, 'vegan', 'photo-1556679343-c7306c1976bc', {}],
    ['Cold-Pressed Orange Juice', 'Freshly pressed, nothing added.', 170, null, 'vegan', 'photo-1497534446932-c925b458314e', {}],
    ['Signature Mocktail', 'Passion fruit, mint and ginger fizz.', 220, null, 'vegan', 'photo-1544145945-f90425340c7e', { rec: 1 }],
    ['Filter Coffee', 'South Indian decoction coffee with frothy milk.', 120, null, 'veg', 'photo-1509042239860-f550ce710b93', { allergens: 'Dairy' }],
  ],
};

const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Isha', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Aditya', 'Priya', 'Nikhil', 'Kavya', 'Rahul', 'Neha', 'Siddharth', 'Tara', 'Dev', 'Riya'];
const LAST = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Singh', 'Menon', 'Das', 'Kapoor', 'Rao', 'Joshi'];
const COMMENTS = [
  'Amazing food and warm service. The butter chicken is a must-try!',
  'Lovely ambience on the rooftop. Will definitely come back.',
  'Great biryani, generous portions. Slight wait on a busy Saturday.',
  'Perfect place for our anniversary dinner. Staff arranged a cake for us!',
  'Food was good but the dessert could be better.',
  'Fresh ingredients, beautifully plated. Highly recommended.',
  'Quick delivery and the food arrived hot. Packaging was excellent.',
  'Best paneer tikka in town!',
];

export async function seed({ log = console.log } = {}) {
  const pass = await bcrypt.hash('Admin@123', 10);
  const custPass = await bcrypt.hash('Customer@123', 10);
  const role = async (name) => (await db.one('SELECT id FROM roles WHERE name = $1', [name])).id;
  const R = {};
  for (const n of ['super_admin', 'restaurant_admin', 'manager', 'waiter', 'chef', 'cashier', 'customer']) R[n] = await role(n);

  const user = (roleId, name, email, phone, hash, restaurantId = null, branchId = null) =>
    db.one(
      `INSERT INTO users(role_id, restaurant_id, branch_id, name, email, phone, password_hash, email_verified, phone_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,true) RETURNING id`,
      [roleId, restaurantId, branchId, name, email, phone, hash]
    );

  await user(R.super_admin, 'Platform Owner', 'super@smartrms.com', '9000000001', pass);
  await db.query(`INSERT INTO system_settings(key, value) VALUES ('platform_name', '"Smart RMS"'), ('support_email', '"support@smartrms.com"'), ('default_currency', '"INR"'), ('maintenance_mode', 'false')`);

  // ---------- Restaurants ----------
  const restaurants = [
    {
      name: 'ROOFTOP LONDON CAFE & RESTAURANT', slug: 'rooftop-london-cafe-restaurant', cuisine: 'Modern Indian, Continental', plan: 'pro',
      description: 'A contemporary dining room celebrating regional Indian flavours with a modern twist. Fresh, seasonal ingredients, a clay-oven tandoor and a rooftop lounge with city views.',
      logo: U('photo-1555396273-367ea4eb4db5', 300), cover: U('photo-1517248135467-4c7edcad34c4', 1600),
      email: 'hello@saffronsage.in', phone: '099384 85755', gstin: '29ABCDE1234F1Z5', admin: ['Anita Rao', 'admin@saffronsage.com', '9000000002'],
      branches: [
        { name: 'Trisulia, Kataka', address: 'BAZAR, near ANDHRA BANK, Trisulia', city: 'Kataka', state: 'Odisha', postal: '754005', lat: null, lng: null, phone: '099384 85755', images: ['photo-1517248135467-4c7edcad34c4', 'photo-1414235077428-338989a2e8c0', 'photo-1552566626-52f8b828add9', 'photo-1559339352-11d035aa65de'] },
        { name: 'Bandra West, Mumbai', address: '45, Hill Road, Bandra West', city: 'Mumbai', state: 'Maharashtra', postal: '400050', lat: 19.0544, lng: 72.8402, phone: '+912226401234', images: ['photo-1590846406792-0adc7f938f1d', 'photo-1414235077428-338989a2e8c0'] },
      ],
    },
    {
      name: 'The Coastal Grill', slug: 'the-coastal-grill', cuisine: 'Seafood, Grill', plan: 'basic',
      description: 'Fresh catch from the Konkan coast, grilled over charcoal. Relaxed beach-house vibes.',
      logo: U('photo-1559339352-11d035aa65de', 300), cover: U('photo-1552566626-52f8b828add9', 1600),
      email: 'eat@coastalgrill.in', phone: '+918322345678', gstin: '30ABCDE9876K1Z2', admin: ['Ravi Menon', 'admin@coastalgrill.com', '9000000003'],
      branches: [{ name: 'Calangute, Goa', address: 'Beach Road, Calangute', city: 'Goa', state: 'Goa', postal: '403516', lat: 15.5439, lng: 73.7553, phone: '+918322345678', images: ['photo-1552566626-52f8b828add9'] }],
    },
  ];

  const branchIds = [];
  let firstRestaurantId = null;
  for (const [ri, rs] of restaurants.entries()) {
    const rest = await db.one(
      `INSERT INTO restaurants(name, slug, description, cuisine, email, phone, gstin, logo_url, cover_url, subscription_plan, subscription_status, subscription_expires_at, website)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active', CURRENT_DATE + 300, $11) RETURNING id`,
      [rs.name, rs.slug, rs.description, rs.cuisine, rs.email, rs.phone, rs.gstin, rs.logo, rs.cover, rs.plan, `https://${rs.slug}.example.com`]
    );
    if (ri === 0) firstRestaurantId = rest.id;
    await user(R.restaurant_admin, rs.admin[0], rs.admin[1], rs.admin[2], pass, rest.id);

    // menu
    let sort = 0;
    const foodIds = [];
    for (const [cat, items] of Object.entries(MENU)) {
      if (ri === 1 && !['Starters', 'Main Course', 'Desserts', 'Beverages'].includes(cat)) continue;
      const c = await db.one(`INSERT INTO food_categories(restaurant_id, name, sort_order, image_url) VALUES ($1,$2,$3,$4) RETURNING id`, [rest.id, cat, sort++, U(items[0][5], 400)]);
      for (const [name, desc, price, disc, diet, img, o] of items) {
        const f = await db.one(
          `INSERT INTO food_items(restaurant_id, category_id, name, description, price, discounted_price, diet_type, prep_time_min, is_bestseller, is_recommended, spice_level, ingredients, allergens)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, price, discounted_price, name`,
          [rest.id, c.id, name, desc, price, disc, diet, between(10, 30), !!o.best, !!o.rec, o.spice || 0, desc.split(/,| with | and /).slice(0, 4).join(', '), o.allergens || null]
        );
        await db.query('INSERT INTO food_images(food_item_id, url, is_primary) VALUES ($1,$2,true)', [f.id, U(img)]);
        foodIds.push(f);
      }
    }

    await db.query(
      `INSERT INTO coupons(restaurant_id, code, title, description, discount_type, discount_value, min_order_amount, max_discount, valid_from, valid_to, per_user_limit, image_url) VALUES
       ($1,'WELCOME20','20% off your first order','New here? Enjoy 20% off (up to Rs.150).','percent',20,300,150,CURRENT_DATE - 30, CURRENT_DATE + 120, 1, $2),
       ($1,'FLAT100','Flat Rs.100 off','Flat Rs.100 off on orders above Rs.799.','flat',100,799,NULL,CURRENT_DATE - 10, CURRENT_DATE + 60, NULL, $3),
       ($1,'WEEKEND15','Weekend feast - 15% off','15% off on all orders, max Rs.250.','percent',15,500,250,CURRENT_DATE - 5, CURRENT_DATE + 90, 3, $4)`,
      [rest.id, U('photo-1504674900247-0877df9cc836', 600), U('photo-1414235077428-338989a2e8c0', 600), U('photo-1555939594-58d7cb561ad1', 600)]
    );

    const supplierIds = [];
    for (const [n, cp, ph] of [['FreshFarm Produce', 'Mahesh K', '+919845012345'], ['Ocean Catch Seafood', 'Joseph D', '+919822012345'], ['Amul Dairy Distributors', 'Sunita P', '+919900012345'], ['Spice Route Traders', 'Imran S', '+919886012345']]) {
      supplierIds.push((await db.one(`INSERT INTO suppliers(restaurant_id, name, contact_person, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [rest.id, n, cp, ph, `${n.split(' ')[0].toLowerCase()}@supplier.in`])).id);
    }

    for (const [bi, b] of rs.branches.entries()) {
      const br = await db.one(
        `INSERT INTO restaurant_branches(restaurant_id, name, address, city, state, postal_code, latitude, longitude, phone, email, opening_time, closing_time, weekly_holidays, images, map_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'11:00','23:00',$11::text::jsonb,$12::text::jsonb,$13) RETURNING id`,
        [rest.id, b.name, b.address, b.city, b.state, b.postal, b.lat, b.lng, b.phone, rs.email, JSON.stringify(ri === 1 ? [1] : []), JSON.stringify(b.images.map((i) => U(i, 1200))), `https://www.google.com/maps?q=${b.lat != null ? `${b.lat},${b.lng}` : encodeURIComponent(`${b.address}, ${b.city}, ${b.state} ${b.postal}`)}`]
      );
      branchIds.push({ id: br.id, restaurantId: rest.id, foods: foodIds, primary: ri === 0 && bi === 0 });
      await db.query(
        `INSERT INTO restaurant_settings(branch_id, auto_confirm, advance_payment_required, advance_payment_amount, gst_rate, service_charge_rate, booking_policy)
         VALUES ($1,$2,false,0,5,$3,$4)`,
        [br.id, ri === 1, ri === 0 ? 5 : 0,
          'Tables are held for 15 minutes past the booking time. Free cancellation up to 2 hours before your booking. Large groups (10+) please call ahead. Outside food and beverages are not permitted.']
      );

      // sections & tables
      const sections = {};
      for (const [n, lt, d] of [['Main Hall', 'indoor', 'Air-conditioned main dining room'], ['Garden Patio', 'outdoor', 'Al fresco seating under fairy lights'], ['Rooftop Lounge', 'rooftop', 'City views, open-air'], ['Private Dining', 'private', 'Enclosed room for celebrations & meetings']]) {
        if (ri === 1 && lt === 'rooftop') continue;
        sections[lt] = (await db.one(`INSERT INTO table_sections(branch_id, name, location_type, description) VALUES ($1,$2,$3,$4) RETURNING id`, [br.id, n, lt, d])).id;
      }
      const tableDefs = [
        ['T1', 2, '2_seater', 'indoor'], ['T2', 2, '2_seater', 'indoor'], ['T3', 4, '4_seater', 'indoor'], ['T4', 4, '4_seater', 'indoor'], ['T5', 4, '4_seater', 'indoor'],
        ['T6', 6, '6_seater', 'indoor'], ['P1', 2, '2_seater', 'outdoor'], ['P2', 4, '4_seater', 'outdoor'], ['P3', 6, '6_seater', 'outdoor'],
        ['R1', 2, '2_seater', 'rooftop'], ['R2', 4, '4_seater', 'rooftop'], ['R3', 8, 'family', 'rooftop'], ['V1', 10, 'vip', 'private'], ['V2', 12, 'vip', 'private'],
      ];
      const tables = [];
      for (const [num, cap, type, loc] of tableDefs) {
        if (!sections[loc]) continue;
        tables.push(
          await db.one(
            `INSERT INTO tables(branch_id, section_id, table_number, name, capacity, min_capacity, table_type) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, capacity, table_number`,
            [br.id, sections[loc], num, `${loc === 'private' ? 'VIP Room' : 'Table'} ${num}`, cap, cap >= 8 ? 4 : 1, type]
          )
        );
      }
      branchIds[branchIds.length - 1].tables = tables;
      branchIds[branchIds.length - 1].sections = sections;

      // staff
      const emps = [];
      const staff = [['Vikram Shetty', 'manager'], ['Pooja Nair', 'waiter'], ['Arif Khan', 'waiter'], ['Chef Raghav', 'chef'], ['Chef Lina', 'chef'], ['Sneha Kulkarni', 'cashier'], ['Manoj Yadav', 'host'], ['Suresh', 'delivery']];
      for (const [i, [n, pos]] of staff.entries()) {
        let uid = null;
        if (ri === 0 && bi === 0 && ['manager', 'waiter', 'chef', 'cashier'].includes(pos) && !emps.some((e) => e.pos === pos)) {
          uid = (await user(R[pos], n, `${pos}@saffronsage.com`, `90000001${String(i).padStart(2, '0')}`, pass, rest.id, br.id)).id;
        }
        const e = await db.one(
          `INSERT INTO employees(branch_id, user_id, name, email, phone, position, salary, hire_date) VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_DATE - $8::int) RETURNING id`,
          [br.id, uid, n, `${n.split(' ')[0].toLowerCase()}.${br.id}@staff.in`, `98${String(br.id).padStart(2, '0')}${String(100000 + i * 1111).slice(0, 6)}`, pos, { manager: 65000, chef: 48000, waiter: 22000, cashier: 25000, host: 21000, delivery: 18000 }[pos], between(60, 900)]
        );
        emps.push({ id: e.id, pos });
      }
      branchIds[branchIds.length - 1].chefs = emps.filter((e) => e.pos === 'chef').map((e) => e.id);
      for (let d = -6; d <= 7; d++) {
        for (const e of emps) {
          const morning = rand() < 0.5;
          const status = d < 0 ? pick(['present', 'present', 'present', 'late', 'absent']) : d === 0 ? 'scheduled' : 'scheduled';
          const date = localDate(addMinutes(new Date(), d * 1440));
          await db.query(
            `INSERT INTO staff_shifts(employee_id, shift_date, start_time, end_time, attendance_status, check_in_at, check_out_at)
             VALUES ($1,$2,$3,$4,$5::varchar, CASE WHEN $5::varchar IN ('present','late') THEN ($2::date + $3::time)::timestamptz + interval '5 minutes' END,
                     CASE WHEN $5::varchar IN ('present','late') THEN ($2::date + $4::time)::timestamptz END) ON CONFLICT DO NOTHING`,
            [e.id, date, morning ? '10:30' : '16:00', morning ? '17:00' : '23:30', status]
          );
        }
      }

      // inventory
      const inv = [
        ['Basmati Rice', 'Grains', 'kg', 80, 25, 95, 0], ['Chicken (boneless)', 'Meat', 'kg', 18, 15, 260, 1], ['Paneer', 'Dairy', 'kg', 6, 8, 320, 2],
        ['Fresh Cream', 'Dairy', 'ltr', 12, 5, 180, 2], ['Tomatoes', 'Vegetables', 'kg', 25, 10, 40, 0], ['Onions', 'Vegetables', 'kg', 40, 15, 35, 0],
        ['Prawns', 'Seafood', 'kg', 4, 5, 650, 1], ['Butter', 'Dairy', 'kg', 9, 4, 480, 2], ['Garam Masala', 'Spices', 'kg', 3, 1, 900, 3],
        ['Cooking Oil', 'Pantry', 'ltr', 45, 20, 140, 3], ['Mangoes (Alphonso)', 'Fruits', 'kg', 10, 5, 220, 0], ['Coffee Beans', 'Beverages', 'kg', 5, 2, 1100, 3],
      ];
      for (const [n, cat, unit, qty, min, cost, sup] of inv) {
        const expiry = ['Dairy', 'Meat', 'Seafood', 'Vegetables', 'Fruits'].includes(cat) ? localDate(addMinutes(new Date(), between(1, 12) * 1440)) : null;
        const item = await db.one(
          `INSERT INTO inventory_items(branch_id, supplier_id, name, sku, category, unit, quantity, min_quantity, cost_per_unit, expiry_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [br.id, supplierIds[sup], n, `SKU-${br.id}-${n.slice(0, 3).toUpperCase()}`, cat, unit, qty, min, cost, expiry]
        );
        let bal = 0;
        for (let k = 0; k < 4; k++) {
          const inQty = Math.round(qty * 0.6);
          bal += inQty;
          await db.query(
            `INSERT INTO inventory_transactions(inventory_item_id, type, quantity, unit_cost, total_cost, supplier_id, reference, balance_after, created_at)
             VALUES ($1,'stock_in',$2,$3,$4,$5,$6,$7, now() - make_interval(days => $8))`,
            [item.id, inQty, cost, round2(inQty * cost), supplierIds[sup], `PO-${1000 + k}`, bal, 28 - k * 7]
          );
          const out = Math.round(inQty * 0.85);
          bal -= out;
          await db.query(
            `INSERT INTO inventory_transactions(inventory_item_id, type, quantity, unit_cost, total_cost, reference, balance_after, created_at)
             VALUES ($1,'stock_out',$2,$3,$4,'Kitchen usage',$5, now() - make_interval(days => $6))`,
            [item.id, out, cost, round2(out * cost), bal, 25 - k * 7]
          );
        }
        await db.query(`UPDATE inventory_transactions SET balance_after = $2 WHERE id = (SELECT MAX(id) FROM inventory_transactions WHERE inventory_item_id = $1)`, [item.id, qty]);
      }
    }
  }

  // ---------- Customers ----------
  const customers = [];
  const demo = await user(R.customer, 'Priya Sharma', 'customer@example.com', '9876543210', custPass);
  customers.push({ userId: demo.id, name: 'Priya Sharma', email: 'customer@example.com', phone: '9876543210' });
  for (let i = 0; i < 24; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const email = `${name.toLowerCase().replace(' ', '.')}${i}@example.com`;
    const phone = `98${String(10000000 + i * 37171).slice(0, 8)}`;
    const u = await user(R.customer, name, email, phone, custPass);
    customers.push({ userId: u.id, name, email, phone });
  }
  for (const c of customers) {
    c.id = (await db.one(`INSERT INTO customers(user_id, created_at) VALUES ($1, now() - make_interval(days => $2)) RETURNING id`, [c.userId, between(10, 200)])).id;
  }

  // ---------- History: reservations, orders, payments, invoices, reviews ----------
  const SLOTS = ['12:00', '13:30', '19:00', '20:30'];
  for (const b of branchIds) {
    const busyFactor = b.primary ? 1 : 0.45;
    for (let d = -60; d <= 14; d++) {
      const day = localDate(addMinutes(new Date(), d * 1440));
      const used = new Set();
      const n = Math.round(between(2, 7) * busyFactor + (parseLocal(day + 'T00:00').getDay() % 6 === 0 ? 3 : 0));
      for (let k = 0; k < n; k++) {
        const slot = pick(SLOTS);
        const guests = pick([2, 2, 2, 3, 4, 4, 5, 6, 8]);
        const table = b.tables.filter((t) => t.capacity >= guests && !used.has(`${t.id}|${slot}`) && !used.has(`${t.id}|${SLOTS[SLOTS.indexOf(slot) - 1]}`) && !used.has(`${t.id}|${SLOTS[SLOTS.indexOf(slot) + 1]}`)).sort((x, y) => x.capacity - y.capacity)[0];
        if (!table) continue;
        used.add(`${table.id}|${slot}`);
        const c = rand() < 0.85 ? pick(customers) : null;
        const start = parseLocal(`${day}T${slot}`);
        const end = addMinutes(start, 90);
        const past = end.getTime() < Date.now();
        const status = past ? pick(['completed', 'completed', 'completed', 'completed', 'cancelled', 'no_show', 'completed']) : pick(['confirmed', 'confirmed', 'pending', 'confirmed']);
        const guestName = c?.name || `${pick(FIRST)} ${pick(LAST)}`;
        const r = await db.one(
          `INSERT INTO reservations(booking_code, branch_id, customer_id, customer_name, phone, email, booking_date, start_at, end_at, guests, status, source, occasion, special_requests, created_at, cancelled_at, cancel_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::varchar,$12,$13,$14, ($8::timestamp - make_interval(days => $15))::timestamptz,
                   CASE WHEN $11::varchar = 'cancelled' THEN $8::timestamp - interval '5 hours' END, CASE WHEN $11::varchar = 'cancelled' THEN 'Change of plans' END) RETURNING id`,
          [
            `BK-${String(b.id)}${String(d + 100).padStart(3, '0')}${String(k).padStart(2, '0')}`, b.id, c?.id || null, guestName, c?.phone || `97${between(10000000, 99999999)}`, c?.email || null,
            day, localIso(start), localIso(end), guests, status, c ? 'online' : pick(['phone', 'walk_in']), pick([null, null, 'birthday', 'anniversary', 'family', 'business', 'date']),
            pick([null, null, null, 'Window seat please', 'High chair for a toddler', 'Celebrating a birthday - cake at 9pm', 'Jain food options']), between(1, 7),
          ]
        );
        await db.query(`INSERT INTO reservation_tables(reservation_id, table_id, start_at, end_at, active) VALUES ($1,$2,$3,$4,$5)`, [r.id, table.id, localIso(start), localIso(end), !['cancelled', 'no_show', 'rejected'].includes(status)]);
        await db.query(`INSERT INTO reservation_status_history(reservation_id, from_status, to_status, note, created_at) VALUES ($1,NULL,'pending','Booking submitted', now() - interval '10 days')`, [r.id]);
        if (status !== 'pending') await db.query(`INSERT INTO reservation_status_history(reservation_id, from_status, to_status, created_at) VALUES ($1,'pending',$2, now() - interval '9 days')`, [r.id, status]);
      }
    }

    // orders over the last 90 days
    for (let d = -90; d <= 0; d++) {
      const n = Math.round(between(3, 10) * busyFactor);
      for (let k = 0; k < n; k++) {
        const hour = pick([12, 13, 14, 19, 20, 21, 22]);
        const created = addMinutes(parseLocal(`${localDate(addMinutes(new Date(), d * 1440))}T${String(hour).padStart(2, '0')}:00`), between(0, 59));
        if (created.getTime() > Date.now()) continue;
        const c = rand() < 0.8 ? pick(customers) : null;
        const type = pick(['dine_in', 'dine_in', 'takeaway', 'delivery']);
        const items = [];
        const count = between(1, 4);
        for (let i = 0; i < count; i++) {
          const f = b.foods[Math.floor(Math.pow(rand(), 1.6) * b.foods.length)];
          if (items.some((x) => x.f.id === f.id)) continue;
          items.push({ f, q: pick([1, 1, 1, 2, 2, 3]) });
        }
        const subtotal = round2(items.reduce((s, x) => s + Number(x.f.discounted_price ?? x.f.price) * x.q, 0));
        const discount = rand() < 0.15 ? round2(Math.min(subtotal * 0.15, 250)) : 0;
        const svc = type === 'dine_in' && b.restaurantId === firstRestaurantId ? round2((subtotal - discount) * 0.05) : 0;
        const tax = round2((subtotal - discount + svc) * 0.05);
        const del = type === 'delivery' ? 40 : 0;
        const total = round2(subtotal - discount + svc + tax + del);
        const today = d === 0;
        const status = today ? pick(['pending', 'confirmed', 'preparing', 'ready', 'completed']) : rand() < 0.06 ? 'cancelled' : 'completed';
        const paid = status === 'completed' || (today && rand() < 0.5 && status !== 'pending');
        const method = pick(['cash', 'upi', 'card', 'online', 'online', 'upi']);
        const table = type === 'dine_in' ? pick(b.tables) : null;
        const o = await db.one(
          `INSERT INTO orders(order_code, branch_id, customer_id, table_id, order_type, status, payment_status, payment_method, subtotal, discount, coupon_code, tax, service_charge, delivery_charge, total, amount_paid, contact_name, contact_phone, delivery_address, assigned_chef_id, loyalty_awarded, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22) RETURNING id`,
          [
            `OD-${b.id}${String(d + 100).padStart(3, '0')}${String(k).padStart(2, '0')}`, b.id, c?.id || null, table?.id || null, type, status,
            paid ? 'paid' : status === 'cancelled' ? 'pending' : 'pending', paid ? method : null, subtotal, discount, discount ? 'WEEKEND15' : null, tax, svc, del, total, paid ? total : 0,
            c?.name || 'Walk-in Guest', c?.phone || null, type === 'delivery' ? `${between(1, 200)}, ${pick(['MG Road', 'Church Street', 'Koramangala 5th Block', 'HSR Layout'])}` : null,
            ['preparing', 'ready', 'completed'].includes(status) ? pick(b.chefs) : null, status === 'completed' && !!c, created.toISOString(),
          ]
        );
        for (const x of items) {
          const unit = Number(x.f.discounted_price ?? x.f.price);
          await db.query(`INSERT INTO order_items(order_id, food_item_id, name, unit_price, quantity, line_total) VALUES ($1,$2,$3,$4,$5,$6)`, [o.id, x.f.id, x.f.name, unit, x.q, round2(unit * x.q)]);
        }
        if (paid) {
          await db.query(
            `INSERT INTO payments(payment_code, branch_id, order_id, user_id, amount, method, status, gateway, gateway_order_id, gateway_payment_id, paid_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'success',$7,$8,$9,$10,$10)`,
            [`PAY-${b.id}${String(d + 100).padStart(3, '0')}${String(k).padStart(3, '0')}`, b.id, o.id, c?.userId || null, total, method, method === 'online' ? 'mock' : 'manual', method === 'online' ? `mock_seed_${o.id}` : null, method === 'online' ? `mockpay_seed_${o.id}` : null, created.toISOString()]
          );
          await db.query(
            `INSERT INTO invoices(invoice_number, branch_id, order_id, customer_name, subtotal, discount, cgst, sgst, service_charge, delivery_charge, total, issued_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [`INV-${created.getFullYear()}${String(created.getMonth() + 1).padStart(2, '0')}-${String(o.id).padStart(6, '0')}`, b.id, o.id, c?.name || 'Walk-in Guest', subtotal, discount, round2(tax / 2), round2(tax - round2(tax / 2)), svc, del, total, created.toISOString()]
          );
          if (c && status === 'completed') await db.query(`UPDATE customers SET total_spent = total_spent + $2, loyalty_points = loyalty_points + $3 WHERE id = $1`, [c.id, total, Math.floor(total / 100) * 5]);
        }
        if (c && status === 'completed' && rand() < 0.12) {
          const f = items[0].f;
          await db.query(
            `INSERT INTO reviews(user_id, branch_id, food_item_id, order_id, rating, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [c.userId, b.id, rand() < 0.5 ? f.id : null, o.id, pick([5, 5, 4, 4, 5, 3]), pick(COMMENTS), created.toISOString()]
          );
        }
      }
    }
  }
  await db.query(
    `UPDATE food_items f SET avg_rating = s.avg, rating_count = s.n
       FROM (SELECT food_item_id, ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*) AS n FROM reviews WHERE food_item_id IS NOT NULL GROUP BY food_item_id) s
      WHERE f.id = s.food_item_id`
  );
  await db.query(
    `UPDATE orders o SET coupon_id = c.id FROM coupons c, restaurant_branches b
      WHERE b.id = o.branch_id AND c.restaurant_id = b.restaurant_id AND o.coupon_code = c.code AND o.coupon_id IS NULL`
  );
  await db.query(`UPDATE coupons c SET used_count = (SELECT COUNT(*) FROM orders o JOIN restaurant_branches b ON b.id = o.branch_id WHERE o.coupon_code = c.code AND b.restaurant_id = c.restaurant_id)`);
  await db.query(
    `INSERT INTO notifications(branch_id, channel, type, title, message, link) SELECT id, 'in_app', 'system', 'Welcome to your dashboard', 'Demo data has been loaded. Explore reservations, orders and reports.', '/admin' FROM restaurant_branches`
  );
  log('Demo data loaded.');
  log('  Super admin       super@smartrms.com      / Admin@123');
  log('  Restaurant admin  admin@saffronsage.com   / Admin@123');
  log('  Manager/Waiter/Chef/Cashier  manager|waiter|chef|cashier@saffronsage.com / Admin@123');
  log('  Customer          customer@example.com    / Customer@123');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await initDb();
  if (process.argv.includes('--reset')) {
    console.log('Resetting database...');
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  await migrate();
  const { n } = await db.one('SELECT COUNT(*) AS n FROM restaurants');
  if (n > 0 && !process.argv.includes('--reset')) {
    console.log('Database already has data. Use `npm run db:reset` to wipe and reseed.');
  } else {
    await seed();
  }
  await db.close();
}
