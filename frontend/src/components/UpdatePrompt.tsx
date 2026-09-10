import { useRegisterSW } from 'virtual:pwa-register/react'

import { t } from '../i18n'

/**
 * App updates.
 *
 * We ask instead of reloading on our own: while travelling, a page that
 * reloads itself just as you are reading a booking reference is about the most
 * annoying thing that can happen.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update-prompt" role="status">
      <span>{t('update.available')}</span>
      <button className="button button--small" onClick={() => void updateServiceWorker(true)}>
        {t('update.reload')}
      </button>
    </div>
  )
}
