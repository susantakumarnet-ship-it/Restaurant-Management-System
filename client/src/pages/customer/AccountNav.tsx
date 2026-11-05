import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CalendarCheck, ShoppingBag, User } from 'lucide-react';

/** Secondary navigation for the customer account area. */
export function AccountNav() {
  const items = [
    { to: '/my/bookings', label: 'Bookings', icon: CalendarCheck },
    { to: '/my/orders', label: 'Orders', icon: ShoppingBag },
    { to: '/my/notifications', label: 'Notifications', icon: Bell },
    { to: '/my/profile', label: 'Profile', icon: User },
  ];
  return (
    <nav className="scrollbar-thin -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition', isActive ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50')}>
          <i.icon className="h-4 w-4" /> {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
