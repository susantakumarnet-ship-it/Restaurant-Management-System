import { CrudPage, type FieldDef } from '../../components/CrudPage';
import { Badge, Img } from '../../components/ui';
import { fmtDate, money, toDateInput } from '../../lib/format';

interface CouponRow {
  id: number;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percent' | 'flat';
  discount_value: number;
  min_order_amount: number;
  max_discount: number | null;
  valid_from: string | null;
  valid_to: string | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  used_count: number;
  is_public: boolean;
  is_active: boolean;
  image_url: string | null;
  total_discount_given: number;
}

const fields: FieldDef[] = [
  { name: 'code', label: 'Coupon code', required: true, placeholder: 'e.g. WEEKEND15', hint: 'Letters, numbers, - or _ (saved in uppercase)' },
  { name: 'title', label: 'Title', required: true, placeholder: 'Weekend feast - 15% off' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'discount_type', label: 'Discount type', type: 'select', required: true, options: [{ value: 'percent', label: 'Percentage (%)' }, { value: 'flat', label: 'Flat amount (₹)' }], default: 'percent' },
  { name: 'discount_value', label: 'Discount value', type: 'number', required: true, step: '0.01', min: 0 },
  { name: 'min_order_amount', label: 'Minimum order (₹)', type: 'number', step: '0.01', min: 0 },
  { name: 'max_discount', label: 'Max discount (₹)', type: 'number', step: '0.01', min: 0, hint: 'Cap for percentage coupons', hidden: (v) => v.discount_type === 'flat' },
  { name: 'valid_from', label: 'Valid from', type: 'date' },
  { name: 'valid_to', label: 'Valid to', type: 'date' },
  { name: 'usage_limit', label: 'Total usage limit', type: 'number', min: 1, hint: 'Leave empty for unlimited' },
  { name: 'per_user_limit', label: 'Per customer limit', type: 'number', min: 1 },
  { name: 'is_public', label: 'Visibility', type: 'switch', placeholder: 'Show on customer offers page' },
  { name: 'is_active', label: 'Status', type: 'switch', placeholder: 'Active' },
  { name: 'image_url', label: 'Banner image', type: 'image' },
];

function couponStatus(c: CouponRow): { label: string; tone: 'green' | 'gray' | 'red' | 'amber' } {
  const today = toDateInput();
  if (!c.is_active) return { label: 'Inactive', tone: 'gray' };
  if (c.valid_to && c.valid_to < today) return { label: 'Expired', tone: 'red' };
  if (c.valid_from && c.valid_from > today) return { label: 'Scheduled', tone: 'amber' };
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return { label: 'Exhausted', tone: 'red' };
  return { label: 'Active', tone: 'green' };
}

export default function Coupons() {
  return (
    <CrudPage<CouponRow>
      title="Offers & Coupons"
      subtitle="Create discount codes customers can apply at checkout."
      endpoint="/coupons"
      entityName="Coupon"
      fields={fields}
      transform={(p) => ({ ...p, code: String(p.code || '').toUpperCase(), min_order_amount: p.min_order_amount ?? 0, max_discount: p.discount_type === 'flat' ? null : p.max_discount })}
      columns={[
        {
          key: 'code',
          header: 'Code',
          render: (c) => (
            <div className="flex items-center gap-3">
              <Img src={c.image_url} alt="" className="hidden h-9 w-12 rounded-md sm:block" />
              <span className="rounded-md border border-dashed border-brand-400 bg-brand-50 px-2 py-0.5 font-mono text-xs font-bold text-brand-800">{c.code}</span>
            </div>
          ),
        },
        { key: 'title', header: 'Title', render: (c) => <span className="font-medium text-ink-900">{c.title}</span> },
        {
          key: 'discount_value',
          header: 'Discount',
          render: (c) => (
            <span className="font-semibold">
              {c.discount_type === 'percent' ? `${Number(c.discount_value)}%` : money(c.discount_value)}
              {c.discount_type === 'percent' && c.max_discount ? <span className="block text-xs font-normal text-ink-500">up to {money(c.max_discount)}</span> : null}
            </span>
          ),
        },
        { key: 'min_order_amount', header: 'Min order', hideOnMobile: true, render: (c) => (Number(c.min_order_amount) ? money(c.min_order_amount) : '-') },
        {
          key: 'valid_to',
          header: 'Validity',
          hideOnMobile: true,
          render: (c) => <span className="text-xs">{c.valid_from || c.valid_to ? `${c.valid_from ? fmtDate(c.valid_from) : 'Now'} → ${c.valid_to ? fmtDate(c.valid_to) : 'No end'}` : 'Always'}</span>,
        },
        { key: 'used_count', header: 'Used', render: (c) => `${c.used_count}${c.usage_limit != null ? ` / ${c.usage_limit}` : ''}` },
        { key: 'total_discount_given', header: 'Discount given', hideOnMobile: true, render: (c) => money(c.total_discount_given) },
        {
          key: 'status',
          header: 'Status',
          value: (c) => couponStatus(c).label,
          render: (c) => {
            const s = couponStatus(c);
            return (
              <div className="flex flex-col items-start gap-1">
                <Badge tone={s.tone}>{s.label}</Badge>
                {!c.is_public && <span className="text-[11px] text-ink-500">Private</span>}
              </div>
            );
          },
        },
      ]}
    />
  );
}
