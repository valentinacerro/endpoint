import { useEffect, useRef, useState } from 'react'

import { t } from '../i18n'
import { fetchDocument } from '../offline/attachmentCache'
import { Icon } from './Icon'

interface Props {
  url: string
  contentType: string
  filename: string
  onClose: () => void
}

/**
 * Shows a document inside the app.
 *
 * PDFs are drawn with pdf.js onto a canvas rather than handed to an
 * `<iframe>`: Chrome on Android does not reliably render them inline and
 * tends to offer a download instead, which throws you out of the app and
 * loses your place. Drawing it ourselves also means it works from the
 * offline cache, which an iframe pointed at a URL would not.
 *
 * pdf.js is imported dynamically — it is around 350 kB and has no business
 * being in the bundle that decides how fast the app opens.
 */
export function DocumentViewer({ url, contentType, filename, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const isPdf = contentType === 'application/pdf'

  // Images: straight to a blob URL.
  useEffect(() => {
    if (isPdf) return
    let objectUrl: string | null = null
    let cancelled = false

    fetchDocument(url)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
        setLoading(false)
      })
      .catch(() => !cancelled && (setError(true), setLoading(false)))

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, isPdf])

  // PDFs: render the current page onto the canvas.
  useEffect(() => {
    if (!isPdf) return
    let cancelled = false
    // `destroy()` lives on the loading task, not on the document — it is
    // what tears down the worker as well.
    let task: { destroy: () => Promise<void> } | null = null

    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist')
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

        const blob = await fetchDocument(url)
        if (cancelled) return

        // pdf.js 6 removed the `isEvalSupported` option: evaluation is off
        // for good now, which is how the advisory against 5.x was closed.
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
        })
        task = loadingTask
        const doc = await loadingTask.promise
        if (cancelled) return
        setPageCount(doc.numPages)

        const pdfPage = await doc.getPage(page)
        const canvas = canvasRef.current
        if (cancelled || !canvas) return

        const context = canvas.getContext('2d')
        if (!context) return

        // Fit the width of the container, and draw at device resolution so
        // small print on a voucher stays legible.
        const available = canvas.parentElement?.clientWidth ?? 320
        const unscaled = pdfPage.getViewport({ scale: 1 })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = pdfPage.getViewport({ scale: (available / unscaled.width) * ratio })

        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'

        await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    void render()
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [url, isPdf, page])

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={filename}>
      <header className="viewer__bar">
        <span className="viewer__name">{filename}</span>
        <button className="button button--small button--quiet" onClick={onClose}>
          {t('common.close')}
        </button>
      </header>

      <div className="viewer__stage">
        {loading && <p className="muted">{t('common.loading')}</p>}
        {error && <p className="field__error">{t('document.cannotOpen')}</p>}
        {isPdf ? (
          <canvas ref={canvasRef} className="viewer__canvas" />
        ) : (
          imageUrl && <img className="viewer__image" src={imageUrl} alt={filename} />
        )}
      </div>

      {isPdf && pageCount > 1 && (
        <footer className="viewer__pages">
          <button
            className="button button--small button--quiet"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            aria-label={t('document.prevPage')}
          >
            <Icon name="back" size={16} />
          </button>
          <span className="muted">{t('document.page', { page, total: pageCount })}</span>
          <button
            className="button button--small button--quiet"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page >= pageCount}
            aria-label={t('document.nextPage')}
          >
            <Icon name="forward" size={16} />
          </button>
        </footer>
      )}
    </div>
  )
}
