import { useLogout } from '../api/auth'
import { t } from '../i18n'

/** Placeholder: the trip list arrives with Phase 1. */
export function Home() {
  const logout = useLogout()

  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">{t('home.title')}</h1>
        <button className="button button--quiet" onClick={() => logout.mutate()}>
          {t('home.logout')}
        </button>
      </header>
      <p className="page__empty">{t('home.empty')}</p>
    </main>
  )
}
