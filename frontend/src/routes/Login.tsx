import { useState, type FormEvent } from 'react'

import { useLogin } from '../api/auth'
import { t } from '../i18n'
import type { TranslationKey } from '../i18n'

const ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_password: 'login.error.invalid_password',
  rate_limited: 'login.error.rate_limited',
  offline: 'login.error.offline',
  network_error: 'login.error.offline',
}

export function Login() {
  const [password, setPassword] = useState('')
  const login = useLogin()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length === 0) return
    login.mutate(password)
  }

  // The backend sends a `code`; the wording is chosen here.
  const errorKey = login.error ? (ERROR_KEYS[login.error.code] ?? 'login.error.generic') : null

  return (
    <main className="login">
      <form className="card login__card" onSubmit={onSubmit}>
        <img className="login__mark" src="/icons/icon-192.png" alt="" width={56} height={56} />
        <h1 className="login__title">{t('login.title')}</h1>
        <p className="login__subtitle">{t('login.subtitle')}</p>

        <label className="field">
          <span className="field__label">{t('login.password')}</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={login.isPending}
          />
        </label>

        {errorKey && (
          <p className="field__error" role="alert">
            {t(errorKey)}
          </p>
        )}

        <button className="button" type="submit" disabled={login.isPending || !password}>
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </main>
  )
}
