/**
 * The drawn icons, in one place.
 *
 * They replace emoji, which were doing more damage than the typeface:
 * one on every row of the itinerary and every row of the forecast, the
 * two screens looked at daily. Emoji are a different drawing on Android,
 * on a Mac and in Chrome; they carry their own colours, which fight any
 * palette; they cannot take the weight of the text around them; and they
 * print as boxes or as nothing.
 *
 * One stroke width, one cap style, colour inherited — so an icon sits at
 * the same weight as the words beside it, in both themes, and on paper.
 */

export type IconName =
  | 'hotel'
  | 'flight'
  | 'train'
  | 'bus'
  | 'ferry'
  | 'car'
  | 'ticket'
  | 'food'
  | 'pin'
  | 'temple'
  | 'museum'
  | 'park'
  | 'shop'
  | 'view'
  | 'clear'
  | 'cloud'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'check'
  | 'search'
  | 'list'
  | 'map'
  | 'money'
  | 'more'
  | 'paperclip'
  | 'star'
  | 'back'
  | 'forward'
  | 'up'
  | 'down'
  | 'directions'

/**
 * Paths on a 24×24 grid, stroked rather than filled.
 *
 * Drawn to read at 16px, which is the size they are actually used at —
 * an icon designed at 48 and scaled down loses its detail into mud.
 */
export const ICON_PATHS: Record<IconName, string> = {
  hotel: 'M3 5v15M3 9h15a3 3 0 013 3v8M3 17h18M7 9v8',
  flight: 'M3 13l18-6-6 18-3-8-9-4z',
  train: 'M6 3h12v13H6zM6 9h12M8 19l-2 3m12-3l2 3M9 12.5h.01m6 0h.01',
  bus: 'M5 4h14v13H5zM5 10h14M8 20v-3m8 3v-3M8 13.5h.01m8 0h.01',
  ferry: 'M3 19c2 0 2-1.5 4.5-1.5S12 19 12 19s2-1.5 4.5-1.5S21 19 21 19M4.5 15.5L6 11h12l1.5 4.5zM12 11V6M9 8h3',
  car: 'M4 17v2m16-2v2M3 17v-5l2.5-5h13L21 12v5zM3 12h18M7 14.5h.01m10 0h.01',
  ticket: 'M4 8h16v2.5a1.5 1.5 0 100 3V16H4v-2.5a1.5 1.5 0 100-3zM14 8v1m0 3v1m0 3v1',
  food: 'M3 11h18a9 9 0 01-18 0zM9 8c0-1.2 1.2-1.2 1.2-2.4S9 4.4 9 3.2M14.4 8c0-1.2 1.2-1.2 1.2-2.4s-1.2-1.2-1.2-2.4',
  pin: 'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 10h.01',
  temple: 'M3 5.5h18M5 9h14M6.5 5.5v14M17.5 5.5v14',
  museum: 'M3 9l9-5 9 5M5 9v9m4-9v9m6-9v9m4-9v9M3 21h18',
  park: 'M12 22v-3M12 4l-5 7h10zM12 10l-6 9h12z',
  shop: 'M4 9h16l-1 11H5zM9 9V6a3 3 0 016 0v3',
  view: 'M3 19l6-8 4 5 2-2 6 5zM16 7h.01',
  clear: 'M12 4V2m0 20v-2M4 12H2m20 0h-2M6 6L4.5 4.5M19.5 19.5L18 18M18 6l1.5-1.5M4.5 19.5L6 18M12 8a4 4 0 100 8 4 4 0 000-8z',
  cloud: 'M7 18a4 4 0 010-8 5 5 0 019.6-1A3.5 3.5 0 0117.5 18z',
  fog: 'M7 13a3.5 3.5 0 010-7 4.5 4.5 0 018.6-.9A3.2 3.2 0 0116.5 13zM5 17h14M7 21h10',
  rain: 'M7 15a4 4 0 010-8 5 5 0 019.6-1A3.5 3.5 0 0117.5 15M8 18l-1 3m5-3l-1 3m5-3l-1 3',
  snow: 'M7 14a4 4 0 010-8 5 5 0 019.6-1A3.5 3.5 0 0117.5 14M8 18h.01M12 20h.01M16 18h.01',
  storm: 'M7 14a4 4 0 010-8 5 5 0 019.6-1A3.5 3.5 0 0117.5 14M13 14l-3 4h4l-3 4',
  check: 'M4 13l5 5L20 6',
  search: 'M11 18a7 7 0 110-14 7 7 0 010 14zM16 16l4 4',
  list: 'M4 6h16M4 12h16M4 18h10',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14m6-10v14',
  money: 'M12 3v18M8 7h6a3 3 0 010 6H9a3 3 0 000 6h7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  paperclip: 'M17 8v8a5 5 0 01-10 0V7a3 3 0 016 0v9a1 1 0 01-2 0V8',
  star: 'M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  directions: 'M21 3L3 10l8 3 3 8z',
}

interface Props {
  name: IconName
  /** Matches the line-height of the text it sits beside. */
  size?: number
  className?: string
  /**
   * A name, when the icon is the only thing saying what this is. Left
   * off — and hidden from a screen reader — when the label is right
   * next to it, which is the usual case here.
   */
  title?: string
}

export function Icon({ name, size = 18, className, title }: Props) {
  return (
    <svg
      className={className ?? 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}
