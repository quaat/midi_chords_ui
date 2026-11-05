"use client";

/**
 * React access to the practice controller (practiceController.ts).
 * - `usePracticeSession({ drive: true })` — used once by the Practice stage: attaches the
 *   controller (input, transport, frame loop, piano target layer) while mounted.
 * - `usePracticeSession()` — any other component (context panel, review) reads state/acts.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import type { PracticeController, PracticeControllerState } from "@/ui/practice/practiceController";
import { getPracticeController } from "@/ui/practice/practiceController";
import type { RoutineState } from "@/ui/practice/RoutineRunner";
import { routineStore } from "@/ui/practice/RoutineRunner";

export interface PracticeSessionApi {
  controller: PracticeController;
  state: PracticeControllerState;
}

export function usePracticeController(): PracticeController {
  return getPracticeController(useStudioRuntime());
}

export function usePracticeSession(options: { drive?: boolean } = {}): PracticeSessionApi {
  const controller = usePracticeController();
  const drive = options.drive === true;
  useEffect(() => {
    if (!drive) {
      return undefined;
    }
    return controller.attach();
  }, [controller, drive]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { controller, state };
}

export function useRoutineState(): RoutineState {
  return useSyncExternalStore(routineStore.subscribe, routineStore.getState, routineStore.getState);
}
