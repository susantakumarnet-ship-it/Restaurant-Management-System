import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Trash2 } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import { money } from '../lib/format';
import { Button, DietDot, Drawer, EmptyState, Img } from './ui';
import { QtyStepper } from './FoodCard';

export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, setQty, remove, subtotal, count, clear, branch } = useShop();
  const nav = useNavigate();
  return (
    <Drawer
      open={cartOpen}
      onClose={() => setCartOpen(false)}
      width="max-w-md"
      title={
        <span className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-brand-600" /> Your cart {count > 0 && <span className="text-sm font-normal text-ink-500">({count} items)</span>}
        </span>
      }
      footer={
        cart.length > 0 ? (
          <div className="w-full space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-600">Subtotal</span>
              <span className="text-lg font-bold text-ink-900">{money(subtotal)}</span>
            </div>
            <p className="text-xs text-ink-500">Taxes, coupons and charges are calculated at checkout.</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={clear}>
                Clear
              </Button>
              <Button
                block
                size="lg"
                onClick={() => {
                  setCartOpen(false);
                  nav('/checkout');
                }}
              >
                Checkout
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {cart.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Your cart is empty"
          description={`Add some delicious dishes from ${branch?.restaurant_name || 'our menu'}.`}
          action={
            <Link to="/menu" onClick={() => setCartOpen(false)}>
              <Button>Browse menu</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {cart.map((l) => (
            <li key={l.food_item_id} className="flex gap-3 py-3">
              <Img src={l.image} alt={l.name} className="h-16 w-16 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5">
                    <DietDot type={l.diet_type} />
                  </span>
                  <p className="text-sm font-medium leading-snug text-ink-900">{l.name}</p>
                </div>
                <p className="mt-0.5 text-xs text-ink-500">{money(l.price)} each</p>
                <div className="mt-2 flex items-center justify-between">
                  <QtyStepper qty={l.quantity} onChange={(q) => setQty(l.food_item_id, q)} size="sm" />
                  <span className="text-sm font-semibold">{money(l.price * l.quantity)}</span>
                </div>
              </div>
              <button onClick={() => remove(l.food_item_id)} className="self-start rounded-lg p-1 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${l.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
