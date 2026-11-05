import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Mail, Phone, User } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Field, Input } from '../../components/ui';
import { AuthShell, OtpForm } from './AuthShell';

export default function Register() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<{ email: string; devOtp?: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Please enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email';
    if (!/^\+?[0-9]{10,15}$/.test(form.phone.trim())) e.phone = 'Enter a valid mobile number (10-15 digits)';
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) e.password = 'At least 8 characters with a letter and a number';
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await api.post('/auth/register', { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password });
      setOtp({ email: res.email, devOtp: res.devOtp });
      toast.success('Account created - check your email/SMS for the code');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (otp) {
    return (
      <AuthShell title="Verify your account" subtitle="Enter the code we just sent you.">
        <OtpForm
          identifier={otp.email}
          devOtp={otp.devOtp}
          busy={busy}
          onVerify={async (code) => {
            setBusy(true);
            try {
              const res = await api.post('/auth/verify-otp', { identifier: otp.email, code });
              setSession(res.token, res.user);
              toast.success(`Welcome, ${res.user.name.split(' ')[0]}!`);
              nav('/', { replace: true });
            } catch (e: any) {
              toast.error(e.message);
            } finally {
              setBusy(false);
            }
          }}
          onResend={async () => {
            try {
              const r = await api.post('/auth/resend-otp', { identifier: otp.email });
              setOtp({ ...otp, devOtp: r.devOtp });
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
      title="Create your account"
      subtitle={
        <>
          Already have an account?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" error={errors.name}>
          <Input icon={<User className="h-4 w-4" />} value={form.name} onChange={set('name')} autoComplete="name" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={errors.email}>
            <Input icon={<Mail className="h-4 w-4" />} type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <Field label="Mobile number" error={errors.phone}>
            <Input icon={<Phone className="h-4 w-4" />} type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="9876543210" />
          </Field>
        </div>
        <Field label="Password" error={errors.password} hint="At least 8 characters with a letter and a number">
          <Input icon={<Lock className="h-4 w-4" />} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <Input icon={<Lock className="h-4 w-4" />} type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </Field>
        <Button type="submit" block size="lg" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-xs text-ink-500">By signing up you agree to receive booking and order updates by email/SMS.</p>
      </form>
    </AuthShell>
  );
}
