import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X, AlertTriangle } from 'lucide-react';
import { Button, Textarea } from './core';

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md', description }: { open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useLockScroll(open);
  useEscape(open, onClose);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={clsx('relative flex max-h-[92vh] w-full animate-fade-in flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', width)}>
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useLockScroll(open);
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/40" onClick={onClose} />
      <div className={clsx('relative flex h-full w-full animate-slide-in flex-col bg-white shadow-2xl', width)}>
        <div className="flex items-center justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0 flex-1 text-lg font-semibold text-ink-900">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---------- Promise-based confirm dialog ----------
type ConfirmOpts = { title: string; message?: ReactNode; confirmText?: string; danger?: boolean; requireReason?: boolean; reasonLabel?: string };
type ConfirmResult = { ok: boolean; reason?: string };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<ConfirmResult>>(async () => ({ ok: false }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { open: boolean }) | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<(r: ConfirmResult) => void>();
  const confirm = useCallback((o: ConfirmOpts) => {
    setReason('');
    setState({ ...o, open: true });
    return new Promise<ConfirmResult>((res) => (resolver.current = res));
  }, []);
  const close = (ok: boolean) => {
    resolver.current?.({ ok, reason: reason.trim() || undefined });
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state?.open}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} disabled={state?.requireReason && reason.trim().length < 3} onClick={() => close(true)}>
              {state?.confirmText || 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          {state?.danger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-ink-900">{state?.title}</h3>
            {state?.message && <div className="mt-1 text-sm text-ink-600">{state.message}</div>}
            {state?.requireReason !== undefined && (
              <div className="mt-3">
                <label className="label">{state?.reasonLabel || 'Reason'}</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
              </div>
            )}
          </div>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

/** const confirm = useConfirm(); if ((await confirm({title:'Delete?', danger:true})).ok) ... */
export const useConfirm = () => useContext(ConfirmCtx);
