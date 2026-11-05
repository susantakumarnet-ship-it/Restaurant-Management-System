import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { BranchDetail, BranchSummary, FoodItem } from '../lib/types';

export interface CartLine {
  food_item_id: number;
  name: string;
  price: number; // effective unit price (display only; server re-prices)
  image?: string;
  diet_type: string;
  quantity: number;
  notes?: string;
}

interface ShopState {
  branches: BranchSummary[];
  branchId: number | null;
  branch: BranchDetail | null;
  loadingBranch: boolean;
  setBranchId: (id: number) => void;
  cart: CartLine[];
  add: (item: FoodItem, qty?: number) => void;
  setQty: (foodId: number, qty: number) => void;
  setNotes: (foodId: number, notes: string) => void;
  remove: (foodId: number) => void;
  clear: () => void;
  qtyOf: (foodId: number) => number;
  count: number;
  subtotal: number;
  coupon: string;
  setCoupon: (c: string) => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
}

const Ctx = createContext<ShopState>(null as any);
const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export const effectivePrice = (f: Pick<FoodItem, 'price' | 'discounted_price'>) => Number(f.discounted_price ?? f.price);

/** Customer-side state: selected restaurant branch + cart (persisted per branch). */
export function ShopProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchId, setBranch] = useState<number | null>(read('rms_branch', null));
  const [branch, setBranchDetail] = useState<BranchDetail | null>(null);
  const [loadingBranch, setLoadingBranch] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [coupon, setCoupon] = useState('');
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    api.get<BranchSummary[]>('/public/branches').then((list) => {
      setBranches(list);
      if (!list.find((b) => b.id === branchId) && list[0]) setBranch(list[0].id);
      if (!list.length) setLoadingBranch(false);
    }).catch(() => setLoadingBranch(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchId) return;
    write('rms_branch', branchId);
    setCart(read(`rms_cart_${branchId}`, []));
    setLoadingBranch(true);
    api.get<BranchDetail>(`/public/branches/${branchId}`).then(setBranchDetail).catch(() => setBranchDetail(null)).finally(() => setLoadingBranch(false));
  }, [branchId]);

  const persist = useCallback(
    (next: CartLine[]) => {
      setCart(next);
      if (branchId) write(`rms_cart_${branchId}`, next);
    },
    [branchId]
  );

  const value = useMemo<ShopState>(() => {
    const add = (item: FoodItem, qty = 1) => {
      const existing = cart.find((l) => l.food_item_id === item.id);
      if (existing) persist(cart.map((l) => (l.food_item_id === item.id ? { ...l, quantity: Math.min(50, l.quantity + qty) } : l)));
      else persist([...cart, { food_item_id: item.id, name: item.name, price: effectivePrice(item), image: item.images?.[0], diet_type: item.diet_type, quantity: qty }]);
    };
    const setQty = (id: number, q: number) => persist(q <= 0 ? cart.filter((l) => l.food_item_id !== id) : cart.map((l) => (l.food_item_id === id ? { ...l, quantity: Math.min(50, q) } : l)));
    return {
      branches,
      branchId,
      branch,
      loadingBranch,
      setBranchId: (id) => setBranch(id),
      cart,
      add,
      setQty,
      setNotes: (id, notes) => persist(cart.map((l) => (l.food_item_id === id ? { ...l, notes } : l))),
      remove: (id) => persist(cart.filter((l) => l.food_item_id !== id)),
      clear: () => {
        persist([]);
        setCoupon('');
      },
      qtyOf: (id) => cart.find((l) => l.food_item_id === id)?.quantity || 0,
      count: cart.reduce((s, l) => s + l.quantity, 0),
      subtotal: Math.round(cart.reduce((s, l) => s + l.price * l.quantity, 0) * 100) / 100,
      coupon,
      setCoupon,
      cartOpen,
      setCartOpen,
    };
  }, [branches, branchId, branch, loadingBranch, cart, coupon, cartOpen, persist]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShop = () => useContext(Ctx);
