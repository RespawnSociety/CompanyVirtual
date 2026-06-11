/**
 * useAsyncAction (CR-106) — pola `busy` + `error` + `run` bersama untuk aksi async di form.
 * Menggantikan salinan setBusy/try/catch/finally yang sebelumnya diduplikasi di CompanySetup,
 * DepartmentBuilder, dan CharacterEditor (termasuk menstandarkan handler delete).
 */

import { useCallback, useState } from "react";

export interface AsyncAction {
  busy: boolean;
  error: string | null;
  /** Jalankan `fn`: set busy, bersihkan error, tangkap error jadi pesan, reset busy. */
  run: (fn: () => Promise<void>) => Promise<void>;
  clearError: () => void;
}

export function useAsyncAction(): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback((): void => setError(null), []);

  return { busy, error, run, clearError };
}
