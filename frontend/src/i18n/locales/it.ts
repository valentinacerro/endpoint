/**
 * Italian dictionary.
 *
 * Flat, dot-separated keys, like i18next: adding a language in Phase 3 means
 * copying this file and translating the values. The keys never change — and
 * translated text never reaches the database.
 *
 * This is the one file in the repository whose *values* are not in English:
 * it is, by definition, the Italian user interface.
 */

export const it = {
  'app.name': 'Viaggi',

  'common.save': 'Salva',
  'common.saving': 'Salvataggio…',
  'common.cancel': 'Annulla',
  'common.delete': 'Elimina',
  'common.add': 'Aggiungi',
  'common.back': 'Indietro',
  'common.loading': 'Caricamento…',
  'common.error': 'Qualcosa è andato storto.',
  'common.optional': 'facoltativo',
  'common.confirmDelete': 'Vuoi davvero eliminare "{name}"?',

  'login.title': 'Accesso',
  'login.subtitle': 'Questa app contiene i tuoi documenti di viaggio.',
  'login.password': 'Password',
  'login.submit': 'Entra',
  'login.submitting': 'Verifica…',
  'login.error.invalid_password': 'Password errata.',
  'login.error.rate_limited': 'Troppi tentativi. Aspetta un minuto e riprova.',
  'login.error.offline': 'Nessuna connessione: per accedere serve la rete.',
  'login.error.generic': 'Non è stato possibile accedere.',

  'sync.offline': 'Offline',
  'sync.waking': 'Riattivazione del server… può richiedere fino a un minuto',
  'sync.online': 'Aggiornato',
  'sync.updated': 'Aggiornato: {when}',

  'trips.title': 'I tuoi viaggi',
  'trips.empty': 'Nessun viaggio, per ora.',
  'trips.new': 'Nuovo viaggio',
  'trips.logout': 'Esci',
  'trips.dates': 'dal {from} al {to}',
  'trips.noDates': 'Date da definire',

  'trip.field.title': 'Nome del viaggio',
  'trip.field.destination': 'Destinazione',
  'trip.field.startDate': 'Partenza',
  'trip.field.endDate': 'Ritorno',
  'trip.field.timezone': 'Fuso di riferimento',
  'trip.field.currency': 'Valuta',
  'trip.field.budget': 'Budget',
  'trip.status.planned': 'In programma',
  'trip.status.active': 'In corso',
  'trip.status.done': 'Concluso',
  'trip.status.archived': 'Archiviato',

  'timeline.day': 'Giorno {n}',
  'timeline.emptyDay': 'Niente in programma.',
  'timeline.empty': 'Nessuna prenotazione. Aggiungine una per vedere l’itinerario.',
  'timeline.undated': 'Senza data',
  'timeline.next': 'Prossimo',
  'timeline.inYourZone': 'le {time} da te',
  'timeline.addBooking': 'Aggiungi prenotazione',

  'booking.kind.hotel': 'Hotel',
  'booking.kind.flight': 'Volo',
  'booking.kind.train': 'Treno',
  'booking.kind.bus': 'Autobus',
  'booking.kind.ferry': 'Traghetto',
  'booking.kind.car_rental': 'Noleggio auto',
  'booking.kind.activity': 'Attività',
  'booking.kind.restaurant': 'Ristorante',
  'booking.kind.other': 'Altro',

  'booking.field.kind': 'Tipo',
  'booking.field.title': 'Nome',
  'booking.field.provider': 'Fornitore',
  'booking.field.code': 'Codice prenotazione',
  'booking.field.start': 'Inizio',
  'booking.field.startTz': 'Fuso di partenza',
  'booking.field.end': 'Fine',
  'booking.field.endTz': 'Fuso di arrivo',
  'booking.field.origin': 'Da',
  'booking.field.destination': 'A',
  'booking.field.address': 'Indirizzo',
  'booking.field.notes': 'Note',
  'booking.hint.differentZones':
    'Partenza e arrivo hanno fusi diversi: un Roma-Tokyo parte e atterra su due orologi.',

  'update.available': 'È disponibile una versione aggiornata.',
  'update.reload': 'Ricarica',
} as const

export type TranslationKey = keyof typeof it
