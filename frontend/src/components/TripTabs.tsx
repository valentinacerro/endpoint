import { NavLink, useParams } from 'react-router'

import { t } from '../i18n'
import type { TranslationKey } from '../i18n'
import { Icon, type IconName } from './Icon'

interface Tab {
  to: string
  label: TranslationKey
  icon: IconName
  /** Only the itinerary matches its parent path exactly. */
  end?: boolean
}

const TABS: Tab[] = [
  { to: '', label: 'tabs.itinerary', icon: 'list', end: true },
  { to: '/places', label: 'tabs.places', icon: 'pin' },
  { to: '/map', label: 'tabs.map', icon: 'map' },
  { to: '/expenses', label: 'tabs.money', icon: 'money' },
  { to: '/more', label: 'tabs.more', icon: 'more' },
]

/**
 * The bar along the bottom.
 *
 * The single clearest signal that something is an app rather than a page:
 * the same destinations always in the same place, reachable with a thumb,
 * instead of a row of links that scrolls away with the content.
 */
export function TripTabs() {
  const { tripId } = useParams<{ tripId: string }>()
  if (!tripId) return null

  return (
    <nav className="tabs" aria-label={t('tabs.sections')}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={`/trips/${tripId}${tab.to}`}
          end={tab.end}
          className={({ isActive }) => `tabs__item ${isActive ? 'tabs__item--on' : ''}`}
        >
          <Icon name={tab.icon} size={22} />
          <span>{t(tab.label)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
