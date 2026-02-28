"use client";

import clsx from "clsx";

export interface TabOption<Value extends string> {
  value: Value;
  label: string;
}

interface TabsProps<Value extends string> {
  tabs: TabOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  ariaLabel: string;
  idBase: string;
  variant?: "tabs" | "segmented";
  linkPanels?: boolean;
  className?: string;
}

export function Tabs<Value extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idBase,
  variant = "tabs",
  linkPanels = true,
  className
}: TabsProps<Value>): JSX.Element {
  const focusByIndex = (index: number): void => {
    const element = document.getElementById(`${idBase}-tab-${tabs[index]?.value}`) as HTMLButtonElement | null;
    element?.focus();
  };

  const moveFocus = (nextIndex: number): void => {
    const safeIndex = (nextIndex + tabs.length) % tabs.length;
    const nextValue = tabs[safeIndex]?.value;
    if (!nextValue) {
      return;
    }
    onChange(nextValue);
    focusByIndex(safeIndex);
  };

  return (
    <div
      className={clsx("tabs", variant === "segmented" ? "tabs-segmented" : null, className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={selected && linkPanels ? `${idBase}-panel-${tab.value}` : undefined}
            tabIndex={selected ? 0 : -1}
            className={clsx("tab-btn", selected ? "active" : null)}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => {
              if (tabs.length < 2) {
                return;
              }
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index + 1);
                return;
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index - 1);
                return;
              }
              if (event.key === "Home") {
                event.preventDefault();
                moveFocus(0);
                return;
              }
              if (event.key === "End") {
                event.preventDefault();
                moveFocus(tabs.length - 1);
              }
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
