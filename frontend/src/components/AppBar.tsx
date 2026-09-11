import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { t } from '../i18n'
import { Icon } from './Icon'

interface Props {
  title: string
  subtitle?: string
  /** Where the back chevron goes. Omitted on a root screen. */
  back?: string
  action?: ReactNode
}

/**
 * The bar at the top of a screen.
 *
 * Sticky, compact, and always in the same place: on a phone the title and
 * the way back are the two things you look for without thinking, and a
 * header that scrolls away with the content makes you hunt for both.
 */
export function AppBar({ title, subtitle, back, action }: Props) {
  return (
    <header className="appbar">
      {back && (
        <Link className="appbar__back" to={back} aria-label={t('common.back')}>
          <Icon name="back" size={22} />
        </Link>
      )}
      <div className="appbar__titles">
        <h1 className="appbar__title">{title}</h1>
        {subtitle && <p className="appbar__subtitle">{subtitle}</p>}
      </div>
      {action && <div className="appbar__action">{action}</div>}
    </header>
  )
}
