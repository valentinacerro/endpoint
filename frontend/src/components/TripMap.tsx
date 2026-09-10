import { useEffect, useRef } from 'react'

import { t } from '../i18n'

export interface MapPin {
  id: string
  /** 1-based position within the day, drawn inside the pin. */
  order: number
  lat: number
  lon: number
  label: string
  /** Colours the pin the same way the timeline colours its dot. */
  kind: 'travel' | 'stay' | 'food' | 'see' | 'other'
}

const KIND_COLOUR: Record<MapPin['kind'], string> = {
  travel: '#3f6fb5',
  stay: '#2f8f6f',
  food: '#c9812f',
  see: '#7a5bb5',
  other: '#7c8090',
}

/**
 * The day's stops on a map, in the order you would walk them.
 *
 * Leaflet with OpenStreetMap tiles: a Google map embedded in a page needs a
 * billing account, and this needs nothing at all. It is loaded on demand —
 * the library and its tiles have no business slowing down an app whose main
 * screen has to open instantly and offline.
 *
 * Tiles do need the network. Everything else in this app works in airplane
 * mode; this screen does not, and says so rather than showing grey squares.
 */
export function TripMap({ pins }: { pins: MapPin[] }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current || pins.length === 0) return
    let cancelled = false
    let map: { remove: () => void } | null = null

    async function draw() {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      if (cancelled || !container.current) return

      const instance = L.map(container.current, { scrollWheelZoom: false })
      map = instance

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // Required by the OSM tile usage policy, and only fair.
        attribution: '© OpenStreetMap',
      }).addTo(instance)

      const points: [number, number][] = pins.map((pin) => [pin.lat, pin.lon])

      // Numbered circles rather than Leaflet's default marker: the default
      // pulls image assets that bundlers mangle, and a number tells you the
      // order of the day at a glance, which a teardrop cannot.
      pins.forEach((pin) => {
        L.marker([pin.lat, pin.lon], {
          icon: L.divIcon({
            className: 'map-pin-wrap',
            html: `<span class="map-pin" style="--pin:${KIND_COLOUR[pin.kind]}">${pin.order}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        })
          .addTo(instance)
          .bindPopup(pin.label)
      })

      if (points.length > 1) {
        L.polyline(points, { color: '#1e2952', weight: 2, opacity: 0.5, dashArray: '5 6' }).addTo(
          instance,
        )
        instance.fitBounds(L.latLngBounds(points), { padding: [40, 40] })
      } else {
        instance.setView(points[0], 15)
      }
    }

    void draw()
    return () => {
      cancelled = true
      map?.remove()
    }
  }, [pins])

  if (pins.length === 0) {
    return <p className="empty">{t('map.nothingToShow')}</p>
  }

  return <div ref={container} className="map" />
}
