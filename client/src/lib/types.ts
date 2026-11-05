export type Role = 'super_admin' | 'restaurant_admin' | 'manager' | 'waiter' | 'chef' | 'cashier' | 'customer';

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: Role;
  role_name: string;
  is_staff: boolean;
  permissions: string[];
  restaurant_id: number | null;
  branch_id: number | null;
  customer_id: number | null;
  email_verified: boolean;
}

export interface BranchSummary {
  id: number;
  name: string;
  city: string | null;
  address?: string | null;
  phone?: string | null;
  restaurant_id: number;
  restaurant_name: string;
  logo_url: string | null;
  cuisine?: string | null;
  opening_time?: string;
  closing_time?: string;
  images?: string[];
}

export interface BranchDetail extends BranchSummary {
  description: string | null;
  cover_url: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  map_url: string | null;
  email: string | null;
  restaurant_email: string | null;
  restaurant_phone: string | null;
  website: string | null;
  weekly_holidays: number[];
  images: string[];
  opening_time: string;
  closing_time: string;
  reservation_duration_min: number;
  min_guests: number;
  max_guests: number;
  max_advance_days: number;
  min_notice_minutes: number;
  cancellation_deadline_hours: number;
  advance_payment_required: boolean;
  advance_payment_amount: number;
  gst_rate: number;
  service_charge_rate: number;
  delivery_charge: number;
  min_delivery_order: number;
  accepts_delivery: boolean;
  accepts_takeaway: boolean;
  booking_policy: string | null;
  auto_confirm: boolean;
  avg_rating: number | null;
  review_count: number;
  sections: { id: number; name: string; location_type: string; description: string | null }[];
}

export interface FoodItem {
  id: number;
  category_id: number;
  category_name?: string;
  name: string;
  description: string | null;
  price: number;
  discounted_price: number | null;
  diet_type: 'veg' | 'non_veg' | 'vegan';
  is_available: boolean;
  prep_time_min: number;
  is_bestseller: boolean;
  is_recommended: boolean;
  spice_level: number;
  ingredients: string | null;
  allergens: string | null;
  avg_rating: number;
  rating_count: number;
  images: string[];
  times_ordered?: number;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order?: number;
  is_active?: boolean;
  item_count?: number;
}

export interface TableInfo {
  id: number;
  table_number: string;
  name: string | null;
  capacity: number;
  table_type: string;
  section_id: number | null;
  section_name: string | null;
  location_type: string | null;
}

export interface Slot {
  time: string;
  end_time: string;
  available: number;
  tables: TableInfo[];
}

export interface Availability {
  date: string;
  guests: number;
  closed: boolean;
  reason: string | null;
  duration_min: number;
  slots: Slot[];
}

export interface Reservation {
  id: number;
  booking_code: string;
  branch_id: number;
  branch_name?: string;
  restaurant_name?: string;
  customer_id: number | null;
  customer_name: string;
  phone: string;
  email: string | null;
  booking_date: string;
  start_at: string;
  end_at: string;
  guests: number;
  section_id: number | null;
  section_name?: string | null;
  seating_preference: string | null;
  occasion: string | null;
  special_requests: string | null;
  status: string;
  source: string;
  advance_amount: number;
  payment_status: string;
  admin_notes: string | null;
  cancel_reason: string | null;
  tables: { id: number; table_number: string; capacity: number; name?: string; section_name?: string }[] | string;
  created_at: string;
}

export interface OrderItem {
  id: number;
  food_item_id: number | null;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  notes: string | null;
}

export interface Order {
  id: number;
  order_code: string;
  branch_id: number;
  branch_name?: string;
  order_type: 'dine_in' | 'takeaway' | 'delivery';
  status: string;
  payment_status: string;
  payment_method: string | null;
  subtotal: number;
  discount: number;
  coupon_code: string | null;
  tax: number;
  service_charge: number;
  delivery_charge: number;
  total: number;
  amount_paid: number;
  contact_name: string | null;
  contact_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  table_id: number | null;
  table_number?: string | null;
  chef_name?: string | null;
  assigned_chef_id?: number | null;
  invoice_id?: number | null;
  invoice_number?: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at?: string;
}

export interface Quote {
  lines: { food_item_id: number; name: string; unit_price: number; quantity: number; line_total: number }[];
  subtotal: number;
  discount: number;
  coupon: { id: number; code: string; title: string } | null;
  gst_rate: number;
  service_charge_rate: number;
  tax: number;
  cgst: number;
  sgst: number;
  service_charge: number;
  delivery_charge: number;
  total: number;
}

export interface Coupon {
  id: number;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percent' | 'flat';
  discount_value: number;
  min_order_amount: number;
  max_discount: number | null;
  valid_to: string | null;
  image_url: string | null;
}

export interface Review {
  id: number;
  rating: number;
  comment: string | null;
  images: string[];
  admin_reply: string | null;
  created_at: string;
  food_item_id: number | null;
  food_name: string | null;
  customer_name: string;
  avatar_url?: string | null;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface PaymentInit {
  payment_id: number;
  payment_code: string;
  mode: 'razorpay' | 'mock';
  key_id: string | null;
  gateway_order_id: string;
  amount: number;
  amount_paise: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string | null };
}
