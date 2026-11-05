import clsx from "clsx";
import type { ReactNode } from "react";

export interface PlaceholderProps {
  title: string;
  description?: string;
  /** Epic or integration point that will fill this slot, e.g. "E11". */
  pendingOn?: string;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** Clearly marked stand-in for a slot that another module will fill. */
export function Placeholder({ title, description, pendingOn, children, compact = false, className }: PlaceholderProps): JSX.Element {
  return (
    <div className={clsx("pls-placeholder", compact && "pls-placeholder--compact", className)}>
      <p className="pls-placeholder__title">{title}</p>
      {description ? <p className="pls-placeholder__text">{description}</p> : null}
      {pendingOn ? <p className="pls-placeholder__pending">Arrives with {pendingOn}</p> : null}
      {children}
    </div>
  );
}
