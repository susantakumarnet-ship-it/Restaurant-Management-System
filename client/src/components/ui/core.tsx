import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Loader2, Star, ImageOff, Inbox } from 'lucide-react';
import { assetUrl } from '../../lib/api';
import { STATUS_TONE, TONE_CLASS, titleCase } from '../../lib/format';

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'success';
type Size = 'xs' | 'sm' | 'md' | 'lg';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500 shadow-sm',
  secondary: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 focus-visible:ring-ink-300 shadow-sm',
  ghost: 'text-ink-700 hover:bg-ink-100 focus-visible:ring-ink-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
  dark: 'bg-ink-900 text-white hover:bg-ink-800 focus-visible:ring-ink-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 shadow-sm',
};
const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ---------- Form controls ----------
export function Field({ label, error, hint, required, children, className }: { label?: ReactNode; error?: string | null; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input({ className, icon, ...rest }, ref) {
  if (!icon) return <input ref={ref} className={clsx('input', className)} {...rest} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">{icon}</span>
      <input ref={ref} className={clsx('input pl-9', className)} {...rest} />
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { options?: { value: string | number; label: string }[]; placeholder?: string }>(
  function Select({ className, options, placeholder, children, ...rest }, ref) {
    return (
      <select ref={ref} className={clsx('input pr-8', className)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={clsx('input', className)} {...rest} />;
});

export function Switch({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; description?: ReactNode }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-ink-300')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <span className="text-sm">
          <span className="font-medium text-ink-800">{label}</span>
          {description && <span className="block text-xs text-ink-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-700">
      <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ---------- Display ----------
export function Badge({ tone = 'gray', children, className }: { tone?: keyof typeof TONE_CLASS; children: ReactNode; className?: string }) {
  return <span className={clsx('chip ring-1 ring-inset', TONE_CLASS[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, label, className }: { status?: string | null; label?: string; className?: string }) {
  if (!status) return null;
  return (
    <Badge tone={STATUS_TONE[status] || 'gray'} className={className}>
      {label || titleCase(status)}
    </Badge>
  );
}

export function Card({ children, className, title, actions, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <div className={clsx('card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <h3 className="font-semibold text-ink-900">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </div>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={clsx('flex items-center justify-center gap-2 py-10 text-ink-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-ink-200/70', className)} />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon || <Inbox className="h-6 w-6" />}</div>
      <h3 className="font-semibold text-ink-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm text-red-600">{error}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Image with graceful fallback for broken/missing URLs. */
export function Img({ src, alt, className, fallbackClassName }: { src?: string | null; alt: string; className?: string; fallbackClassName?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={clsx('flex items-center justify-center bg-gradient-to-br from-brand-100 via-amber-50 to-orange-100 text-brand-700/60', className, fallbackClassName)} aria-label={alt}>
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }
  return <img src={assetUrl(src)} alt={alt} loading="lazy" onError={() => setFailed(true)} className={clsx('object-cover', className)} />;
}

export function Stars({ value, size = 14, onChange, className }: { value: number; size?: number; onChange?: (v: number) => void; className?: string }) {
  return (
    <div className={clsx('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" disabled={!onChange} onClick={() => onChange?.(i)} className={clsx(!onChange && 'cursor-default')} aria-label={`${i} star`}>
          <Star style={{ width: size, height: size }} className={i <= Math.round(value) ? 'fill-brand-500 text-brand-500' : 'text-ink-300'} />
        </button>
      ))}
    </div>
  );
}

export function DietDot({ type }: { type: string }) {
  const cls = type === 'non_veg' ? 'nonveg-dot' : type === 'vegan' ? 'vegan-dot' : 'veg-dot';
  return <span className={cls} title={type === 'non_veg' ? 'Non-veg' : type === 'vegan' ? 'Vegan' : 'Veg'} />;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('scrollbar-thin flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={clsx(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === t.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={clsx('rounded-full px-1.5 text-xs', value === t.value ? 'bg-brand-100 text-brand-800' : 'bg-ink-200 text-ink-600')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon, hint, tone = 'brand', onClick }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode; tone?: 'brand' | 'green' | 'blue' | 'red' | 'purple' | 'gray'; onClick?: () => void }) {
  const toneCls = { brand: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', blue: 'bg-sky-50 text-sky-700', red: 'bg-red-50 text-red-700', purple: 'bg-violet-50 text-violet-700', gray: 'bg-ink-100 text-ink-700' }[tone];
  return (
    <div onClick={onClick} className={clsx('card flex items-start gap-4 p-4 transition', onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lift')}>
      {icon && <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', toneCls)}>{icon}</div>}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      </div>
    </div>
  );
}
