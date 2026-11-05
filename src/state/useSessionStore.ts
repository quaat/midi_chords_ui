"use client";

import { createContext, createElement, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { SessionAction, SessionState, SessionStore, Store } from "@/state/sessionStore";

/**
 * Subscribe to a slice of a store. The selector must return a stable value for an unchanged
 * state (a primitive or an object already in the state), not a freshly built object.
 */
export function useStore<S, T>(store: Store<S>, selector: (state: S) => T): T {
  const getSnapshot = (): T => selector(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

const SessionStoreContext = createContext<SessionStore | null>(null);

export interface SessionStoreProviderProps {
  store: SessionStore;
  children?: ReactNode;
}

export function SessionStoreProvider({ store, children }: SessionStoreProviderProps): JSX.Element {
  return createElement(SessionStoreContext.Provider, { value: store }, children);
}

export function useSessionStoreInstance(): SessionStore {
  const store = useContext(SessionStoreContext);
  if (!store) {
    throw new Error("useSessionStore must be used inside <SessionStoreProvider>.");
  }
  return store;
}

export function useSessionStore<T>(selector: (state: SessionState) => T): T {
  return useStore(useSessionStoreInstance(), selector);
}

export function useSessionDispatch(): (action: SessionAction) => void {
  return useSessionStoreInstance().dispatch;
}
