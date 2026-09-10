import { NavLink, useParams } from 'react-router'

import { t } from '../i18n'
import type { TranslationKey } from '../i18n'

interface Tab {
  to: string
  label: TranslationKey
  icon: string
  /** Only the itinerary matches its parent path exactly. */
  end?: boolean
}

const TABS: Tab[] = [
  { to: '', label: 'tabs.itinerary', icon: 'M4 6h16M4 12h16M4 18h10', end: true },
  { to: '/places', label: 'tabs.places', icon: 'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z' },
  { to: '/map', label: 'tabs.map', icon: 'M9 4l6 2 6-2v14l-6 2-6-2-6 2V6z' },
  { to: '/expenses', label: 'tabs.money', icon: 'M12 3v18M8 7h6a3 3 0 010 6H9a3 3 0 000 6h7' },
  { to: '/more', label: 'tabs.more', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
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
    <nav className="tabs" aria-label="Sezioni del viaggio">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={`/trips/${tripId}${tab.to}`}
          end={tab.end}
          className={({ isActive }) => `tabs__item ${isActive ? 'tabs__item--on' : ''}`}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d={tab.icon}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{t(tab.label)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
