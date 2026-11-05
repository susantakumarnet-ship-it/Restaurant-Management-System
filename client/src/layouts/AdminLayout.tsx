import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, CalendarDays, Armchair, UtensilsCrossed, ClipboardList, Users, UserCog, Boxes, CreditCard, TicketPercent,
  MessageSquareQuote, BarChart3, Settings, Bell, ShieldCheck, Menu, X, LogOut, Building2, Store, ChevronDown, Globe, Crown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AdminProvider, useAdmin } from '../context/AdminContext';
import { NotificationBell } from '../components/NotificationBell';
import { Img } from '../components/ui';

type NavItem = { to: string; label: string; icon: any; perms?: string[]; end?: boolean };
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Operations',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.view'], end: true },
      { to: '/admin/reservations', label: 'Reservations', icon: CalendarDays, perms: ['reservations.view', 'reservations.manage'] },
      { to: '/admin/tables', label: 'Tables & Floor', icon: Armchair, perms: ['tables.view', 'tables.manage'] },
      { to: '/admin/orders', label: 'Orders & Kitchen', icon: ClipboardList, perms: ['orders.view', 'orders.manage'] },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { to: '/admin/menu', label: 'Food Menu', icon: UtensilsCrossed, perms: ['menu.manage'] },
      { to: '/admin/coupons', label: 'Offers & Coupons', icon: TicketPercent, perms: ['coupons.manage'] },
      { to: '/admin/inventory', label: 'Inventory', icon: Boxes, perms: ['inventory.manage'] },
    ],
  },
  {
    group: 'People & Money',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Users, perms: ['customers.view', 'customers.manage'] },
      { to: '/admin/staff', label: 'Staff', icon: UserCog, perms: ['staff.manage'] },
      { to: '/admin/payments', label: 'Payments & Billing', icon: CreditCard, perms: ['payments.manage'] },
      { to: '/admin/reviews', label: 'Reviews', icon: MessageSquareQuote, perms: ['reviews.manage'] },
    ],
  },
  {
    group: 'Insights & Setup',
    items: [
      { to: '/admin/reports', label: 'Reports', icon: BarChart3, perms: ['reports.view'] },
      { to: '/admin/notifications', label: 'Notifications', icon: Bell },
      { to: '/admin/settings', label: 'Restaurant Settings', icon: Settings, perms: ['restaurant.manage'] },
      { to: '/admin/audit-logs', label: 'Audit Logs', icon: ShieldCheck, perms: ['audit.view'] },
    ],
  },
];

const SUPER_NAV: NavItem[] = [
  { to: '/super', label: 'Platform Overview', icon: Globe, end: true },
  { to: '/super/restaurants', label: 'Restaurants', icon: Store },
  { to: '/super/admins', label: 'Admin Accounts', icon: Crown },
  { to: '/super/settings', label: 'System Settings', icon: Settings },
];

function BranchSwitcher() {
  const { branches, branchId, setBranchId } = useAdmin();
  if (branches.length <= 1) return null;
  return (
    <div className="relative">
      <Building2 className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
      <select value={branchId} onChange={(e) => setBranchId(Number(e.target.value))} className="input h-9 max-w-[16rem] appearance-none py-1 pl-8 pr-8 text-sm" aria-label="Select branch">
        {Object.entries(
          branches.reduce<Record<string, typeof branches>>((acc, b) => {
            (acc[b.restaurant_name] ||= []).push(b);
            return acc;
          }, {})
        ).map(([rest, list]) => (
          <optgroup key={rest} label={rest}>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-ink-400" />
    </div>
  );
}

function Sidebar({ onNavigate, superMode }: { onNavigate: () => void; superMode: boolean }) {
  const { hasPerm, user } = useAuth();
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    clsx('group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-300 hover:bg-white/5 hover:text-white');
  return (
    <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {user?.role === 'super_admin' && (
        <div>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-brand-400/80">Super Admin</p>
          <div className="space-y-0.5">
            {SUPER_NAV.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={linkCls} onClick={onNavigate}>
                <i.icon className="h-4 w-4 shrink-0" />
                {i.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
      {!superMode &&
        NAV.map((g) => {
          const items = g.items.filter((i) => !i.perms || hasPerm(...i.perms));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-ink-500">{g.group}</p>
              <div className="space-y-0.5">
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={linkCls} onClick={onNavigate}>
                    <i.icon className="h-4 w-4 shrink-0" />
                    {i.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      {superMode && (
        <NavLink to="/admin" className={linkCls} onClick={onNavigate}>
          <LayoutDashboard className="h-4 w-4" /> Open Branch Dashboard
        </NavLink>
      )}
    </nav>
  );
}

function Shell({ superMode }: { superMode: boolean }) {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-lg">🍽️</div>
        <div>
          <p className="font-display text-lg font-bold leading-none text-white">Smart RMS</p>
          <p className="text-[11px] text-ink-400">{superMode ? 'Platform console' : 'Restaurant console'}</p>
        </div>
      </div>
      <Sidebar onNavigate={() => setOpen(false)} superMode={superMode} />
      <div className="border-t border-white/5 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-300">{user?.name?.[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user?.name}</p>
            <p className="truncate text-xs text-ink-400">{user?.role_name}</p>
          </div>
          <button
            onClick={() => {
              logout();
              nav('/login');
            }}
            className="rounded-lg p-2 text-ink-400 hover:bg-white/5 hover:text-white"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 animate-fade-in">{sidebar}</div>
          <button className="absolute right-4 top-4 rounded-full bg-white p-2" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200/70 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          {superMode ? <span className="font-semibold text-ink-800">Platform Administration</span> : <AdminHeaderInfo />}
          <div className="ml-auto flex items-center gap-2">
            {!superMode && <BranchSwitcher />}
            {!superMode && <NotificationBell scope="admin" />}
            <a href="/" target="_blank" rel="noreferrer" className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100 sm:inline-flex">
              View site
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AdminHeaderInfo() {
  const { branch } = useAdmin();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Img src={branch.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-900">{branch.restaurant_name}</p>
        <p className="truncate text-xs text-ink-500">{branch.name}</p>
      </div>
    </div>
  );
}

/** Branch-scoped admin console. Remounts pages when the branch changes. */
export function AdminLayout() {
  return (
    <AdminProvider>
      <KeyedShell />
    </AdminProvider>
  );
}
function KeyedShell() {
  const { branchId } = useAdmin();
  return <Shell key={branchId} superMode={false} />;
}

/** Super admin console (no branch scope needed). */
export function SuperLayout() {
  return <Shell superMode />;
}
