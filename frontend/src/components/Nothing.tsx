import type { ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * An empty state that carries its own way out.
 *
 * Every one of these used to be a statement. "No places saved." Full
 * stop. "No stops — add them to give the trip a shape", which tells you
 * to do something without helping you do it. Two of them were also out of
 * date, still advising a Google Maps link on screens that had since grown
 * a lookup and a suggestion list.
 *
 * A screen that knows it is empty always knows why, and by now the app
 * can almost always do something about it. So the shape is fixed: what
 * is missing, why it matters, and the button that fills it.
 */
export function Nothing({
  title,
  hint,
  action,
}: {
  title: string
  /** Why it matters — what stays broken while this is empty. */
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="nothing">
      <p className="nothing__title">{title}</p>
      {hint && <p className="nothing__hint">{hint}</p>}
      {action && <div className="nothing__action">{action}</div>}
    </div>
  )
}

/** The usual action: go to the screen that can fix it. */
export function NothingLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="button button--small" to={to}>
      {label}
    </Link>
  )
}
