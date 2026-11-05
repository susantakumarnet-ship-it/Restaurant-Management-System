import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button, Field, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function ForgotPassword() {
  const nav = useNavigate();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devOtp, setDevOtp] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/auth/forgot-password', { identifier: identifier.trim() });
      setDevOtp(r.devOtp);
      if (r.devOtp) setCode(r.devOtp);
      setStep('reset');
      toast.success(r.message);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return toast.error('Password needs 8+ characters with a letter and a number');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { identifier: identifier.trim(), code: code.trim(), password });
      toast.success('Password updated. Please sign in.');
      nav('/login');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={step === 'request' ? 'Forgot your password?' : 'Set a new password'}
      subtitle={
        <>
          Remembered it?{' '}
          <Link to="/login" className="link">
            Back to sign in
          </Link>
        </>
      }
    >
      {step === 'request' ? (
        <form onSubmit={request} className="space-y-4">
          <p className="text-sm text-ink-600">Enter your registered email or mobile number. We'll send you a one-time code.</p>
          <Field label="Email or mobile">
            <Input icon={<Mail className="h-4 w-4" />} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </Field>
          <Button type="submit" block size="lg" loading={busy}>
            Send reset code
          </Button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4">
          {devOtp && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Development mode: code pre-filled ({devOtp}).</p>}
          <Field label="6-digit code">
            <Input icon={<KeyRound className="h-4 w-4" />} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required className="font-mono tracking-widest" />
          </Field>
          <Field label="New password" hint="At least 8 characters with a letter and a number">
            <Input icon={<Lock className="h-4 w-4" />} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Button type="submit" block size="lg" loading={busy}>
            Update password
          </Button>
          <button type="button" className="w-full text-sm font-medium text-brand-700 hover:underline" onClick={() => request()}>
            Resend code
          </button>
        </form>
      )}
    </AuthShell>
  );
}
