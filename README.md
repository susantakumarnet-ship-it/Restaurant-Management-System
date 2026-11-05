# Smart Restaurant Management System

A full-stack restaurant platform with two portals:

- **Admin dashboard.** Super admins manage restaurants. Restaurant admins and staff run branches: reservations, tables, orders and kitchen, menu, inventory, staff, payments, reports.
- **Customer portal.** Customers browse the menu, book tables, order and pay online, and track their bookings and orders.

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts, lucide icons. The UI kit is in `client/src/components/ui`. |
| Backend | Node.js 20+, Express REST API, JWT auth, role-based access control (RBAC), zod validation, helmet, rate limiting |
| Database | PostgreSQL with SQL migrations, FKs, CHECK constraints and indexes. Dev and test use embedded PostgreSQL (PGlite), so nothing needs installing. |
| Integrations | Razorpay (with a built-in mock gateway), SMTP email via nodemailer, Twilio SMS, WhatsApp Cloud API, Google Sign-In, Google Maps embeds |
| Documents | PDF invoices, booking confirmations and report PDFs (pdfkit); Excel exports (exceljs) |
| Tests | Vitest + Supertest. 89 backend integration tests on a real Postgres engine, plus frontend unit tests. |

---

## 1. Quick start (local, zero setup)

Prerequisite: **Node.js 20+** (tested on Node 24).

```bash
# 1. API
cd server
cp .env.example .env        # optional; defaults work for local dev
npm install
npm run dev                 # http://localhost:4000. First run creates the DB and loads demo data.

# 2. Web app (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173 (proxies /api and /uploads to :4000)
```

Without `DATABASE_URL`, the API uses **PGlite**, a full PostgreSQL build that runs in-process and stores data in `server/data/pglite`. Migrations run automatically on start, and an empty database is seeded with demo data.

### Demo accounts

| Role | Login | Password |
|---|---|---|
| Customer | `customer@example.com` | `Customer@123` |
| Restaurant admin (ROOFTOP LONDON CAFE & RESTAURANT) | `admin@saffronsage.com` | `Admin@123` |
| Branch manager / waiter / chef / cashier | `manager@` / `waiter@` / `chef@` / `cashier@saffronsage.com` | `Admin@123` |
| Second restaurant admin (The Coastal Grill) | `admin@coastalgrill.com` | `Admin@123` |
| Super admin | `super@smartrms.com` | `Admin@123` |

The login page has one-click buttons for these. The demo data contains 2 restaurants, 3 branches, 30 dishes, about 90 days of orders, payments and invoices, bookings 60 days back and 14 days ahead, reviews, staff shifts, and inventory with movements.

Useful commands (in `server/`):

```bash
npm run db:reset   # drop everything, migrate, reseed
npm run migrate    # apply pending migrations only
npm run seed       # seed an empty database
npm run db:backup  # pg_dump (Postgres) or data-dir tarball (PGlite) into server/backups, keeps 14
npm test           # integration test suite
```

---

## 2. Features

### Customer portal
- **Accounts:** register with name, mobile and email, then verify with a 6-digit OTP. Log in with email or mobile. Forgot/reset password by OTP. Google login appears when `GOOGLE_CLIENT_ID` is set. Profile covers avatar, address, birthday and anniversary, plus password change, loyalty points, reviews and payments.
- **Home:** hero gallery, open/closed status, rating, opening hours and holidays, contact details, categories, special offers (copy code), popular and recommended dishes, guest reviews, Google Maps embed with directions. Branch picker for multi-branch restaurants.
- **Menu:** search, Veg/Non-Veg/Vegan filter, category chips, sort, "available now" filter. Dish detail shows image gallery, ingredients, allergens, spice level, prep time and dish reviews. Cart with quantities is saved per branch.
- **Checkout:** dine-in, takeaway or delivery (per-branch settings). Coupons are validated server-side. Server-side quote includes GST split into CGST + SGST, service charge, delivery charge and minimum order. Pay online through Razorpay (UPI, card, net banking) or pay on delivery/at the counter.
- **Table booking:** pick a date (holidays blocked), party size and seating area. Shows only time slots that are actually free, with table counts. Optionally pick a specific table. Add occasion and special requests, and optionally pre-order the cart. Advance payment when the branch requires it. Generates a booking ID and a confirmation page.
- **My bookings:** upcoming, history and cancelled lists. Booking detail shows a status timeline. Modify (re-checks availability) or cancel within the cancellation deadline (paid advance refunded automatically). Pay a pending advance. Download a PDF confirmation or an `.ics` calendar file.
- **My orders:** live tracking (auto-refresh), pay outstanding amounts, cancel while pending/confirmed (auto-refund), download the GST invoice PDF, reorder, rate individual dishes with photos.
- **Reviews:** rating distribution, filters, restaurant reviews with photo uploads, restaurant replies.
- **Notifications:** in-app feed with bell and unread count, plus email/SMS/WhatsApp.
- Responsive layout with a mobile bottom navigation bar.

### Admin dashboard
- **Dashboard:** today's/pending/confirmed/cancelled reservations, total and active orders, today's and monthly revenue, customers, available/occupied/reserved tables, low stock. Charts for daily revenue, orders per day, 12-month sales, reservations by day (including the next 7 days), reservation/order status, order types and category performance. Also popular dishes, today's bookings and recent orders.
- **Reservations:** list with search (booking ID, name, phone) and filters (status, date, time, table, area). Status tabs with counts and a month calendar. Detail drawer: approve, reject, check in, seat, complete, no-show or cancel (only valid transitions are offered), assign or combine tables with overlap protection, modify, resend notification, PDF. New phone/walk-in booking with live slot availability.
- **Tables & floor:** live floor grid by section, colour-coded available/reserved/occupied/maintenance, with current and next booking. It can show the floor at any time. Quick status changes. CRUD for tables (number, name, capacity, type: 2/4/6-seater, family, VIP) and sections (indoor, outdoor, rooftop, private).
- **Orders & kitchen:** kanban kitchen board with auto-refresh. Order flow: Pending â†’ Confirmed â†’ Preparing â†’ Ready â†’ Served/Delivered â†’ Completed. Assign a chef, which moves the order to preparing. Cancel with automatic refund. Full order list with filters. POS "new order" with live pricing. Record cash/UPI/card and partial payments. Generate and download invoices.
- **Food menu:** item grid with an availability toggle, bestseller/recommended tags, discounted price, Veg/Non-Veg/Vegan, prep time, spice level, ingredients, allergens and up to 8 images. Category management.
- **Customers:** profiles with booking history, order history, total spend, loyalty points and feedback. Block/unblock, adjust points, internal notes.
- **Staff:** employees (waiter, chef, cashier, manager, host and others). Create a login account with a role. Weekly shift scheduling with repeat days, check-in/out (late detection) and attendance marking. Attendance summary. Role-permission matrix editor.
- **Inventory:** items with stock, minimum level, cost, supplier and expiry. Stock in/out, adjustment and wastage, with a running balance. Low-stock and expiry alerts (low stock also posts to the admin notification feed). Suppliers and purchase history.
- **Payments & billing:** summary by method, transactions with filters, full/partial refunds (through Razorpay when the payment was made there), record counter payments against an order or booking, invoices list with PDF download.
- **Offers & coupons:** percent or flat discount, minimum order, maximum discount, validity dates, total and per-user usage limits, public/private, image.
- **Reviews:** moderation (publish/hide), replies, delete; dish ratings are recalculated.
- **Reports** (JSON, Excel and PDF): daily sales, weekly/monthly revenue, bookings, cancelled bookings, customers, food sales, payments, GST, inventory and usage.
- **Settings:** restaurant profile and logo, branches (address, coordinates with map preview, hours, weekly holidays, images), and booking/billing rules: duration (60/90/120 or custom), buffer, slot interval, min/max guests, advance window, minimum notice, cancellation deadline, auto-confirm, advance payment, GST, service charge, delivery, loyalty rate, booking policy.
- **Notifications:** admin inbox plus a delivery log of every email/SMS/WhatsApp message with its status.
- **Audit logs:** every successful admin create/update/delete is recorded with user, IP and payload. Passwords and OTPs are redacted.

### Super admin
Platform overview (totals, 12-month revenue, per-restaurant performance), consolidated reports across all restaurants or one, restaurant CRUD with subscription plan/status/expiry, admin account management (any staff role, pinned to a restaurant and optionally one branch), system settings, platform audit log. Super admins can also open any branch's dashboard from the branch switcher.

---

## 3. Booking engine

Code: `server/src/services/booking.js`. Tests: `server/tests/booking.test.js`.

- **Slots** are generated from branch opening hours, using the configured slot interval and reservation duration. A booking must finish before closing time.
- **Availability** for a date and party size considers active, non-maintenance tables with `capacity â‰¥ guests`, optionally filtered by section. A table is free for `[start, end)` unless an active booking block overlaps it, including the buffer: `existing.start < new.end + buffer AND existing.end + buffer > new.start`.
- **Rules:** minimum/maximum guests, maximum advance days, minimum notice, weekly holidays, cancellation deadline for customer changes, only valid status transitions.
- **Double booking is prevented** inside a database transaction. The transaction locks every candidate `tables` row (`SELECT â€¦ FOR UPDATE`), re-checks overlaps, then inserts. Concurrent requests for the same table queue up: the first commits, and the others see its rows and get `409 TABLE_UNAVAILABLE` / `NO_AVAILABILITY`. A test fires 6 simultaneous requests for one table and asserts exactly one succeeds.
- **Auto-assignment** picks the smallest table that fits. Staff can combine several tables for large parties.
- **Releasing tables:** rejecting, cancelling or marking a no-show deactivates the booking's table blocks immediately. Completing a booking shortens the block to "now", so the table frees up early.
- Every change is recorded in `reservation_status_history`.

Statuses: `pending, confirmed, rejected, checked_in, seated, completed, cancelled, no_show`.

---

## 4. Payments

| Mode | When | Flow |
|---|---|---|
| `razorpay` | `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set | Server creates the Razorpay order â†’ Razorpay Checkout in the browser â†’ server verifies the HMAC signature (`/customer/payments/verify`) â†’ order/booking updated, invoice issued. The webhook `POST /api/payments/webhook` (`payment.captured`, raw-body signature check) is an idempotent backup if the browser closes first. |
| `mock` | No keys (default for dev/demo) | Same server flow, with a simulated checkout dialog (UPI/Card/Net banking, plus "simulate failure"). It is disabled automatically once Razorpay keys exist. |

Cash, UPI and card payments at the counter (including partial payments) are recorded by staff. Refunds go through Razorpay when the payment was made there. Each refund updates the payment, order or booking status and notifies the customer. GST is split into CGST and SGST on invoices.

## 5. Notifications

`server/src/services/notify.js` writes every message to the `notifications` table (in-app, email, sms, whatsapp) with a delivery status.

| Channel | Configure | Without config |
|---|---|---|
| Email | `SMTP_*` (any SMTP: SES, SendGrid, Gmailâ€¦) | stored as `logged` and printed to the console in dev |
| SMS | `TWILIO_*` | `logged` |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (Meta Cloud API) | skipped |

Triggers: registration, OTP, booking received/confirmed/rejected/cancelled/modified/completed/no-show, booking reminder (scheduler every 5 min, about 3 h before), order placed/confirmed/preparing/ready/delivered/cancelled, payment successful, refund processed, staff account created, low stock (admin feed).

---

## 6. Database

Schema: `server/src/db/migrations/001_initial_schema.sql`. Migration runner: `npm run migrate`. Each file runs in its own transaction and is tracked in `schema_migrations`.

Tables: `users, roles, permissions, role_permissions, restaurants, restaurant_branches, restaurant_settings, system_settings, otp_codes, customers, table_sections, tables, food_categories, food_items, food_images, coupons, reservations, reservation_tables, reservation_status_history, employees, staff_shifts, orders, order_items, payments, invoices, reviews, suppliers, inventory_items, inventory_transactions, notifications, audit_logs`.

- Primary keys, foreign keys (`CASCADE` / `SET NULL` / `RESTRICT` as appropriate), `UNIQUE` constraints (case-insensitive email, phone, booking/order/payment codes, table number per branch, coupon code per restaurant), and `CHECK` constraints (status enums, capacities, prices, discount â‰¤ price, refunded â‰¤ amount, closing > opening).
- Indexes for the hot paths: the partial overlap index `reservation_tables(table_id, start_at, end_at) WHERE active`, plus branch/date, status, customer, created_at and partial low-stock indexes.
- Roles and permissions are defined in `server/src/rbac.js` and synced on every migrate. Admin edits to role permissions are preserved.

Reservation times are stored as local wall-clock `TIMESTAMP`. Set `TZ` to the restaurant's timezone; the DB session timezone is set to match automatically.

---

## 7. Security

- Passwords hashed with bcrypt; OTPs stored hashed, with expiry, attempt limits and resend throttling. Forgot-password gives the same response whether or not the account exists, so it can't be used to discover accounts.
- JWT bearer authentication. Users and permissions are re-loaded server-side (15 s cache), so deactivating someone or changing a role takes effect quickly.
- **RBAC:** permission checks on every admin route, plus **tenant isolation**. Staff can only reach branches of their own restaurant (and only their own branch if pinned to one). Foreign keys sent by the client are checked against the same tenant.
- zod validation on every input; unknown fields are stripped. All SQL is parameterised. Dynamic column names only ever come from schema keys, never user input.
- React escapes output (XSS); helmet security headers; CORS allow-list.
- Rate limits: 1000 requests / 15 min per IP overall, and 30 / 15 min on login, register, OTP and password endpoints.
- Uploads: image MIME types only, magic-byte sniffing, size limit, random file names.
- Payments: Razorpay signatures verified with a constant-time comparison; prices and totals are always recomputed on the server; coupon usage is incremented atomically.
- Audit log of admin mutations with secrets redacted.
- Backups: `npm run db:backup`, which keeps the latest 14.
- Production refuses to start with the default `JWT_SECRET`, and OTPs are never returned in API responses.

---

## 8. Deployment

### Docker (recommended)
```bash
cp server/.env.example server/.env   # set JWT_SECRET, Razorpay/SMTP/Twilio keys, TZ, CLIENT_URL
docker compose up -d --build         # PostgreSQL 16 + app on http://localhost:4000
docker compose exec app npm run seed # optional demo data
```
The image builds the React app and serves it from the API, so a single container on one port serves everything.

### Manual
1. Provision PostgreSQL 14+ and set `DATABASE_URL`, `NODE_ENV=production`, `JWT_SECRET`, `TZ` and `CLIENT_URL`.
2. Build the client: `cd client && npm ci && npm run build`. The API serves `client/dist` automatically. Alternatively, host `dist/` on a CDN and set `VITE_API_URL` before building.
3. Start the API: `cd server && npm ci --omit=dev && npm run migrate && npm start`. Run it under a process manager such as pm2 or systemd, behind an HTTPS reverse proxy.
4. Razorpay dashboard: add the webhook `https://<host>/api/payments/webhook` (event `payment.captured`) and set `RAZORPAY_WEBHOOK_SECRET`.
5. Schedule `npm run db:backup` (cron), or use your managed database's backups and point-in-time recovery.
6. **Cloud storage:** uploads are stored on local disk (`UPLOAD_DIR`, served at `/uploads`). For S3, GCS or Cloudinary, replace `store()` in `server/src/routes/uploads.js`. It is the only function that writes files; everything else just stores the returned URL.

---

## 9. Tests

```bash
cd server && npm test   # 89 integration tests, fresh in-memory PostgreSQL per file
cd client && npm test   # unit tests (formatting, form/payload mapping)
cd client && npm run build   # type-check + production build
```

Backend coverage:
- **Auth:** register, OTP, login by email or phone, reset, profile.
- **Authorization:** RBAC, tenant isolation, role-permission edits.
- **Booking engine:** slots, holidays, capacity, buffer, concurrency, modify, cancel/deadline, walk-in, multiple tables.
- **Orders and payments:** pricing, coupons and limits, GST, mock gateway, invoices, kitchen flow, loyalty, partial payments, refunds, cancellations.
- **Admin:** CRUD validation, inventory, staff accounts and shifts, dashboard, report exports, audit-log redaction.

---

## 10. Project structure

```
server/
  src/
    app.js, index.js, config.js, rbac.js
    db/        index.js (pg / PGlite adapter), migrate.js, seed.js, migrations/*.sql
    middleware/ auth.js (JWT, RBAC, branch scope), audit.js
    services/  booking.js, orders.js, payments.js, notify.js, reports.js, pdf.js, scheduler.js
    routes/    auth.js, public.js, customer.js, uploads.js, superadmin.js, admin/*.js
  tests/       *.test.js (Vitest + Supertest)
  scripts/     backup.js, smoke.js
client/
  src/
    lib/        api.ts, format.ts, types.ts
    context/    Auth, Admin (branch), Shop (branch + cart), Payment (Razorpay/mock)
    components/ ui/* (design system), CrudPage, CartDrawer, FoodCard, NotificationBell...
    layouts/    AdminLayout, CustomerLayout
    pages/      customer/*, auth/*, admin/*, super/*
docs/API.md     REST API reference
```

## 11. Known limitations

- On PGlite (single connection), concurrent booking requests are serialised by the engine itself. On PostgreSQL, the row locks described above do the work. Both paths run the same code.
- Uploaded files go to local disk until a cloud storage adapter is plugged in (see Â§8.6).
- Restaurants that close after midnight (closing time earlier than opening time) are not supported by the slot generator.
- System settings keys can be added and edited from the super admin UI but not deleted (there is no delete endpoint).

