import type { ReactNode } from 'react'

/**
 * The primary action, floating above the content.
 *
 * A full-width button in the flow works on a page; on a phone the one thing
 * you came to do should be reachable without scrolling to wherever it
 * happens to sit. It clears the bottom bar and the home indicator.
 */
export function Fab({ onClick, label }: { onClick: () => void; label: ReactNode }) {
  return (
    <button className="fab" onClick={onClick}>
      <span className="fab__plus" aria-hidden="true">
        +
      </span>
      {label}
    </button>
  )
}
