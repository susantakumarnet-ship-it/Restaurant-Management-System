import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useShop } from '../../context/ShopContext';
import { Img } from '../../components/ui';
import { HOME_BG } from '../../lib/images';

/** Split-screen layout for auth pages with food imagery. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { branch } = useShop();
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink-900 lg:block">
        <Img src={HOME_BG} alt="" className="absolute inset-0 h-full w-full opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-xl">🍽️</span>
            <span className="font-display text-2xl font-bold">{branch?.restaurant_name || 'Smart RMS'}</span>
          </Link>
          <div>
            <p className="font-display text-4xl font-bold leading-tight">Great food.<br />Even better moments.</p>
            <p className="mt-3 max-w-md text-ink-300">Reserve your favourite table, order online and track everything in one place.</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center bg-[#fbf8f3] px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-900 text-lg">🍽️</span>
            <span className="font-display text-xl font-bold">{branch?.restaurant_name || 'Smart RMS'}</span>
          </Link>
          <h1 className="font-display text-3xl font-bold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-ink-600">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** 6-digit OTP input with resend. */
export function OtpForm({ identifier, onVerify, onResend, devOtp, busy }: { identifier: string; onVerify: (code: string) => void; onResend: () => void; devOtp?: string; busy?: boolean }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = new FormData(e.currentTarget).get('code') as string;
        onVerify(code.trim());
      }}
      className="space-y-4"
    >
      <p className="text-sm text-ink-600">
        We sent a 6-digit code to <span className="font-semibold text-ink-900">{identifier}</span>.
      </p>
      <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus defaultValue={devOtp || ''} className="input text-center font-mono text-2xl tracking-[0.6em]" placeholder="••••••" aria-label="Verification code" />
      {devOtp && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Development mode: code pre-filled ({devOtp}). In production it is delivered by email/SMS only.</p>}
      <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
        {busy ? 'Verifying...' : 'Verify & continue'}
      </button>
      <button type="button" onClick={onResend} className="w-full text-center text-sm font-medium text-brand-700 hover:underline">
        Didn't get it? Resend code
      </button>
    </form>
  );
}
