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

/**
 * Five destinations, and they are things you do rather than tables.
 *
 * The bar used to be four tables — itinerary, places, map, spending —
 * and a drawer holding twelve things, of which the first was "Organizza
 * il viaggio" and the second "Tappe": the app's only reason to exist and
 * its prerequisite, both behind a tab called "Altro". The things you
 * *look at* had a tab each and the things you *do* were all in the
 * drawer.
 *
 * Bookings take the place the map had. A map is a way of looking at
 * places, so it sits on the places screen and on the itinerary's bar,
 * where there is something to look at; what you have booked is a
 * standing question with nowhere to ask it.
 */
const TABS: Tab[] = [
  { to: '', label: 'tabs.trip', icon: 'list', end: true },
  { to: '/places', label: 'tabs.places', icon: 'pin' },
  { to: '/bookings', label: 'tabs.bookings', icon: 'flight' },
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
