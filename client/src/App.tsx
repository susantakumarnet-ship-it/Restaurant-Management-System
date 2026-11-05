import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner, EmptyState, Button } from './components/ui';
import { CustomerLayout } from './layouts/CustomerLayout';
import { AdminLayout, SuperLayout } from './layouts/AdminLayout';

// ---- Customer portal ----
const Home = lazy(() => import('./pages/customer/Home'));
const MenuPage = lazy(() => import('./pages/customer/Menu'));
const BookTable = lazy(() => import('./pages/customer/BookTable'));
const BookingConfirmation = lazy(() => import('./pages/customer/BookingConfirmation'));
const Checkout = lazy(() => import('./pages/customer/Checkout'));
const MyBookings = lazy(() => import('./pages/customer/MyBookings'));
const BookingDetail = lazy(() => import('./pages/customer/BookingDetail'));
const MyOrders = lazy(() => import('./pages/customer/MyOrders'));
const OrderDetail = lazy(() => import('./pages/customer/OrderDetail'));
const Profile = lazy(() => import('./pages/customer/Profile'));
const ReviewsPage = lazy(() => import('./pages/customer/Reviews'));
const CustomerNotifications = lazy(() => import('./pages/customer/Notifications'));
// ---- Auth ----
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
// ---- Admin ----
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Reservations = lazy(() => import('./pages/admin/Reservations'));
const Tables = lazy(() => import('./pages/admin/Tables'));
const Orders = lazy(() => import('./pages/admin/Orders'));
const AdminMenu = lazy(() => import('./pages/admin/Menu'));
const Coupons = lazy(() => import('./pages/admin/Coupons'));
const Inventory = lazy(() => import('./pages/admin/Inventory'));
const Customers = lazy(() => import('./pages/admin/Customers'));
const Staff = lazy(() => import('./pages/admin/Staff'));
const Payments = lazy(() => import('./pages/admin/Payments'));
const AdminReviews = lazy(() => import('./pages/admin/Reviews'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const AdminNotifications = lazy(() => import('./pages/admin/Notifications'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
// ---- Super admin ----
const SuperOverview = lazy(() => import('./pages/super/Overview'));
const SuperRestaurants = lazy(() => import('./pages/super/Restaurants'));
const SuperAdmins = lazy(() => import('./pages/super/Admins'));
const SuperSettings = lazy(() => import('./pages/super/SystemSettings'));

function RequireAuth({ children, staff, superOnly, customer }: { children: ReactNode; staff?: boolean; superOnly?: boolean; customer?: boolean }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner className="h-[60vh]" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (superOnly && user.role !== 'super_admin') return <Forbidden />;
  if (staff && !user.is_staff) return <Forbidden />;
  if (customer && user.is_staff) return <Navigate to={user.role === 'super_admin' ? '/super' : '/admin'} replace />;
  return <>{children}</>;
}

function RequirePerm({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { hasPerm } = useAuth();
  return hasPerm(...perms) ? <>{children}</> : <Forbidden />;
}

function Forbidden() {
  return <EmptyState className="py-24" title="Access denied" description="You don't have permission to view this page." action={<Button onClick={() => history.back()}>Go back</Button>} />;
}

/** Staff without dashboard access land on their first permitted module. */
function AdminIndex() {
  const { hasPerm } = useAuth();
  if (hasPerm('dashboard.view')) return <Dashboard />;
  if (hasPerm('orders.view', 'orders.manage')) return <Navigate to="/admin/orders" replace />;
  if (hasPerm('reservations.view')) return <Navigate to="/admin/reservations" replace />;
  if (hasPerm('inventory.manage')) return <Navigate to="/admin/inventory" replace />;
  return <Navigate to="/admin/notifications" replace />;
}

const P = (perms: string[], el: ReactNode) => <RequirePerm perms={perms}>{el}</RequirePerm>;

export default function App() {
  return (
    <Suspense fallback={<Spinner className="h-[60vh]" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        <Route element={<CustomerLayout />}>
          <Route index element={<Home />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="book" element={<BookTable />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="checkout" element={<RequireAuth customer><Checkout /></RequireAuth>} />
          <Route path="booking/confirmed/:id" element={<RequireAuth customer><BookingConfirmation /></RequireAuth>} />
          <Route path="my/bookings" element={<RequireAuth customer><MyBookings /></RequireAuth>} />
          <Route path="my/bookings/:id" element={<RequireAuth customer><BookingDetail /></RequireAuth>} />
          <Route path="my/orders" element={<RequireAuth customer><MyOrders /></RequireAuth>} />
          <Route path="my/orders/:id" element={<RequireAuth customer><OrderDetail /></RequireAuth>} />
          <Route path="my/profile" element={<RequireAuth customer><Profile /></RequireAuth>} />
          <Route path="my/notifications" element={<RequireAuth customer><CustomerNotifications /></RequireAuth>} />
        </Route>

        <Route path="/admin" element={<RequireAuth staff><AdminLayout /></RequireAuth>}>
          <Route index element={<AdminIndex />} />
          <Route path="reservations" element={P(['reservations.view', 'reservations.manage'], <Reservations />)} />
          <Route path="tables" element={P(['tables.view', 'tables.manage'], <Tables />)} />
          <Route path="orders" element={P(['orders.view', 'orders.manage'], <Orders />)} />
          <Route path="menu" element={P(['menu.manage'], <AdminMenu />)} />
          <Route path="coupons" element={P(['coupons.manage'], <Coupons />)} />
          <Route path="inventory" element={P(['inventory.manage'], <Inventory />)} />
          <Route path="customers" element={P(['customers.view', 'customers.manage'], <Customers />)} />
          <Route path="staff" element={P(['staff.manage'], <Staff />)} />
          <Route path="payments" element={P(['payments.manage'], <Payments />)} />
          <Route path="reviews" element={P(['reviews.manage'], <AdminReviews />)} />
          <Route path="reports" element={P(['reports.view'], <Reports />)} />
          <Route path="notifications" element={<AdminNotifications />} />
          <Route path="settings" element={P(['restaurant.manage'], <Settings />)} />
          <Route path="audit-logs" element={P(['audit.view'], <AuditLogs />)} />
        </Route>

        <Route path="/super" element={<RequireAuth superOnly><SuperLayout /></RequireAuth>}>
          <Route index element={<SuperOverview />} />
          <Route path="restaurants" element={<SuperRestaurants />} />
          <Route path="admins" element={<SuperAdmins />} />
          <Route path="settings" element={<SuperSettings />} />
        </Route>

        <Route path="*" element={<EmptyState className="py-32" title="Page not found" description="The page you are looking for doesn't exist." action={<a className="link" href="/">Go home</a>} />} />
      </Routes>
    </Suspense>
  );
}
