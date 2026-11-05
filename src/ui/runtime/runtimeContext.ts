"use client";

import { createContext } from "react";
import type { KeyLayout } from "@/ui/piano/geometry";
import type { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";

/** The single runtime instance (set by <StudioRuntimeProvider>). */
export const StudioRuntimeContext = createContext<StudioRuntimeCore | null>(null);

/** The KeyLayout shared by the piano and every stage renderer (set by StudioApp). */
export const PianoLayoutContext = createContext<KeyLayout | null>(null);
