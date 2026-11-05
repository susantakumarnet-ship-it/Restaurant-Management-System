import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { adminBranchStore, api } from '../lib/api';
import type { BranchSummary } from '../lib/types';
import { Spinner, ErrorState, EmptyState } from '../components/ui';

interface AdminState {
  branches: BranchSummary[];
  branchId: number;
  branch: BranchSummary;
  setBranchId: (id: number) => void;
  integrations: { payments: string; email: string; sms: string; whatsapp: string };
  reloadContext: () => Promise<void>;
}

const Ctx = createContext<AdminState>(null as any);

/** Loads accessible branches; every admin API call sends the selected branch (X-Branch-Id). */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [integrations, setIntegrations] = useState<AdminState['integrations']>({ payments: 'mock', email: 'log', sms: 'log', whatsapp: 'disabled' });
  const [branchId, setBranch] = useState<number | null>(adminBranchStore.get());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const ctx = await api.get('/admin/context');
      setBranches(ctx.branches);
      setIntegrations(ctx.integrations);
      const stored = adminBranchStore.get();
      const valid = ctx.branches.find((b: BranchSummary) => b.id === stored) || ctx.branches[0];
      if (valid) {
        adminBranchStore.set(valid.id);
        setBranch(valid.id);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setBranchId = (id: number) => {
    adminBranchStore.set(id);
    setBranch(id);
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!branches) return <Spinner className="h-screen" label="Loading workspace..." />;
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) return <EmptyState className="h-screen" title="No branch available" description="Your account is not linked to any restaurant branch yet. Please contact your administrator." />;

  return <Ctx.Provider value={{ branches, branchId: branch.id, branch, setBranchId, integrations, reloadContext: load }}>{children}</Ctx.Provider>;
}

export const useAdmin = () => useContext(Ctx);
