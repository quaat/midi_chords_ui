"use client";

import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import clsx from "clsx";
import { BookOpen, Info, ListChecks, Maximize2, Minimize2, Moon, Music, Sun } from "lucide-react";
import type { EntryView, ThemeName, WorkspaceMode } from "@/state/sessionStore";
import { Placeholder } from "@/ui/workspace/Placeholder";

export interface ModeContent {
  /** Main stage above the piano (falling notes, comparisons, progression editor...). */
  stage?: ReactNode;
  /** Collapsible context panel (lesson / voicing explanation, A/B listening). */
  context?: ReactNode;
  contextTitle?: string;
  /** Overrides the shell-level current/next strip for this mode. */
  currentNext?: ReactNode;
}

export type LibraryView = Exclude<EntryView, "workspace">;

export interface WorkspaceShellProps {
  title?: string;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  entryView: EntryView;
  onEntryViewChange: (view: EntryView) => void;
  theme: ThemeName;
  onToggleTheme: () => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  contextPanelOpen: boolean;
  onToggleContextPanel: () => void;
  modes?: Partial<Record<WorkspaceMode, ModeContent>>;
  /** Learn / Songs / My Practice entry views (rendered above the same persistent piano). */
  views?: Partial<Record<LibraryView, ReactNode>>;
  /** The single persistent piano, anchored at the bottom of the centre column. */
  piano: ReactNode;
  /** Default current/next strip shown under the stage. */
  currentNext?: ReactNode;
  transport?: ReactNode;
  devicePanel?: ReactNode;
  /** Extra left-column content (material list, session summary). */
  sidebar?: ReactNode;
  topBarExtras?: ReactNode;
  className?: string;
}

const MODE_TABS: { value: WorkspaceMode; label: string; hint: string }[] = [
  { value: "explore", label: "Explore", hint: "Discover chords, scales and voicings" },
  { value: "practice", label: "Practice", hint: "Follow a lesson or rehearse" },
  { value: "create", label: "Create", hint: "Build progressions and experiments" }
];

const LIBRARY_LINKS: { value: LibraryView; label: string; icon: JSX.Element }[] = [
  { value: "learn", label: "Learn", icon: <BookOpen size={16} aria-hidden="true" /> },
  { value: "songs", label: "Songs", icon: <Music size={16} aria-hidden="true" /> },
  { value: "myPractice", label: "My Practice", icon: <ListChecks size={16} aria-hidden="true" /> }
];

const VIEW_PLACEHOLDERS: Record<LibraryView, { title: string; description: string; pendingOn: string }> = {
  learn: { title: "Learn", description: "Searchable concepts and learning paths open straight into the workspace.", pendingOn: "content integration (E16–E18)" },
  songs: { title: "Songs", description: "Chord charts with accompaniment, opened into Practice.", pendingOn: "song charts (E30)" },
  myPractice: { title: "My Practice", description: "Your practice queue, routines and recent sessions.", pendingOn: "local progress (E19)" }
};

const MODE_PLACEHOLDERS: Record<WorkspaceMode, { title: string; description: string }> = {
  explore: { title: "Explore", description: "Select a chord, hear alternatives and inspect its degrees." },
  practice: { title: "Practice", description: "Listen, play without time pressure, then repeat with tempo." },
  create: { title: "Create", description: "Edit chord blocks or text, compare voice leading and save." }
};

export function WorkspaceShell({
  title = "Piano Learning Studio",
  mode,
  onModeChange,
  entryView,
  onEntryViewChange,
  theme,
  onToggleTheme,
  focusMode,
  onToggleFocusMode,
  contextPanelOpen,
  onToggleContextPanel,
  modes,
  views,
  piano,
  currentNext,
  transport,
  devicePanel,
  sidebar,
  topBarExtras,
  className
}: WorkspaceShellProps): JSX.Element {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const content = modes?.[mode];
  const inWorkspace = entryView === "workspace";
  const library = inWorkspace ? null : (entryView as LibraryView);
  const panelId = "pls-mode-panel";
  const showContext = !focusMode && contextPanelOpen;

  const handleTabKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();
    const current = MODE_TABS.findIndex((t) => t.value === mode);
    let next = current;
    if (event.key === "ArrowLeft") {
      next = (current - 1 + MODE_TABS.length) % MODE_TABS.length;
    } else if (event.key === "ArrowRight") {
      next = (current + 1) % MODE_TABS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else {
      next = MODE_TABS.length - 1;
    }
    onModeChange(MODE_TABS[next].value);
    tabRefs.current[next]?.focus();
  };

  let stage: ReactNode;
  if (library) {
    const placeholder = VIEW_PLACEHOLDERS[library];
    stage = views?.[library] ?? <Placeholder title={placeholder.title} description={placeholder.description} pendingOn={placeholder.pendingOn} />;
  } else {
    const placeholder = MODE_PLACEHOLDERS[mode];
    stage = content?.stage ?? <Placeholder title={placeholder.title} description={placeholder.description} />;
  }
  const strip = inWorkspace ? content?.currentNext ?? currentNext : null;

  return (
    <div
      className={clsx(
        "pls-shell",
        focusMode && "pls-shell--focus",
        !showContext && "pls-shell--no-context",
        !devicePanel && !sidebar && "pls-shell--no-left",
        className
      )}
    >
      <a className="pls-skip-link" href="#pls-main">
        Skip to the piano workspace
      </a>
      <header className="pls-topbar">
        <div className="pls-topbar__brand">
          <span className="pls-topbar__logo" aria-hidden="true">
            ♪
          </span>
          <span className="pls-topbar__title">{title}</span>
        </div>
        <nav className="pls-topbar__nav" aria-label="Library">
          {LIBRARY_LINKS.map((link) => {
            const active = entryView === link.value;
            return (
              <button
                key={link.value}
                type="button"
                className={clsx("pls-navlink", active && "pls-navlink--active")}
                aria-current={active ? "page" : undefined}
                onClick={() => onEntryViewChange(active ? "workspace" : link.value)}
              >
                {link.icon}
                <span>{link.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="pls-topbar__actions">
          {topBarExtras}
          <button type="button" className="pls-btn pls-btn--ghost" onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            <span className="pls-hide-narrow">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <button type="button" className={clsx("pls-btn", "pls-btn--ghost", focusMode && "pls-toggle--on")} onClick={onToggleFocusMode} aria-pressed={focusMode}>
            {focusMode ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            <span>{focusMode ? "Exit focus" : "Focus"}</span>
          </button>
        </div>
      </header>

      <div className="pls-shell__body">
        {devicePanel || sidebar ? (
          <aside className="pls-shell__left" aria-label="Devices and session">
            {devicePanel}
            {sidebar}
          </aside>
        ) : null}

        <main id="pls-main" className="pls-shell__center" tabIndex={-1}>
          <div className="pls-modebar">
            <div className="pls-tabs" role="tablist" aria-label="Workspace mode" onKeyDown={handleTabKey}>
              {MODE_TABS.map((tab, index) => {
                const selected = inWorkspace && tab.value === mode;
                return (
                  <button
                    key={tab.value}
                    ref={(el) => {
                      tabRefs.current[index] = el;
                    }}
                    id={`pls-tab-${tab.value}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={tab.value === mode ? 0 : -1}
                    title={tab.hint}
                    className={clsx("pls-tabs__tab", selected && "pls-tabs__tab--active")}
                    onClick={() => onModeChange(tab.value)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {library ? (
              <span className="pls-modebar__crumb">
                {VIEW_PLACEHOLDERS[library].title}
                <button type="button" className="pls-btn pls-btn--small" onClick={() => onEntryViewChange("workspace")}>
                  Back to {MODE_PLACEHOLDERS[mode].title}
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className={clsx("pls-btn", "pls-btn--ghost", "pls-modebar__context", contextPanelOpen && "pls-toggle--on")}
              onClick={onToggleContextPanel}
              aria-pressed={contextPanelOpen}
              aria-controls={showContext ? "pls-context-panel" : undefined}
            >
              <Info size={16} aria-hidden="true" />
              <span>{contextPanelOpen ? "Hide panel" : "Show panel"}</span>
            </button>
          </div>

          {transport ? <div className="pls-shell__transport">{transport}</div> : null}

          <section
            id={panelId}
            className="pls-shell__stage"
            role={inWorkspace ? "tabpanel" : "region"}
            aria-labelledby={inWorkspace ? `pls-tab-${mode}` : undefined}
            aria-label={inWorkspace ? undefined : VIEW_PLACEHOLDERS[entryView as LibraryView].title}
          >
            {stage}
          </section>

          {strip ? <div className="pls-shell__strip">{strip}</div> : null}

          <div className="pls-shell__piano">{piano}</div>
        </main>

        {showContext ? (
          <aside id="pls-context-panel" className="pls-shell__right" aria-label={content?.contextTitle ?? "Context"}>
            {content?.context ?? <Placeholder title={content?.contextTitle ?? "Context"} description="Explanations for the selected notes appear here." compact />}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
