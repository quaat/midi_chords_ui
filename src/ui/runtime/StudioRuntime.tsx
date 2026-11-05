"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SessionStoreProvider } from "@/state/useSessionStore";
import { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";
import { StudioRuntimeContext } from "@/ui/runtime/runtimeContext";

export interface StudioRuntimeProviderProps {
  children?: ReactNode;
  /** Inject a runtime (tests/stories); by default one is created per provider. */
  runtime?: StudioRuntimeCore;
}

/**
 * Creates the studio runtime once (React state initialiser: no side effects) and starts it on the
 * client in an effect (storage, preferences, input, default material). Also provides the
 * runtime's session store to the session hooks.
 */
export function StudioRuntimeProvider({ children, runtime }: StudioRuntimeProviderProps): JSX.Element {
  const [core] = useState<StudioRuntimeCore>(() => runtime ?? new StudioRuntimeCore());

  useEffect(() => core.start(), [core]);

  return (
    <StudioRuntimeContext.Provider value={core}>
      <SessionStoreProvider store={core.session}>{children}</SessionStoreProvider>
    </StudioRuntimeContext.Provider>
  );
}
