/**
 * Pin the interface language for the test suite.
 *
 * Without this the language is detected from the environment, and jsdom
 * reports `en-US` — so the suite would test English on a machine whose
 * browser happens to be in English and Italian on one that is not. Tests
 * that care about a particular language say so themselves.
 */
import { beforeEach } from 'vitest'

import { setLocale } from './i18n/locale'

beforeEach(() => setLocale('it'))
