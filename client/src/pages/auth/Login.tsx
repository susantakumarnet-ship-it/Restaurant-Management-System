import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import { homeFor, useAuth } from '../../context/AuthContext';
import { Button, Field, Input } from '../../components/ui';
import { AuthShell, OtpForm } from './AuthShell';

declare global {
  interface Window {
    google?: any;
  }
}

const DEMO = [
  { label: 'Customer', id: 'customer@example.com', pw: 'Customer@123' },
  { label: 'Restaurant admin', id: 'admin@saffronsage.com', pw: 'Admin@123' },
  { label: 'Waiter', id: 'waiter@saffronsage.com', pw: 'Admin@123' },
  { label: 'Super admin', id: 'super@smartrms.com', pw: 'Admin@123' },
];

export default function Login() {
  const { login, setSession, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<{ identifier: string; devOtp?: string } | null>(null);
  const googleRef = useRef<HTMLDivElement>(null);

  const go = (u: any) => {
    const from = loc.state?.from;
    nav(from && !from.startsWith('/login') && (u.is_staff ? from.startsWith('/admin') || from.startsWith('/super') : !from.startsWith('/admin')) ? from : homeFor(u), { replace: true });
  };

  useEffect(() => {
    if (user) go(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional Google Sign-In (enabled when the server has GOOGLE_CLIENT_ID)
  useEffect(() => {
    api.get('/auth/config').then((cfg) => {
      if (!cfg.googleClientId) return;
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => {
        window.google?.accounts.id.initialize({
          client_id: cfg.googleClientId,
          callback: async (r: any) => {
            try {
              const res = await api.post('/auth/google', { credential: r.credential });
              setSession(res.token, res.user);
              go(res.user);
            } catch (e: any) {
              toast.error(e.message);
            }
          },
        });
        if (googleRef.current) window.google?.accounts.id.renderButton(googleRef.current, { theme: 'outline', size: 'large', width: 380, text: 'continue_with' });
      };
      document.body.appendChild(s);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(identifier.trim(), password);
      toast.success(`Welcome back, ${u.name.split(' ')[0]}!`);
      go(u);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNVERIFIED') {
        setVerify({ identifier: err.details?.email || identifier, devOtp: err.details?.devOtp });
        toast.info('Please verify your account to continue');
      } else toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async (code: string) => {
    setBusy(true);
    try {
      const res = await api.post('/auth/verify-otp', { identifier: verify!.identifier, code });
      setSession(res.token, res.user);
      toast.success('Account verified!');
      go(res.user);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (verify) {
    return (
      <AuthShell title="Verify your account" subtitle="One last step to secure your account.">
        <OtpForm
          identifier={verify.identifier}
          devOtp={verify.devOtp}
          busy={busy}
          onVerify={doVerify}
          onResend={async () => {
            try {
              const r = await api.post('/auth/resend-otp', { identifier: verify.identifier });
              setVerify({ ...verify, devOtp: r.devOtp });
              toast.success('A new code has been sent');
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New here?{' '}
          <Link to="/register" className="link">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email or mobile number">
          <Input icon={<Mail className="h-4 w-4" />} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" placeholder="you@example.com or 9876543210" required />
        </Field>
        <Field label="Password">
          <div className="relative">
            <Input icon={<Lock className="h-4 w-4" />} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="pr-10" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-2.5 text-ink-400 hover:text-ink-700" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" block size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
      <div ref={googleRef} className="mt-4 flex justify-center" />

      <div className="mt-8 rounded-xl border border-dashed border-ink-300 bg-white/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Demo accounts</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DEMO.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setIdentifier(d.id);
                setPassword(d.pw);
              }}
              className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-xs hover:border-brand-400 hover:bg-brand-50"
            >
              <span className="block font-semibold text-ink-800">{d.label}</span>
              <span className="block truncate text-ink-500">{d.id}</span>
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
