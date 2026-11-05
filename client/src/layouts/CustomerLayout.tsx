import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarCheck, ChevronDown, Home, LogOut, MapPin, Menu as MenuIcon, Phone, ShoppingBag, User, UtensilsCrossed, X, Clock, Globe, AtSign, Mail, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { NotificationBell } from '../components/NotificationBell';
import { CartDrawer } from '../components/CartDrawer';
import { fmtTime } from '../lib/format';

function BranchPicker({ dark }: { dark?: boolean }) {
  const { branches, branchId, setBranchId } = useShop();
  if (branches.length <= 1) return null;
  return (
    <div className="relative">
      <MapPin className={clsx('pointer-events-none absolute left-2 top-2 h-4 w-4', dark ? 'text-brand-400' : 'text-brand-600')} />
      <select
        value={branchId ?? ''}
        onChange={(e) => setBranchId(Number(e.target.value))}
        className={clsx('h-8 max-w-[13rem] appearance-none rounded-full border py-1 pl-7 pr-7 text-xs font-medium focus:outline-none', dark ? 'border-white/15 bg-white/5 text-white' : 'border-ink-200 bg-white text-ink-800')}
        aria-label="Choose restaurant"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id} className="text-ink-900">
            {b.restaurant_name} - {b.name}
          </option>
        ))}
      </select>
      <ChevronDown className={clsx('pointer-events-none absolute right-2 top-2 h-4 w-4', dark ? 'text-ink-300' : 'text-ink-400')} />
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!user) return null;
  const items = user.is_staff
    ? [{ to: user.role === 'super_admin' ? '/super' : '/admin', label: 'Admin dashboard', icon: LayoutDashboard }]
    : [
        { to: '/my/bookings', label: 'My bookings', icon: CalendarCheck },
        { to: '/my/orders', label: 'My orders', icon: ShoppingBag },
        { to: '/my/profile', label: 'Profile', icon: User },
      ];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-2.5 text-sm font-medium text-ink-800 hover:bg-ink-50">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{user.name[0]}</span>
        <span className="hidden max-w-[7rem] truncate sm:inline">{user.name.split(' ')[0]}</span>
        <ChevronDown className="h-4 w-4 text-ink-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-52 animate-fade-in overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lift">
          {items.map((i) => (
            <Link key={i.to} to={i.to} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
              <i.icon className="h-4 w-4 text-ink-400" /> {i.label}
            </Link>
          ))}
          <button
            onClick={() => {
              logout();
              setOpen(false);
              nav('/');
            }}
            className="flex w-full items-center gap-2.5 border-t border-ink-100 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function CustomerLayout() {
  const { user } = useAuth();
  const { branch, count, setCartOpen } = useShop();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const links = [
    { to: '/', label: 'Home', end: true },
    { to: '/menu', label: 'Menu' },
    { to: '/book', label: 'Book a Table' },
    { to: '/reviews', label: 'Reviews' },
  ];
  const navCls = ({ isActive }: { isActive: boolean }) => clsx('rounded-full px-3.5 py-1.5 text-sm font-medium transition', isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100');

  return (
    <div className="flex min-h-screen flex-col bg-[#fbf8f3]">
      <header className="sticky top-0 z-30 border-b border-ink-200/60 bg-[#fbf8f3]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <button className="rounded-lg p-2 text-ink-700 hover:bg-ink-100 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-lg">🍽️</span>
            <span className="truncate font-display text-xl font-bold text-ink-900">{branch?.restaurant_name || 'Smart RMS'}</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navCls}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden lg:block">
              <BranchPicker />
            </div>
            {user && !user.is_staff && <NotificationBell scope="customer" />}
            <button onClick={() => setCartOpen(true)} className="relative rounded-full p-2 text-ink-700 hover:bg-ink-100" aria-label="Open cart">
              <ShoppingBag className="h-5 w-5" />
              {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{count}</span>}
            </button>
            {user ? (
              <UserMenu />
            ) : (
              <Link to="/login" state={{ from: loc.pathname }} className="whitespace-nowrap rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 animate-fade-in flex-col bg-white p-5">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-xl font-bold">{branch?.restaurant_name || 'Menu'}</span>
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4">
              <BranchPicker />
            </div>
            <nav className="flex flex-col gap-1">
              {[...links, ...(user && !user.is_staff ? [{ to: '/my/bookings', label: 'My Bookings' }, { to: '/my/orders', label: 'My Orders' }, { to: '/my/profile', label: 'Profile' }] : [])].map((l) => (
                <NavLink key={l.to} to={l.to} end={(l as any).end} className={({ isActive }) => clsx('rounded-lg px-3 py-2.5 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-700')}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}

      <main className="flex-1">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-ink-200 bg-white/95 backdrop-blur md:hidden">
        {[
          { to: '/', icon: Home, label: 'Home', end: true },
          { to: '/menu', icon: UtensilsCrossed, label: 'Menu' },
          { to: '/book', icon: CalendarCheck, label: 'Book' },
          { to: user ? '/my/bookings' : '/login', icon: User, label: user ? 'Account' : 'Sign in' },
        ].map((i) => (
          <NavLink key={i.label} to={i.to} end={i.end} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-ink-500')}>
            <i.icon className="h-5 w-5" />
            {i.label}
          </NavLink>
        ))}
      </nav>

      <footer className="bg-ink-950 text-ink-300">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="font-display text-2xl font-bold text-white">{branch?.restaurant_name || 'Smart RMS'}</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-400">{branch?.description}</p>
            <div className="mt-4 flex gap-3">
              {[Globe, AtSign, Mail].map((I, i) => (
                <span key={i} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-300">
                  <I className="h-4 w-4" />
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white">Visit us</p>
            {branch?.address && (
              <p className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" /> {[branch.address, branch.city, [branch.state, branch.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </p>
            )}
            {branch?.phone && (
              <p className="flex gap-2">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" /> {branch.phone}
              </p>
            )}
            {branch && (
              <p className="flex gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" /> {fmtTime(branch.opening_time)} - {fmtTime(branch.closing_time)}
              </p>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white">Explore</p>
            <Link to="/menu" className="block hover:text-white">Menu & online ordering</Link>
            <Link to="/book" className="block hover:text-white">Reserve a table</Link>
            <Link to="/reviews" className="block hover:text-white">Guest reviews</Link>
            <Link to="/login" className="block hover:text-white">Staff login</Link>
          </div>
        </div>
        <div className="border-t border-white/5 py-4 text-center text-xs text-ink-500">© {new Date().getFullYear()} {branch?.restaurant_name || 'Smart RMS'}. All rights reserved.</div>
      </footer>
      <CartDrawer />
    </div>
  );
}
