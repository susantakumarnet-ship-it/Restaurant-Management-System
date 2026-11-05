# Smart RMS REST API

Base URL: `/api`. All requests and responses use JSON unless noted.

**Authentication.** Send `Authorization: Bearer <JWT>`. You get a token from `/auth/login`, `/auth/verify-otp` or `/auth/google`.

**Admin scope.** Every `/admin/*` call (except `/admin/context`) needs the header `X-Branch-Id: <branchId>`. The server checks that the caller may access that branch.

**Errors** look like this:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "guests: Number expected", "details": [] } }
```

| Status | Code |
|---|---|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `UNVERIFIED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `TABLE_UNAVAILABLE`, `NO_AVAILABILITY`, `DUPLICATE`, `IN_USE` |
| 413 | `FILE_TOO_LARGE` |
| 422 | `VALIDATION_ERROR`, `INVALID_VALUE` |
| 429 | `RATE_LIMITED`, `OTP_THROTTLED` |
| 500 | `INTERNAL` |

**Value formats.** Money values are numbers in INR. Dates use `YYYY-MM-DD`. Reservation times use local `YYYY-MM-DDTHH:mm:ss`.

---

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, db, time }` |

## Auth (`/auth`)
| Method | Path | Body / notes |
|---|---|---|
| POST | `/register` | `{ name, email, phone, password }` → 201 `{ email, devOtp? }`. Sends an OTP by email and SMS. |
| POST | `/verify-otp` | `{ identifier, code }` → `{ token, user }` |
| POST | `/resend-otp` | `{ identifier }` |
| POST | `/login` | `{ identifier (email or mobile), password }` → `{ token, user }`. Unverified customers get 403 `UNVERIFIED`, and a new OTP is sent. |
| POST | `/forgot-password` | `{ identifier }`. The response is the same whether or not the account exists. |
| POST | `/reset-password` | `{ identifier, code, password }` |
| POST | `/google` | `{ credential }` (Google ID token). Requires `GOOGLE_CLIENT_ID`. |
| GET | `/config` | `{ googleClientId, paymentMode, razorpayKeyId }` |
| GET | `/me` | `{ user, customer }` (customer has loyalty points, total spent, address, dates) |
| PUT | `/me` | `{ name?, phone?, avatar_url?, address?, date_of_birth?, anniversary? }` |
| PUT | `/me/password` | `{ currentPassword, newPassword }` |

The password policy is at least 8 characters, including a letter and a number. In development, `devOtp` is included in responses (`EXPOSE_OTP`).

## Public (`/public`, no auth)
| Method | Path | Notes |
|---|---|---|
| GET | `/branches` | Active branches with restaurant name, logo and cuisine |
| GET | `/branches/:id` | Branch, restaurant, public booking/billing settings, sections, rating |
| GET | `/branches/:id/menu` | `{ categories, items }`. Items include images, rating and `times_ordered`. |
| GET | `/branches/:id/offers` | Active public coupons |
| GET | `/branches/:id/reviews?foodItemId=` | Published reviews |
| GET | `/branches/:id/availability?date&guests&sectionId?&excludeReservationId?` | `{ closed, reason, duration_min, slots:[{ time, end_time, available, tables:[…] }] }` |
| POST | `/cart/quote` | `{ branch_id, order_type, coupon_code?, items:[{food_item_id, quantity}] }` → server-side totals (subtotal, discount, GST split into CGST/SGST, service charge, delivery charge, total) |
| POST | `/coupons/validate` | `{ branch_id, code, subtotal }` → `{ discount, coupon }` |

## Customer (`/customer`, auth required)
| Method | Path | Notes |
|---|---|---|
| GET | `/bookings` | Your bookings |
| GET | `/bookings/:id` | Booking with tables, history, linked orders, `cancellation_deadline_hours` |
| POST | `/bookings` | `{ branch_id, customer_name, phone, email?, date, time, guests, section_id?, table_ids?, seating_preference?, occasion?, special_requests?, pre_order?:{items, coupon_code?} }` → 201 `{ booking, order }` |
| PUT | `/bookings/:id` | Modify date, time, guests or details. Availability is re-checked and the cancellation deadline enforced. |
| POST | `/bookings/:id/cancel` | `{ reason? }`. Releases the tables and refunds a paid advance. |
| GET | `/bookings/:id/confirmation.pdf` | PDF |
| GET | `/orders` | Your orders |
| GET | `/orders/:id` | Order with items, payments, invoice and `reviewed_items` |
| POST | `/orders` | `{ branch_id, order_type, items:[{food_item_id, quantity, notes?}], coupon_code?, contact_name, contact_phone, delivery_address?, notes?, reservation_id?, payment_method:'online'\|'cash' }` |
| POST | `/orders/:id/cancel` | Only while the order is pending or confirmed. Paid amounts are refunded automatically. |
| GET | `/orders/:id/invoice.pdf` | GST invoice (PDF) |
| POST | `/payments/create` | `{ order_id \| reservation_id }` → `{ payment_id, mode, key_id, gateway_order_id, amount, amount_paise, … }` |
| POST | `/payments/verify` | `{ payment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }` |
| POST | `/payments/mock-complete` | `{ payment_id, success }`. Mock mode only. |
| GET | `/payments` | Your payment history |
| GET | `/reviews` | Your reviews |
| POST | `/reviews` | `{ branch_id, rating 1-5, comment?, food_item_id?, order_id?, images?[] }` |
| GET | `/notifications` | `{ items, unread }` |
| POST | `/notifications/:id/read`, `/notifications/read-all` | |

## Uploads
| Method | Path | Notes |
|---|---|---|
| POST | `/uploads` | multipart field `files` (up to 5 images; jpg, png, webp or gif; at most `MAX_UPLOAD_MB`) → `{ urls, url }` |

## Payments webhook
| Method | Path | Notes |
|---|---|---|
| POST | `/payments/webhook` | Razorpay `payment.captured`. Verifies the `X-Razorpay-Signature` header against the raw body. |

---

## Admin (`/admin`, staff only; requires the `X-Branch-Id` header)

Each section lists the permission it requires; a slash means any one of them is enough.

### Context and dashboard
| Method | Path | Perm |
|---|---|---|
| GET | `/context` | any staff. Returns `{ user, branches, integrations }` and needs no branch header. |
| GET | `/dashboard?days=7..90` | `dashboard.view`. Returns `cards`, `charts.{daily_revenue, monthly_sales, reservations_by_day, reservation_status, order_status, order_types, category_performance}`, `popular_items`, `today_reservations`, `recent_orders`. |

### Restaurant and settings (`restaurant.manage` for writes)
| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/restaurant` | Profile, logo, cover, GSTIN… |
| GET / POST | `/branches` | Hours, holidays (0=Sun…6=Sat), images, coordinates, map_url |
| PUT / DELETE | `/branches/:id` | Delete deactivates the branch instead if it has history |
| GET / PUT | `/settings` | Booking and billing rules for the current branch |

### Tables (`tables.view` to read, `tables.manage` to write)
| Method | Path | Notes |
|---|---|---|
| GET | `/tables/live?at=YYYY-MM-DDTHH:mm` | `live_status` is available, reserved, occupied or maintenance; also returns the current and next booking |
| PATCH | `/tables/:id/status` | `{ status, maintenance_note? }` |
| CRUD | `/tables` | Filters `q`, `sectionId`, `status`, `type`. Delete is blocked while the table has upcoming bookings. |
| CRUD | `/sections` | |

### Menu (`menu.manage`)
| Method | Path | Notes |
|---|---|---|
| CRUD | `/categories` | Delete is blocked while the category has items |
| GET | `/food-items?q&categoryId&diet` | `orders.view` can also read |
| POST / PUT / DELETE | `/food-items[/:id]` | Includes `images[]` (the first image is the primary one) |
| PATCH | `/food-items/:id/availability` | `{ is_available }` |

### Reservations (`reservations.view` to read, `reservations.manage` to write)
| Method | Path | Notes |
|---|---|---|
| GET | `/reservations?q&status&date&from&to&time&tableId&sectionId&sort=upcoming\|latest\|created` | |
| GET | `/reservations/calendar?month=YYYY-MM` | Per-day totals by status |
| GET | `/reservations/availability?date&guests&sectionId&excludeReservationId` | Staff mode: notice and advance-window limits are relaxed |
| GET | `/reservations/:id` | Booking with history, payments, orders and customer stats |
| POST | `/reservations` | Walk-in or phone booking: `{ customer_name, phone, email?, date, time, guests, table_ids?, section_id?, occasion?, special_requests?, admin_notes?, source, status? }` |
| PUT | `/reservations/:id` | Modify |
| PATCH | `/reservations/:id/status` | `{ status, note? }`. Only valid transitions are accepted. |
| PUT | `/reservations/:id/tables` | `{ table_ids }` (combine tables) |
| POST | `/reservations/:id/notify` | Resend the status notification |
| GET | `/reservations/:id/confirmation.pdf` | |

### Orders (`orders.view` to read, `orders.manage` to write)
| Method | Path | Notes |
|---|---|---|
| GET | `/orders?q&status(active\|…)&type&payment&date&from&to` | |
| GET | `/orders/:id` | Order with payments |
| POST | `/orders` | POS order (staff-created orders start as confirmed) |
| PATCH | `/orders/:id/status` | `{ status, reason? }`. Flow: pending → confirmed → preparing → ready → served (dine-in) or delivered (delivery) → completed. Completing awards loyalty points. Cancelling refunds automatically. |
| PATCH | `/orders/:id/assign` | `{ chef_id }`. A confirmed order moves to preparing. |

### Payments and billing (`payments.manage`)
| Method | Path | Notes |
|---|---|---|
| GET | `/payments?status&method&purpose&from&to&q` | |
| GET | `/payments/summary?from&to` | Totals by method, refunded, failed, pending |
| POST | `/payments` | `{ order_id \| reservation_id, method: cash\|upi\|card, amount? (partial), notes? }` |
| POST | `/payments/:id/refund` | `{ amount? (partial), reason }`. Goes through Razorpay when the payment was made there. |
| GET | `/invoices?q&from&to` | |
| POST | `/orders/:id/invoice` | Generate an invoice (idempotent) |
| GET | `/invoices/:id/pdf` | |
| CRUD | `/coupons` | `coupons.manage` |

### Customers
| Method | Path | Notes |
|---|---|---|
| GET | `/customers?q&status` | `customers.view` |
| GET | `/customers/:id` | Profile, spend, bookings, orders, reviews |
| PATCH | `/customers/:id` | `{ status, loyalty_points, notes }`. Requires `customers.manage`. |

### Staff (`staff.manage`)
| Method | Path | Notes |
|---|---|---|
| CRUD | `/employees?position&status&q` | Terminating an employee disables their login |
| POST | `/employees/:id/account` | `{ email, password?, role, is_active }` |
| GET | `/shifts?from&to&employeeId` | |
| POST | `/shifts` | `{ employee_id, shift_date, start_time, end_time, repeat_days? }` |
| PUT / DELETE | `/shifts/:id` | |
| POST | `/shifts/:id/check-in`, `/shifts/:id/check-out` | Check-in more than 10 minutes after the shift start is marked late |
| GET | `/attendance/summary?from&to` | |
| GET | `/roles` | `{ roles, permissions }` |
| PUT | `/roles/:id/permissions` | `{ permissions: [...] }`. Requires `roles.manage`. |

### Inventory (`inventory.manage`)
| Method | Path | Notes |
|---|---|---|
| CRUD | `/inventory` | Each item includes a `stock_status` of low, expiring or ok |
| GET | `/inventory/alerts?days=7` | `{ low, expiring }` |
| GET / POST | `/inventory/transactions` | `{ inventory_item_id, type: stock_in\|stock_out\|adjustment\|wastage, quantity, unit_cost?, supplier_id?, reference?, notes?, expiry_date? }`. An `adjustment` sets the stock to an absolute count. |
| CRUD | `/suppliers` | |

### Reviews, reports, notifications and audit
| Method | Path | Perm |
|---|---|---|
| GET | `/reviews?rating&type=food\|restaurant` | `reviews.manage` |
| PATCH / DELETE | `/reviews/:id` | `reviews.manage`. PATCH body: `{ is_published?, admin_reply? }` |
| GET | `/reports` | `reports.view`. Returns the available report types. |
| GET | `/reports/:type?from&to&period&status&format=json\|xlsx\|pdf` | `reports.view`. Types: `sales_daily, revenue, bookings, cancelled_bookings, customers, food_sales, payments, gst, inventory`. |
| GET | `/notifications` | any staff. Branch admin feed. |
| POST | `/notifications/:id/read`, `/notifications/read-all` | any staff |
| GET | `/notifications/outbox` | `reservations.manage` / `orders.manage`. Email, SMS and WhatsApp delivery log. |
| GET | `/audit-logs?q` | `audit.view` |

---

## Super admin (`/super`, `super_admin` role only)
| Method | Path | Notes |
|---|---|---|
| GET | `/overview` | Platform totals, per-restaurant 30-day figures, 12-month revenue |
| GET / POST | `/restaurants` | POST also creates the first branch: `branch_name`, `city` |
| PUT / DELETE | `/restaurants/:id` | Subscription plan, status and expiry; `is_active`. Delete deactivates the restaurant instead if it has history. |
| GET / POST | `/admins` | Staff accounts: `{ name, email, phone?, password, role, restaurant_id, branch_id?, is_active }` |
| PUT | `/admins/:id` | You cannot demote or deactivate yourself |
| GET / PUT | `/settings` | Key/value system settings |
| GET | `/reports/:type?from&to&restaurantId&format` | Consolidated across restaurants |
| GET | `/audit-logs?q` | |
