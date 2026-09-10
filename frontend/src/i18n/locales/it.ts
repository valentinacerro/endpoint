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

  'home.title': 'I tuoi viaggi',
  'home.empty': 'Nessun viaggio, per ora.',
  'home.logout': 'Esci',

  'update.available': 'È disponibile una versione aggiornata.',
  'update.reload': 'Ricarica',
} as const

export type TranslationKey = keyof typeof it
