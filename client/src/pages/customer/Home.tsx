import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck, Clock, MapPin, Phone, ShoppingBag, Star, TicketPercent, Copy, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { fmtTime, money, timeAgo } from '../../lib/format';
import type { Coupon, FoodItem, Review, Category } from '../../lib/types';
import { useApi } from '../../hooks/useApi';
import { useShop } from '../../context/ShopContext';
import { Button, EmptyState, Img, Skeleton, Spinner, Stars } from '../../components/ui';
import { FoodCard } from '../../components/FoodCard';
import { FoodDetailModal } from '../../components/FoodDetailModal';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Home() {
  const { branch, branchId, loadingBranch } = useShop();
  const menu = useApi<{ categories: Category[]; items: FoodItem[] }>(branchId ? () => api.get(`/public/branches/${branchId}/menu`) : null, [branchId]);
  const offers = useApi<Coupon[]>(branchId ? () => api.get(`/public/branches/${branchId}/offers`) : null, [branchId]);
  const reviews = useApi<Review[]>(branchId ? () => api.get(`/public/branches/${branchId}/reviews`) : null, [branchId]);
  const [open, setOpen] = useState<FoodItem | null>(null);
  const [heroImg, setHeroImg] = useState(0);

  const popular = useMemo(() => [...(menu.data?.items || [])].filter((i) => i.is_available).sort((a, b) => Number(b.times_ordered || 0) - Number(a.times_ordered || 0)).slice(0, 4), [menu.data]);
  const recommended = useMemo(() => (menu.data?.items || []).filter((i) => i.is_recommended && i.is_available).slice(0, 4), [menu.data]);

  if (loadingBranch && !branch) return <Spinner className="h-[60vh]" />;
  if (!branch) return <EmptyState className="py-32" title="No restaurants available" description="Please check back soon." />;

  const gallery = branch.images?.length ? branch.images : [branch.cover_url].filter(Boolean) as string[];
  const isOpenNow = (() => {
    const now = new Date();
    const hm = now.toTimeString().slice(0, 5);
    return !branch.weekly_holidays?.includes(now.getDay()) && hm >= branch.opening_time.slice(0, 5) && hm < branch.closing_time.slice(0, 5);
  })();

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-ink-950">
        <Img src={gallery[heroImg] || branch.cover_url} alt={branch.restaurant_name} className="absolute inset-0 h-full w-full opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/70 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <div className="max-w-2xl animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${isOpenNow ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isOpenNow ? 'bg-emerald-400' : 'bg-red-400'}`} /> {isOpenNow ? 'Open now' : 'Closed now'}
              </span>
              {branch.avg_rating && (
                <span className="chip bg-white/10 text-white">
                  <Star className="h-3 w-3 fill-brand-400 text-brand-400" /> {branch.avg_rating} ({branch.review_count} reviews)
                </span>
              )}
              {branch.cuisine && <span className="chip bg-white/10 text-ink-200">{branch.cuisine}</span>}
            </div>
            <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-white sm:text-6xl">{branch.restaurant_name}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-brand-300">
              <MapPin className="h-4 w-4" /> {branch.name}
            </p>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-300">{branch.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/book">
                <Button size="lg" icon={<CalendarCheck className="h-5 w-5" />}>
                  Book a Table
                </Button>
              </Link>
              <Link to="/menu">
                <Button size="lg" variant="secondary" icon={<ShoppingBag className="h-5 w-5" />}>
                  Order Food
                </Button>
              </Link>
            </div>
          </div>
          {gallery.length > 1 && (
            <div className="mt-12 flex gap-2">
              {gallery.slice(0, 5).map((g, i) => (
                <button key={g} onClick={() => setHeroImg(i)} className={`h-14 w-20 overflow-hidden rounded-lg ring-2 transition sm:h-16 sm:w-24 ${i === heroImg ? 'ring-brand-400' : 'ring-white/10 opacity-70 hover:opacity-100'}`} aria-label={`Show photo ${i + 1}`}>
                  <Img src={g} alt="" className="h-full w-full" />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Info strip */}
      <section className="border-b border-ink-200/70 bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:grid-cols-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-brand-600" />
            <div className="text-sm">
              <p className="font-semibold">
                {fmtTime(branch.opening_time)} - {fmtTime(branch.closing_time)}
              </p>
              <p className="text-ink-500">{branch.weekly_holidays?.length ? `Closed on ${branch.weekly_holidays.map((d) => DAY[d]).join(', ')}` : 'Open all week'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-brand-600" />
            <div className="min-w-0 text-sm">
              <p className="truncate font-semibold">{branch.address}</p>
              <p className="text-ink-500">
                {branch.city}
                {branch.postal_code ? ` - ${branch.postal_code}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Phone className="h-5 w-5 text-brand-600" />
            <div className="text-sm">
              <a href={`tel:${branch.phone}`} className="font-semibold hover:text-brand-700">
                {branch.phone || branch.restaurant_phone}
              </a>
              <p className="text-ink-500">{branch.email || branch.restaurant_email}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionTitle eyebrow="Explore" title="Our menu categories" link={{ to: '/menu', label: 'Full menu' }} />
        {menu.loading ? (
          <div className="flex gap-4 overflow-hidden">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 w-36 shrink-0 rounded-2xl" />)}</div>
        ) : (
          <div className="scrollbar-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {menu.data?.categories.map((c) => (
              <Link key={c.id} to={`/menu?category=${c.id}`} className="group relative h-36 w-36 shrink-0 overflow-hidden rounded-2xl sm:h-40 sm:w-40">
                <Img src={c.image_url} alt={c.name} className="h-full w-full transition duration-500 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 to-transparent" />
                <span className="absolute bottom-3 left-3 right-3 font-semibold text-white">{c.name}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Offers */}
      {!!offers.data?.length && (
        <section className="bg-ink-900 py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Save more" title="Special offers" dark />
            <div className="grid gap-4 md:grid-cols-3">
              {offers.data.map((o) => (
                <div key={o.id} className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-brand-600 to-orange-700 p-5 text-white">
                  <TicketPercent className="absolute -right-4 -top-4 h-28 w-28 text-white/10" />
                  <p className="text-3xl font-bold">{o.discount_type === 'percent' ? `${Number(o.discount_value)}% OFF` : `${money(o.discount_value)} OFF`}</p>
                  <p className="mt-1 font-semibold">{o.title}</p>
                  <p className="mt-1 text-sm text-white/80">{o.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(o.code).catch(() => {});
                        toast.success(`Code ${o.code} copied`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-white/60 bg-white/10 px-3 py-1.5 font-mono text-sm font-bold"
                    >
                      {o.code} <Copy className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs text-white/70">{Number(o.min_order_amount) > 0 ? `Min ${money(o.min_order_amount)}` : 'No minimum'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Popular */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionTitle eyebrow="Most loved" title="Popular dishes" link={{ to: '/menu', label: 'See all' }} />
        {menu.loading ? <Grid>{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-80" />)}</Grid> : <Grid>{popular.map((i) => <FoodCard key={i.id} item={i} onOpen={setOpen} />)}</Grid>}
      </section>

      {/* Recommended */}
      {recommended.length > 0 && (
        <section className="bg-white py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Chef recommends" title="Recommended for you" />
            <Grid>
              {recommended.map((i) => (
                <FoodCard key={i.id} item={i} onOpen={setOpen} />
              ))}
            </Grid>
          </div>
        </section>
      )}

      {/* Book CTA */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-ink-900">
          <Img src={gallery[1] || gallery[0]} alt="" className="absolute inset-0 h-full w-full opacity-30" />
          <div className="relative grid gap-6 p-8 md:grid-cols-2 md:p-12">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Reservations</p>
              <h2 className="mt-2 font-display text-3xl font-bold text-white md:text-4xl">Celebrate with us</h2>
              <p className="mt-3 text-ink-300">Birthdays, anniversaries or a quiet dinner for two - choose indoor, garden, rooftop or private dining. Instant availability, confirmation by email and SMS.</p>
            </div>
            <div className="flex items-center md:justify-end">
              <Link to="/book">
                <Button size="lg" icon={<CalendarCheck className="h-5 w-5" />}>
                  Reserve your table
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews + map */}
      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionTitle eyebrow="Guest stories" title="What our guests say" link={{ to: '/reviews', label: 'All reviews' }} />
          <div className="grid gap-4 sm:grid-cols-2">
            {(reviews.data || []).slice(0, 4).map((r) => (
              <div key={r.id} className="card p-5">
                <Stars value={r.rating} />
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-ink-700">“{r.comment || 'Loved it!'}”</p>
                <div className="mt-4 flex items-center justify-between text-xs text-ink-500">
                  <span className="font-semibold text-ink-800">{r.customer_name}</span>
                  <span>{r.food_name ? `on ${r.food_name} • ` : ''}{timeAgo(r.created_at)}</span>
                </div>
              </div>
            ))}
            {!reviews.loading && !reviews.data?.length && <p className="text-sm text-ink-500">No reviews yet - be the first!</p>}
          </div>
        </div>
        <div className="lg:col-span-2">
          <SectionTitle eyebrow="Find us" title="Location" />
          <div className="card overflow-hidden">
            {(branch.latitude && branch.longitude) || branch.address ? (
              <iframe
                title="Map"
                className="h-72 w-full"
                loading="lazy"
                src={`https://maps.google.com/maps?q=${branch.latitude && branch.longitude ? `${branch.latitude},${branch.longitude}` : encodeURIComponent([branch.address, branch.city, branch.state, branch.postal_code].filter(Boolean).join(', '))}&z=15&output=embed`}
              />
            ) : (
              <div className="flex h-72 items-center justify-center bg-ink-100 text-sm text-ink-500">Map unavailable</div>
            )}
            <div className="flex items-center justify-between gap-3 p-4">
              <p className="text-sm text-ink-700">{[branch.address, branch.city, [branch.state, branch.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
              {branch.map_url && (
                <a href={branch.map_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="secondary" icon={<Navigation className="h-4 w-4" />}>
                    Directions
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
      <FoodDetailModal item={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function SectionTitle({ eyebrow, title, link, dark }: { eyebrow: string; title: string; link?: { to: string; label: string }; dark?: boolean }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{eyebrow}</p>
        <h2 className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${dark ? 'text-white' : 'text-ink-900'}`}>{title}</h2>
      </div>
      {link && (
        <Link to={link.to} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:gap-2">
          {link.label} <ArrowRight className="h-4 w-4 transition-all" />
        </Link>
      )}
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
