import type { APIRequestContext } from '@playwright/test'

/**
 * A trip with enough on it to fill every screen.
 *
 * Deliberately awkward: a very long place name, a Japanese one, a big
 * number, a nine-word booking title. The layout bugs on a phone are all
 * in the long values, and a seed made of "Test 1" finds none of them.
 */
export async function seedTrip(api: APIRequestContext): Promise<string> {
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const at = (offset: number, time: string) => `${day(offset)}T${time}:00Z`

  const trip = await (
    await api.post('/api/trips', {
      data: {
        title: 'Giappone in primavera, viaggio lungo',
        destination_label: 'Giappone',
        start_date: day(2),
        end_date: day(16),
        primary_tz: 'Europe/Rome',
        primary_currency: 'EUR',
        budget_amount: '4500.00',
        status: 'planned',
      },
    })
  ).json()

  await api.post(`/api/trips/${trip.id}/stops`, {
    data: {
      name: 'Tokyo',
      tz: 'Asia/Tokyo',
      country_code: 'JP',
      lat: 35.6895,
      lon: 139.6917,
      arrive_date: day(2),
      depart_date: day(9),
    },
  })
  await api.post(`/api/trips/${trip.id}/stops`, {
    data: {
      name: 'Kyoto',
      tz: 'Asia/Tokyo',
      country_code: 'JP',
      lat: 35.0116,
      lon: 135.7681,
      arrive_date: day(9),
      depart_date: day(16),
    },
  })

  await api.post(`/api/trips/${trip.id}/bookings`, {
    data: {
      kind: 'flight',
      status: 'confirmed',
      title: 'Roma Fiumicino → Tokyo Haneda, ITA Airways AZ792',
      origin_label: 'Roma Fiumicino (FCO)',
      destination_label: 'Tokyo Haneda (HND)',
      provider: 'ITA Airways',
      confirmation_code: 'QX7K2M',
      start_at: at(2, '11:40'),
      start_tz: 'Europe/Rome',
      end_at: at(3, '06:10'),
      end_tz: 'Asia/Tokyo',
      price_amount: '812.34',
      price_currency: 'EUR',
    },
  })
  await api.post(`/api/trips/${trip.id}/bookings`, {
    data: {
      kind: 'hotel',
      status: 'pending',
      title: 'Ryokan Sanga — camera tradizionale con onsen privato',
      address: '2 Chome-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan',
      lat: 35.7148,
      lon: 139.7967,
      start_at: at(3, '06:00'),
      start_tz: 'Asia/Tokyo',
      end_at: at(9, '01:00'),
      end_tz: 'Asia/Tokyo',
    },
  })

  const places: [string, string, number, number][] = [
    ['Sensō-ji', 'temple', 35.7148, 139.7967],
    ['Chao Chao Gyoza - Shijo Kawaramachi, 312-1 Junpucho, Kyoto', 'food', 35.0028, 135.7695],
    ['東京国立博物館 — Tokyo National Museum', 'museum', 35.7188, 139.7765],
    ['Shibuya Scramble Crossing', 'sight', 35.6595, 139.7006],
  ]
  for (const [name, category, lat, lon] of places) {
    await api.post(`/api/trips/${trip.id}/places`, {
      data: { name, category, priority: 'normal', visit_minutes: 90, lat, lon },
    })
  }

  await api.put(`/api/trips/${trip.id}/expenses`, {
    data: {
      id: crypto.randomUUID(),
      category: 'food',
      description: 'Cena da Ichiran, Shibuya — due ramen e due birre',
      amount: '3480.00',
      currency: 'JPY',
      spent_at: day(3),
      payment_method: 'card',
    },
  })

  return trip.id as string
}
