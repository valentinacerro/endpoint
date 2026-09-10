import { Outlet } from 'react-router'

import { TripTabs } from '../components/TripTabs'

/**
 * Everything inside a trip shares the bottom bar.
 *
 * A layout route rather than repeating it on each screen, so the bar never
 * unmounts and never flickers when moving between sections.
 */
export function TripLayout() {
  return (
    <>
      <Outlet />
      <TripTabs />
    </>
  )
}
