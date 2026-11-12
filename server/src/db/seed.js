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

// Rooftop London's own photos (client/public/photos), served by the web app.
const ROOFTOP_PHOTOS = ['/photos/rooftop-terrace.webp', '/photos/terrace-night.jpg', '/photos/lounge-night.jpg', '/photos/food-platter.jpg', '/photos/bar-neon.jpg', '/photos/sign-night.jpg', '/photos/entrance-lights.jpg'];
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

/** Local 'YYYY-MM-DD' for today + n days (replacement for CURRENT_DATE + n). */
const dateAdd = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};
/** now() - n days. */
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
/** Local wall-clock timestamp minus n days, as an absolute Date. */
const minusDays = (d, n) => {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() - n);
  return x;
};

export async function seed({ log = console.log } = {}) {
  const pass = await bcrypt.hash('Admin@123', 10);
  const custPass = await bcrypt.hash('Customer@123', 10);
  const role = async (name) => (await db.findOne('roles', { name }, { projection: { id: 1 } })).id;
  const R = {};
  for (const n of ['super_admin', 'restaurant_admin', 'manager', 'waiter', 'chef', 'cashier', 'customer']) R[n] = await role(n);

  const user = (roleId, name, email, phone, hash, restaurantId = null, branchId = null) =>
    db.insert('users', {
      role_id: roleId, restaurant_id: restaurantId, branch_id: branchId, name, email, phone, password_hash: hash, email_verified: true, phone_verified: true,
    });

  await user(R.super_admin, 'Platform Owner', 'super@smartrms.com', '9000000001', pass);
  await db.insertMany('system_settings', [
    { key: 'platform_name', value: 'Smart RMS' },
    { key: 'support_email', value: 'support@smartrms.com' },
    { key: 'default_currency', value: 'INR' },
    { key: 'maintenance_mode', value: false },
  ]);

  // ---------- Restaurants ----------
  const restaurants = [
    {
      name: 'ROOFTOP LONDON CAFE & RESTAURANT', slug: 'rooftop-london-cafe-restaurant', cuisine: 'Modern Indian, Continental', plan: 'pro',
      description: 'A contemporary dining room celebrating regional Indian flavours with a modern twist. Fresh, seasonal ingredients, a clay-oven tandoor and a rooftop lounge with city views.',
      logo: '/photos/sign-night.jpg', cover: '/photos/rooftop-terrace.webp',
      email: 'hello@saffronsage.in', phone: '099384 85755', gstin: '29ABCDE1234F1Z5', admin: ['Anita Rao', 'admin@saffronsage.com', '9000000002'],
      branches: [
        { name: 'Trisulia, Kataka', address: 'BAZAR, near ANDHRA BANK, Trisulia', city: 'Kataka', state: 'Odisha', postal: '754005', lat: null, lng: null, phone: '099384 85755', images: ROOFTOP_PHOTOS },
        { name: 'Bandra West, Mumbai', address: '45, Hill Road, Bandra West', city: 'Mumbai', state: 'Maharashtra', postal: '400050', lat: 19.0544, lng: 72.8402, phone: '+912226401234', images: ROOFTOP_PHOTOS },
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
  const couponsByRestaurant = new Map(); // restaurant_id -> Map(upper(code) -> coupon)
  let firstRestaurantId = null;
  for (const [ri, rs] of restaurants.entries()) {
    const rest = await db.insert('restaurants', {
      name: rs.name, slug: rs.slug, description: rs.description, cuisine: rs.cuisine, email: rs.email, phone: rs.phone, gstin: rs.gstin,
      logo_url: rs.logo, cover_url: rs.cover, subscription_plan: rs.plan, subscription_status: 'active', subscription_expires_at: dateAdd(300),
      website: `https://${rs.slug}.example.com`,
    });
    if (ri === 0) firstRestaurantId = rest.id;
    await user(R.restaurant_admin, rs.admin[0], rs.admin[1], rs.admin[2], pass, rest.id);

    // menu
    let sort = 0;
    const foodIds = [];
    const foodImages = [];
    for (const [cat, items] of Object.entries(MENU)) {
      if (ri === 1 && !['Starters', 'Main Course', 'Desserts', 'Beverages'].includes(cat)) continue;
      const c = await db.insert('food_categories', { restaurant_id: rest.id, name: cat, sort_order: sort++, image_url: U(items[0][5], 400) });
      for (const [name, desc, price, disc, diet, img, o] of items) {
        const f = await db.insert('food_items', {
          restaurant_id: rest.id, category_id: c.id, name, description: desc, price, discounted_price: disc, diet_type: diet,
          prep_time_min: between(10, 30), is_bestseller: !!o.best, is_recommended: !!o.rec, spice_level: o.spice || 0,
          ingredients: desc.split(/,| with | and /).slice(0, 4).join(', '), allergens: o.allergens || null,
        });
        foodImages.push({ food_item_id: f.id, url: U(img), is_primary: true });
        foodIds.push(f);
      }
    }
    await db.insertMany('food_images', foodImages);

    const coupons = await db.insertMany('coupons', [
      { restaurant_id: rest.id, code: 'WELCOME20', title: '20% off your first order', description: 'New here? Enjoy 20% off (up to Rs.150).', discount_type: 'percent', discount_value: 20, min_order_amount: 300, max_discount: 150, valid_from: dateAdd(-30), valid_to: dateAdd(120), per_user_limit: 1, image_url: U('photo-1504674900247-0877df9cc836', 600) },
      { restaurant_id: rest.id, code: 'FLAT100', title: 'Flat Rs.100 off', description: 'Flat Rs.100 off on orders above Rs.799.', discount_type: 'flat', discount_value: 100, min_order_amount: 799, max_discount: null, valid_from: dateAdd(-10), valid_to: dateAdd(60), per_user_limit: null, image_url: U('photo-1414235077428-338989a2e8c0', 600) },
      { restaurant_id: rest.id, code: 'WEEKEND15', title: 'Weekend feast - 15% off', description: '15% off on all orders, max Rs.250.', discount_type: 'percent', discount_value: 15, min_order_amount: 500, max_discount: 250, valid_from: dateAdd(-5), valid_to: dateAdd(90), per_user_limit: 3, image_url: U('photo-1555939594-58d7cb561ad1', 600) },
    ]);
    couponsByRestaurant.set(rest.id, new Map(coupons.map((c) => [c.code.toUpperCase(), c])));

    const supplierIds = (
      await db.insertMany(
        'suppliers',
        [['FreshFarm Produce', 'Mahesh K', '+919845012345'], ['Ocean Catch Seafood', 'Joseph D', '+919822012345'], ['Amul Dairy Distributors', 'Sunita P', '+919900012345'], ['Spice Route Traders', 'Imran S', '+919886012345']].map(([n, cp, ph]) => ({
          restaurant_id: rest.id, name: n, contact_person: cp, phone: ph, email: `${n.split(' ')[0].toLowerCase()}@supplier.in`,
        }))
      )
    ).map((s) => s.id);

    for (const [bi, b] of rs.branches.entries()) {
      const br = await db.insert('restaurant_branches', {
        restaurant_id: rest.id, name: b.name, address: b.address, city: b.city, state: b.state, postal_code: b.postal, latitude: b.lat, longitude: b.lng,
        phone: b.phone, email: rs.email, opening_time: '11:00:00', closing_time: '23:00:00', weekly_holidays: ri === 1 ? [1] : [],
        images: b.images.map((i) => (i.startsWith('/') ? i : U(i, 1200))),
        map_url: `https://www.google.com/maps?q=${b.lat != null ? `${b.lat},${b.lng}` : encodeURIComponent(`${b.address}, ${b.city}, ${b.state} ${b.postal}`)}`,
      });
      branchIds.push({ id: br.id, restaurantId: rest.id, foods: foodIds, primary: ri === 0 && bi === 0 });
      await db.insert('restaurant_settings', {
        branch_id: br.id, auto_confirm: ri === 1, advance_payment_required: false, advance_payment_amount: 0, gst_rate: 5, service_charge_rate: ri === 0 ? 5 : 0,
        booking_policy: 'Tables are held for 15 minutes past the booking time. Free cancellation up to 2 hours before your booking. Large groups (10+) please call ahead. Outside food and beverages are not permitted.',
      });

      // sections & tables
      const sections = {};
      for (const [n, lt, d] of [['Main Hall', 'indoor', 'Air-conditioned main dining room'], ['Garden Patio', 'outdoor', 'Al fresco seating under fairy lights'], ['Rooftop Lounge', 'rooftop', 'City views, open-air'], ['Private Dining', 'private', 'Enclosed room for celebrations & meetings']]) {
        if (ri === 1 && lt === 'rooftop') continue;
        sections[lt] = (await db.insert('table_sections', { branch_id: br.id, name: n, location_type: lt, description: d })).id;
      }
      const tableDefs = [
        ['T1', 2, '2_seater', 'indoor'], ['T2', 2, '2_seater', 'indoor'], ['T3', 4, '4_seater', 'indoor'], ['T4', 4, '4_seater', 'indoor'], ['T5', 4, '4_seater', 'indoor'],
        ['T6', 6, '6_seater', 'indoor'], ['P1', 2, '2_seater', 'outdoor'], ['P2', 4, '4_seater', 'outdoor'], ['P3', 6, '6_seater', 'outdoor'],
        ['R1', 2, '2_seater', 'rooftop'], ['R2', 4, '4_seater', 'rooftop'], ['R3', 8, 'family', 'rooftop'], ['V1', 10, 'vip', 'private'], ['V2', 12, 'vip', 'private'],
      ];
      const tables = await db.insertMany(
        'tables',
        tableDefs
          .filter(([, , , loc]) => sections[loc])
          .map(([num, cap, type, loc]) => ({
            branch_id: br.id, section_id: sections[loc], table_number: num, name: `${loc === 'private' ? 'VIP Room' : 'Table'} ${num}`, capacity: cap, min_capacity: cap >= 8 ? 4 : 1, table_type: type,
          }))
      );
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
        const e = await db.insert('employees', {
          branch_id: br.id, user_id: uid, name: n, email: `${n.split(' ')[0].toLowerCase()}.${br.id}@staff.in`,
          phone: `98${String(br.id).padStart(2, '0')}${String(100000 + i * 1111).slice(0, 6)}`, position: pos,
          salary: { manager: 65000, chef: 48000, waiter: 22000, cashier: 25000, host: 21000, delivery: 18000 }[pos], hire_date: dateAdd(-between(60, 900)),
        });
        emps.push({ id: e.id, pos });
      }
      branchIds[branchIds.length - 1].chefs = emps.filter((e) => e.pos === 'chef').map((e) => e.id);
      const shifts = [];
      for (let d = -6; d <= 7; d++) {
        for (const e of emps) {
          const morning = rand() < 0.5;
          const status = d < 0 ? pick(['present', 'present', 'present', 'late', 'absent']) : d === 0 ? 'scheduled' : 'scheduled';
          const date = localDate(addMinutes(new Date(), d * 1440));
          const start = morning ? '10:30:00' : '16:00:00';
          const end = morning ? '17:00:00' : '23:30:00';
          const attended = ['present', 'late'].includes(status);
          shifts.push({
            employee_id: e.id, shift_date: date, start_time: start, end_time: end, attendance_status: status,
            check_in_at: attended ? addMinutes(parseLocal(`${date}T${start}`), 5) : null,
            check_out_at: attended ? parseLocal(`${date}T${end}`) : null,
          });
        }
      }
      await db.insertMany('staff_shifts', shifts);

      // inventory
      const inv = [
        ['Basmati Rice', 'Grains', 'kg', 80, 25, 95, 0], ['Chicken (boneless)', 'Meat', 'kg', 18, 15, 260, 1], ['Paneer', 'Dairy', 'kg', 6, 8, 320, 2],
        ['Fresh Cream', 'Dairy', 'ltr', 12, 5, 180, 2], ['Tomatoes', 'Vegetables', 'kg', 25, 10, 40, 0], ['Onions', 'Vegetables', 'kg', 40, 15, 35, 0],
        ['Prawns', 'Seafood', 'kg', 4, 5, 650, 1], ['Butter', 'Dairy', 'kg', 9, 4, 480, 2], ['Garam Masala', 'Spices', 'kg', 3, 1, 900, 3],
        ['Cooking Oil', 'Pantry', 'ltr', 45, 20, 140, 3], ['Mangoes (Alphonso)', 'Fruits', 'kg', 10, 5, 220, 0], ['Coffee Beans', 'Beverages', 'kg', 5, 2, 1100, 3],
      ];
      const invTx = [];
      for (const [n, cat, unit, qty, min, cost, sup] of inv) {
        const expiry = ['Dairy', 'Meat', 'Seafood', 'Vegetables', 'Fruits'].includes(cat) ? localDate(addMinutes(new Date(), between(1, 12) * 1440)) : null;
        const item = await db.insert('inventory_items', {
          branch_id: br.id, supplier_id: supplierIds[sup], name: n, sku: `SKU-${br.id}-${n.slice(0, 3).toUpperCase()}`, category: cat, unit,
          quantity: qty, min_quantity: min, cost_per_unit: cost, expiry_date: expiry,
        });
        let bal = 0;
        const rows = [];
        for (let k = 0; k < 4; k++) {
          const inQty = Math.round(qty * 0.6);
          bal += inQty;
          rows.push({
            inventory_item_id: item.id, type: 'stock_in', quantity: inQty, unit_cost: cost, total_cost: round2(inQty * cost), supplier_id: supplierIds[sup],
            reference: `PO-${1000 + k}`, balance_after: bal, created_at: daysAgo(28 - k * 7),
          });
          const out = Math.round(inQty * 0.85);
          bal -= out;
          rows.push({
            inventory_item_id: item.id, type: 'stock_out', quantity: out, unit_cost: cost, total_cost: round2(out * cost), reference: 'Kitchen usage',
            balance_after: bal, created_at: daysAgo(25 - k * 7),
          });
        }
        rows[rows.length - 1].balance_after = qty; // latest movement reflects the current stock level
        invTx.push(...rows);
      }
      await db.insertMany('inventory_transactions', invTx);
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
  const custDocs = await db.insertMany('customers', customers.map((c) => ({ user_id: c.userId, created_at: daysAgo(between(10, 200)) })));
  customers.forEach((c, i) => {
    c.id = custDocs[i].id;
    c.spent = 0;
    c.points = 0;
  });

  // ---------- History: reservations, orders, payments, invoices, reviews ----------
  const SLOTS = ['12:00', '13:30', '19:00', '20:30'];
  const allReviews = [];
  const couponUse = new Map(); // coupon id -> count
  for (const b of branchIds) {
    const busyFactor = b.primary ? 1 : 0.45;
    const resvs = [];
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
        // Field order mirrors the old parameter list so the PRNG sequence (and thus the data) is unchanged.
        const doc = {
          booking_code: `BK-${String(b.id)}${String(d + 100).padStart(3, '0')}${String(k).padStart(2, '0')}`,
          branch_id: b.id,
          customer_id: c?.id || null,
          customer_name: guestName,
          phone: c?.phone || `97${between(10000000, 99999999)}`,
          email: c?.email || null,
          booking_date: day,
          start_at: localIso(start),
          end_at: localIso(end),
          guests,
          status,
          source: c ? 'online' : pick(['phone', 'walk_in']),
          occasion: pick([null, null, 'birthday', 'anniversary', 'family', 'business', 'date']),
          special_requests: pick([null, null, null, 'Window seat please', 'High chair for a toddler', 'Celebrating a birthday - cake at 9pm', 'Jain food options']),
        };
        doc.created_at = minusDays(start, between(1, 7));
        doc.cancelled_at = status === 'cancelled' ? addMinutes(start, -300) : null;
        doc.cancel_reason = status === 'cancelled' ? 'Change of plans' : null;
        resvs.push({ doc, table, status, start, end });
      }
    }
    const savedResvs = await db.insertMany('reservations', resvs.map((x) => x.doc));
    const resTables = [];
    const history = [];
    resvs.forEach((x, i) => {
      const id = savedResvs[i].id;
      resTables.push({ reservation_id: id, table_id: x.table.id, start_at: localIso(x.start), end_at: localIso(x.end), active: !['cancelled', 'no_show', 'rejected'].includes(x.status) });
      history.push({ reservation_id: id, from_status: null, to_status: 'pending', note: 'Booking submitted', created_at: daysAgo(10) });
      if (x.status !== 'pending') history.push({ reservation_id: id, from_status: 'pending', to_status: x.status, created_at: daysAgo(9) });
    });
    await db.insertMany('reservation_tables', resTables);
    await db.insertMany('reservation_status_history', history);

    // orders over the last 90 days
    const coupons = couponsByRestaurant.get(b.restaurantId);
    const ords = [];
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
        const couponCode = discount ? 'WEEKEND15' : null;
        const coupon = couponCode ? coupons.get(couponCode) : null;
        if (coupon) couponUse.set(coupon.id, (couponUse.get(coupon.id) || 0) + 1);
        const doc = {
          order_code: `OD-${b.id}${String(d + 100).padStart(3, '0')}${String(k).padStart(2, '0')}`,
          branch_id: b.id,
          customer_id: c?.id || null,
          table_id: table?.id || null,
          order_type: type,
          status,
          payment_status: paid ? 'paid' : status === 'cancelled' ? 'pending' : 'pending',
          payment_method: paid ? method : null,
          subtotal,
          discount,
          coupon_code: couponCode,
          coupon_id: coupon?.id ?? null,
          tax,
          service_charge: svc,
          delivery_charge: del,
          total,
          amount_paid: paid ? total : 0,
          contact_name: c?.name || 'Walk-in Guest',
          contact_phone: c?.phone || null,
          delivery_address: type === 'delivery' ? `${between(1, 200)}, ${pick(['MG Road', 'Church Street', 'Koramangala 5th Block', 'HSR Layout'])}` : null,
          assigned_chef_id: ['preparing', 'ready', 'completed'].includes(status) ? pick(b.chefs) : null,
          loyalty_awarded: status === 'completed' && !!c,
          created_at: created,
          updated_at: created,
        };
        if (paid && c && status === 'completed') {
          c.spent += total;
          c.points += Math.floor(total / 100) * 5;
        }
        let review = null;
        if (c && status === 'completed' && rand() < 0.12) {
          const f = items[0].f;
          review = { user_id: c.userId, branch_id: b.id, food_item_id: rand() < 0.5 ? f.id : null, rating: pick([5, 5, 4, 4, 5, 3]), comment: pick(COMMENTS), created_at: created };
        }
        ords.push({ doc, items, paid, method, c, created, d, k, review });
      }
    }
    const savedOrders = await db.insertMany('orders', ords.map((x) => x.doc));
    const orderItems = [];
    const payments = [];
    const invoices = [];
    const reviews = [];
    ords.forEach((x, i) => {
      const o = savedOrders[i];
      for (const it of x.items) {
        const unit = Number(it.f.discounted_price ?? it.f.price);
        orderItems.push({ order_id: o.id, food_item_id: it.f.id, name: it.f.name, unit_price: unit, quantity: it.q, line_total: round2(unit * it.q) });
      }
      if (x.paid) {
        const { method, created, c } = x;
        payments.push({
          payment_code: `PAY-${b.id}${String(x.d + 100).padStart(3, '0')}${String(x.k).padStart(3, '0')}`, branch_id: b.id, order_id: o.id, user_id: c?.userId || null,
          amount: o.total, method, status: 'success', gateway: method === 'online' ? 'mock' : 'manual',
          gateway_order_id: method === 'online' ? `mock_seed_${o.id}` : null, gateway_payment_id: method === 'online' ? `mockpay_seed_${o.id}` : null,
          paid_at: created, created_at: created,
        });
        invoices.push({
          invoice_number: `INV-${created.getFullYear()}${String(created.getMonth() + 1).padStart(2, '0')}-${String(o.id).padStart(6, '0')}`,
          branch_id: b.id, order_id: o.id, customer_name: c?.name || 'Walk-in Guest', subtotal: o.subtotal, discount: o.discount,
          cgst: round2(o.tax / 2), sgst: round2(o.tax - round2(o.tax / 2)), service_charge: o.service_charge, delivery_charge: o.delivery_charge, total: o.total, issued_at: created,
        });
      }
      if (x.review) reviews.push({ ...x.review, order_id: o.id });
    });
    await db.insertMany('order_items', orderItems);
    await db.insertMany('payments', payments);
    await db.insertMany('invoices', invoices);
    const savedReviews = await db.insertMany('reviews', reviews);
    allReviews.push(...savedReviews);
  }

  // customer totals (loyalty + spend from completed, paid orders)
  for (const c of customers) {
    if (c.spent || c.points) await db.update('customers', { id: c.id }, { $set: { total_spent: round2(c.spent), loyalty_points: c.points } });
  }
  // food ratings
  const ratingStats = new Map();
  for (const r of allReviews) {
    if (r.food_item_id == null) continue;
    const s = ratingStats.get(r.food_item_id) || { sum: 0, n: 0 };
    s.sum += r.rating;
    s.n += 1;
    ratingStats.set(r.food_item_id, s);
  }
  for (const [id, s] of ratingStats) await db.update('food_items', { id }, { $set: { avg_rating: round2(s.sum / s.n), rating_count: s.n } });
  // coupon usage counters
  for (const [id, n] of couponUse) await db.update('coupons', { id }, { $set: { used_count: n } });

  await db.insertMany(
    'notifications',
    branchIds.map((b) => ({
      branch_id: b.id, channel: 'in_app', type: 'system', title: 'Welcome to your dashboard', message: 'Demo data has been loaded. Explore reservations, orders and reports.', link: '/admin',
    }))
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
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('Resetting database...');
    await db.dropAll();
  }
  await migrate(); // ensureIndexes() + syncRbac()
  const n = await db.count('restaurants');
  if (n > 0 && !reset) {
    console.log('Database already has data. Use `npm run db:reset` to wipe and reseed.');
  } else {
    await seed();
  }
  await db.close();
}
