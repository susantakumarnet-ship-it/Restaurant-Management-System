-- =====================================================================
-- Smart Restaurant Management System - initial schema (PostgreSQL)
-- Times for reservations are stored as TIMESTAMP (restaurant local time).
-- Audit / created_at columns use TIMESTAMPTZ.
-- =====================================================================

-- ---------- Access control ----------
CREATE TABLE roles (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(50)  NOT NULL UNIQUE,
  display_name  VARCHAR(100) NOT NULL,
  description   TEXT,
  is_staff      BOOLEAN NOT NULL DEFAULT false,
  is_system     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(100) NOT NULL UNIQUE,
  module       VARCHAR(50)  NOT NULL,
  description  TEXT
);

CREATE TABLE role_permissions (
  role_id        INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------- Tenancy ----------
CREATE TABLE restaurants (
  id                       SERIAL PRIMARY KEY,
  name                     VARCHAR(150) NOT NULL,
  slug                     VARCHAR(160) NOT NULL UNIQUE,
  logo_url                 TEXT,
  cover_url                TEXT,
  description              TEXT,
  cuisine                  VARCHAR(150),
  email                    VARCHAR(150),
  phone                    VARCHAR(30),
  website                  VARCHAR(200),
  gstin                    VARCHAR(20),
  subscription_plan        VARCHAR(20) NOT NULL DEFAULT 'basic'
                           CHECK (subscription_plan IN ('basic','pro','enterprise')),
  subscription_status      VARCHAR(20) NOT NULL DEFAULT 'active'
                           CHECK (subscription_status IN ('trial','active','past_due','cancelled')),
  subscription_expires_at  DATE,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE restaurant_branches (
  id               SERIAL PRIMARY KEY,
  restaurant_id    INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name             VARCHAR(150) NOT NULL,
  address          TEXT,
  city             VARCHAR(100),
  state            VARCHAR(100),
  postal_code      VARCHAR(20),
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),
  map_url          TEXT,
  phone            VARCHAR(30),
  email            VARCHAR(150),
  opening_time     TIME NOT NULL DEFAULT '11:00',
  closing_time     TIME NOT NULL DEFAULT '23:00',
  weekly_holidays  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of weekday numbers 0=Sun..6=Sat
  images           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of image URLs
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (closing_time > opening_time)
);
CREATE INDEX idx_branches_restaurant ON restaurant_branches(restaurant_id);

CREATE TABLE restaurant_settings (
  id                           SERIAL PRIMARY KEY,
  branch_id                    INT NOT NULL UNIQUE REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  reservation_duration_min     INT NOT NULL DEFAULT 90  CHECK (reservation_duration_min BETWEEN 15 AND 480),
  buffer_min                   INT NOT NULL DEFAULT 15  CHECK (buffer_min BETWEEN 0 AND 120),
  slot_interval_min            INT NOT NULL DEFAULT 30  CHECK (slot_interval_min BETWEEN 5 AND 120),
  min_guests                   INT NOT NULL DEFAULT 1   CHECK (min_guests >= 1),
  max_guests                   INT NOT NULL DEFAULT 20  CHECK (max_guests >= 1),
  max_advance_days             INT NOT NULL DEFAULT 60  CHECK (max_advance_days >= 0),
  min_notice_minutes           INT NOT NULL DEFAULT 60  CHECK (min_notice_minutes >= 0),
  cancellation_deadline_hours  INT NOT NULL DEFAULT 2   CHECK (cancellation_deadline_hours >= 0),
  auto_confirm                 BOOLEAN NOT NULL DEFAULT false,
  advance_payment_required     BOOLEAN NOT NULL DEFAULT false,
  advance_payment_amount       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (advance_payment_amount >= 0),
  gst_rate                     NUMERIC(5,2) NOT NULL DEFAULT 5  CHECK (gst_rate >= 0),
  service_charge_rate          NUMERIC(5,2) NOT NULL DEFAULT 0  CHECK (service_charge_rate >= 0),
  delivery_charge              NUMERIC(10,2) NOT NULL DEFAULT 40 CHECK (delivery_charge >= 0),
  min_delivery_order           NUMERIC(10,2) NOT NULL DEFAULT 0,
  accepts_delivery             BOOLEAN NOT NULL DEFAULT true,
  accepts_takeaway             BOOLEAN NOT NULL DEFAULT true,
  loyalty_points_per_100       INT NOT NULL DEFAULT 5,
  currency                     VARCHAR(3) NOT NULL DEFAULT 'INR',
  booking_policy               TEXT,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_guests >= min_guests)
);

CREATE TABLE system_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Users ----------
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  role_id         INT NOT NULL REFERENCES roles(id),
  restaurant_id   INT REFERENCES restaurants(id) ON DELETE SET NULL,
  branch_id       INT REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(150) NOT NULL,
  phone           VARCHAR(20),
  password_hash   TEXT,
  google_id       VARCHAR(100) UNIQUE,
  avatar_url      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  email_verified  BOOLEAN NOT NULL DEFAULT false,
  phone_verified  BOOLEAN NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));
CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_restaurant ON users(restaurant_id);

CREATE TABLE otp_codes (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(30) NOT NULL CHECK (purpose IN ('verify','reset_password')),
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_user ON otp_codes(user_id, purpose);

CREATE TABLE customers (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  loyalty_points  INT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  total_spent     NUMERIC(12,2) NOT NULL DEFAULT 0,
  date_of_birth   DATE,
  anniversary     DATE,
  address         TEXT,
  notes           TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Tables & seating ----------
CREATE TABLE table_sections (
  id             SERIAL PRIMARY KEY,
  branch_id      INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  location_type  VARCHAR(20) NOT NULL DEFAULT 'indoor' CHECK (location_type IN ('indoor','outdoor','rooftop','private')),
  description    TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (branch_id, name)
);

CREATE TABLE tables (
  id            SERIAL PRIMARY KEY,
  branch_id     INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  section_id    INT REFERENCES table_sections(id) ON DELETE SET NULL,
  table_number  VARCHAR(20) NOT NULL,
  name          VARCHAR(100),
  capacity      INT NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  min_capacity  INT NOT NULL DEFAULT 1 CHECK (min_capacity >= 1),
  table_type    VARCHAR(20) NOT NULL DEFAULT '4_seater'
                CHECK (table_type IN ('2_seater','4_seater','6_seater','family','vip')),
  status        VARCHAR(20) NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','occupied','maintenance')),
  maintenance_note TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, table_number),
  CHECK (min_capacity <= capacity)
);
CREATE INDEX idx_tables_branch ON tables(branch_id, is_active);

-- ---------- Menu ----------
CREATE TABLE food_categories (
  id             SERIAL PRIMARY KEY,
  restaurant_id  INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  image_url      TEXT,
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, name)
);

CREATE TABLE food_items (
  id                SERIAL PRIMARY KEY,
  restaurant_id     INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id       INT NOT NULL REFERENCES food_categories(id) ON DELETE RESTRICT,
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  discounted_price  NUMERIC(10,2) CHECK (discounted_price IS NULL OR discounted_price >= 0),
  diet_type         VARCHAR(10) NOT NULL DEFAULT 'veg' CHECK (diet_type IN ('veg','non_veg','vegan')),
  is_available      BOOLEAN NOT NULL DEFAULT true,
  prep_time_min     INT NOT NULL DEFAULT 15 CHECK (prep_time_min >= 0),
  is_bestseller     BOOLEAN NOT NULL DEFAULT false,
  is_recommended    BOOLEAN NOT NULL DEFAULT false,
  spice_level       INT NOT NULL DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 3),
  ingredients       TEXT,
  allergens         TEXT,
  avg_rating        NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count      INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (discounted_price IS NULL OR discounted_price <= price)
);
CREATE INDEX idx_food_items_restaurant ON food_items(restaurant_id, category_id);
CREATE INDEX idx_food_items_name ON food_items(lower(name));

CREATE TABLE food_images (
  id            SERIAL PRIMARY KEY,
  food_item_id  INT NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_food_images_item ON food_images(food_item_id);

-- ---------- Coupons ----------
CREATE TABLE coupons (
  id                SERIAL PRIMARY KEY,
  restaurant_id     INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code              VARCHAR(40) NOT NULL,
  title             VARCHAR(150) NOT NULL,
  description       TEXT,
  discount_type     VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent','flat')),
  discount_value    NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount      NUMERIC(10,2),
  valid_from        DATE,
  valid_to          DATE,
  usage_limit       INT,
  per_user_limit    INT,
  used_count        INT NOT NULL DEFAULT 0,
  is_public         BOOLEAN NOT NULL DEFAULT true,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  image_url         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_coupons_code ON coupons(restaurant_id, upper(code));

-- ---------- Reservations ----------
CREATE TABLE reservations (
  id                  SERIAL PRIMARY KEY,
  booking_code        VARCHAR(20) NOT NULL UNIQUE,
  branch_id           INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  customer_id         INT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name       VARCHAR(120) NOT NULL,
  phone               VARCHAR(20) NOT NULL,
  email               VARCHAR(150),
  booking_date        DATE NOT NULL,
  start_at            TIMESTAMP NOT NULL,
  end_at              TIMESTAMP NOT NULL,
  guests              INT NOT NULL CHECK (guests > 0),
  section_id          INT REFERENCES table_sections(id) ON DELETE SET NULL,
  seating_preference  VARCHAR(30),
  occasion            VARCHAR(30) CHECK (occasion IN ('birthday','anniversary','business','family','date','other')),
  special_requests    TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','rejected','checked_in','seated','completed','cancelled','no_show')),
  source              VARCHAR(20) NOT NULL DEFAULT 'online' CHECK (source IN ('online','phone','walk_in','admin')),
  advance_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status      VARCHAR(20) NOT NULL DEFAULT 'not_required'
                      CHECK (payment_status IN ('not_required','pending','paid','partially_paid','refunded','partially_refunded')),
  admin_notes         TEXT,
  cancel_reason       TEXT,
  cancelled_at        TIMESTAMPTZ,
  reminder_sent_at    TIMESTAMPTZ,
  created_by          INT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX idx_reservations_branch_date ON reservations(branch_id, booking_date);
CREATE INDEX idx_reservations_customer ON reservations(customer_id);
CREATE INDEX idx_reservations_status ON reservations(branch_id, status);

-- Each row blocks a table for [start_at, end_at). "active" rows are the ones that count for availability.
CREATE TABLE reservation_tables (
  reservation_id  INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id        INT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  start_at        TIMESTAMP NOT NULL,
  end_at          TIMESTAMP NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (reservation_id, table_id)
);
CREATE INDEX idx_restables_overlap ON reservation_tables(table_id, start_at, end_at) WHERE active;

CREATE TABLE reservation_status_history (
  id              SERIAL PRIMARY KEY,
  reservation_id  INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  from_status     VARCHAR(20),
  to_status       VARCHAR(20) NOT NULL,
  note            TEXT,
  changed_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_res_history ON reservation_status_history(reservation_id);

-- ---------- Staff ----------
CREATE TABLE employees (
  id          SERIAL PRIMARY KEY,
  branch_id   INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  user_id     INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(150),
  phone       VARCHAR(20),
  position    VARCHAR(20) NOT NULL CHECK (position IN ('manager','waiter','chef','cashier','host','cleaner','delivery')),
  salary      NUMERIC(10,2),
  hire_date   DATE,
  status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','terminated')),
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_employees_branch ON employees(branch_id, position);

CREATE TABLE staff_shifts (
  id                 SERIAL PRIMARY KEY,
  employee_id        INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_date         DATE NOT NULL,
  start_time         TIME NOT NULL,
  end_time           TIME NOT NULL,
  attendance_status  VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                     CHECK (attendance_status IN ('scheduled','present','late','absent','leave')),
  check_in_at        TIMESTAMPTZ,
  check_out_at       TIMESTAMPTZ,
  notes              TEXT,
  UNIQUE (employee_id, shift_date, start_time)
);
CREATE INDEX idx_shifts_date ON staff_shifts(shift_date);

-- ---------- Orders ----------
CREATE TABLE orders (
  id                SERIAL PRIMARY KEY,
  order_code        VARCHAR(20) NOT NULL UNIQUE,
  branch_id         INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  customer_id       INT REFERENCES customers(id) ON DELETE SET NULL,
  reservation_id    INT REFERENCES reservations(id) ON DELETE SET NULL,
  table_id          INT REFERENCES tables(id) ON DELETE SET NULL,
  assigned_chef_id  INT REFERENCES employees(id) ON DELETE SET NULL,
  order_type        VARCHAR(20) NOT NULL CHECK (order_type IN ('dine_in','takeaway','delivery')),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','preparing','ready','served','delivered','completed','cancelled')),
  payment_status    VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN ('pending','paid','partially_paid','refunded','partially_refunded','failed')),
  payment_method    VARCHAR(20),
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  coupon_id         INT REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code       VARCHAR(40),
  tax               NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_charge    NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
  contact_name      VARCHAR(120),
  contact_phone     VARCHAR(20),
  delivery_address  TEXT,
  notes             TEXT,
  cancel_reason     TEXT,
  loyalty_awarded   BOOLEAN NOT NULL DEFAULT false,
  created_by        INT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_branch_created ON orders(branch_id, created_at DESC);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(branch_id, status);

CREATE TABLE order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  food_item_id  INT REFERENCES food_items(id) ON DELETE SET NULL,
  name          VARCHAR(150) NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  quantity      INT NOT NULL CHECK (quantity > 0),
  line_total    NUMERIC(12,2) NOT NULL,
  notes         TEXT
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_food ON order_items(food_item_id);

-- ---------- Payments & invoices ----------
CREATE TABLE payments (
  id                  SERIAL PRIMARY KEY,
  payment_code        VARCHAR(24) NOT NULL UNIQUE,
  branch_id           INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  order_id            INT REFERENCES orders(id) ON DELETE SET NULL,
  reservation_id      INT REFERENCES reservations(id) ON DELETE SET NULL,
  user_id             INT REFERENCES users(id) ON DELETE SET NULL,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method              VARCHAR(20) NOT NULL CHECK (method IN ('cash','upi','card','online')),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','success','failed','refunded','partially_refunded')),
  is_partial          BOOLEAN NOT NULL DEFAULT false,
  purpose             VARCHAR(20) NOT NULL DEFAULT 'order' CHECK (purpose IN ('order','advance')),
  gateway             VARCHAR(20),
  gateway_order_id    VARCHAR(100),
  gateway_payment_id  VARCHAR(100),
  refunded_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_reference    VARCHAR(100),
  refund_reason       TEXT,
  notes               TEXT,
  recorded_by         INT REFERENCES users(id) ON DELETE SET NULL,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR reservation_id IS NOT NULL),
  CHECK (refunded_amount <= amount)
);
CREATE INDEX idx_payments_branch ON payments(branch_id, created_at DESC);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_reservation ON payments(reservation_id);
CREATE UNIQUE INDEX uq_payments_gateway_order ON payments(gateway_order_id) WHERE gateway_order_id IS NOT NULL;

CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  invoice_number  VARCHAR(30) NOT NULL UNIQUE,
  branch_id       INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  order_id        INT UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  reservation_id  INT REFERENCES reservations(id) ON DELETE SET NULL,
  customer_name   VARCHAR(120),
  subtotal        NUMERIC(12,2) NOT NULL,
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst            NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst            NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_charge  NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_branch ON invoices(branch_id, issued_at DESC);

-- ---------- Reviews ----------
CREATE TABLE reviews (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id     INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  food_item_id  INT REFERENCES food_items(id) ON DELETE CASCADE,
  order_id      INT REFERENCES orders(id) ON DELETE SET NULL,
  rating        INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  images        JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_published  BOOLEAN NOT NULL DEFAULT true,
  admin_reply   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_branch ON reviews(branch_id, created_at DESC);
CREATE INDEX idx_reviews_food ON reviews(food_item_id);

-- ---------- Inventory ----------
CREATE TABLE suppliers (
  id              SERIAL PRIMARY KEY,
  restaurant_id   INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  contact_person  VARCHAR(120),
  phone           VARCHAR(30),
  email           VARCHAR(150),
  address         TEXT,
  gstin           VARCHAR(20),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_items (
  id             SERIAL PRIMARY KEY,
  branch_id      INT NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  supplier_id    INT REFERENCES suppliers(id) ON DELETE SET NULL,
  name           VARCHAR(150) NOT NULL,
  sku            VARCHAR(50),
  category       VARCHAR(50),
  unit           VARCHAR(20) NOT NULL DEFAULT 'kg',
  quantity       NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  cost_per_unit  NUMERIC(10,2) NOT NULL DEFAULT 0,
  expiry_date    DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);
CREATE INDEX idx_inventory_low ON inventory_items(branch_id) WHERE quantity <= min_quantity;

CREATE TABLE inventory_transactions (
  id                 SERIAL PRIMARY KEY,
  inventory_item_id  INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type               VARCHAR(20) NOT NULL CHECK (type IN ('stock_in','stock_out','adjustment','wastage')),
  quantity           NUMERIC(12,3) NOT NULL,
  unit_cost          NUMERIC(10,2),
  total_cost         NUMERIC(12,2),
  supplier_id        INT REFERENCES suppliers(id) ON DELETE SET NULL,
  reference          VARCHAR(100),
  notes              TEXT,
  balance_after      NUMERIC(12,3) NOT NULL,
  created_by         INT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_tx_item ON inventory_transactions(inventory_item_id, created_at DESC);

-- ---------- Notifications & audit ----------
CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,   -- recipient user (customer/staff)
  branch_id   INT REFERENCES restaurant_branches(id) ON DELETE CASCADE, -- branch-wide admin feed when user_id is null
  channel     VARCHAR(20) NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email','sms','whatsapp')),
  type        VARCHAR(50) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  recipient   VARCHAR(150),
  status      VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('pending','sent','failed','logged')),
  error       TEXT,
  link        VARCHAR(200),
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_branch ON notifications(branch_id, created_at DESC) WHERE user_id IS NULL;

CREATE TABLE audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  branch_id   INT REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  entity      VARCHAR(50),
  entity_id   VARCHAR(50),
  details     JSONB,
  ip          VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_branch ON audit_logs(branch_id, created_at DESC);
