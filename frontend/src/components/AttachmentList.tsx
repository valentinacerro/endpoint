import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { attachmentUrl, useDeleteAttachment, useUploadAttachment } from '../api/trips'
import type { Attachment } from '../api/types'
import { t } from '../i18n'
import { formatBytes, prepareForUpload } from '../lib/images'
import { isPinned, pin, unpin } from '../offline/attachmentCache'
import { DocumentViewer } from './DocumentViewer'
import { Icon } from './Icon'

// A function rather than a module-level map: `t()` must be called at render
// time, or switching language in Phase 3 would leave these frozen at
// whatever was active when the module first loaded.
function uploadErrorText(code: string): string {
  if (code === 'file_too_large') return t('document.tooLarge')
  if (code === 'unsupported_file_type') return t('document.badType')
  return t('common.error')
}

function OfflineToggle({ url }: { url: string }) {
  const [pinned, setPinned] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void isPinned(url).then((value) => !cancelled && setPinned(value))
    return () => {
      cancelled = true
    }
  }, [url])

  if (pinned === null) return null

  async function toggle() {
    setBusy(true)
    if (pinned) {
      await unpin(url)
      setPinned(false)
    } else {
      setPinned(await pin(url))
    }
    setBusy(false)
  }

  return (
    <button
      className={`chip ${pinned ? 'chip--on' : ''}`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={pinned}
    >
      {pinned && <Icon name="check" size={14} />}
      {pinned ? t('document.savedOffline') : t('document.saveOffline')}
    </button>
  )
}

/** A document still in the queue, standing in for one the server has. */
export function isWaiting(attachment: Attachment): boolean {
  return attachment.id.startsWith('pending:')
}

interface Props {
  tripId: string
  bookingId: string
  attachments: Attachment[]
}

export function AttachmentList({ tripId, bookingId, attachments }: Props) {
  const upload = useUploadAttachment(tripId)
  const remove = useDeleteAttachment(tripId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<Attachment | null>(null)
  const [shrunk, setShrunk] = useState<string | null>(null)

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = ''
    if (!file) return

    const { file: prepared, originalBytes } = await prepareForUpload(file)
    setShrunk(
      prepared.size < originalBytes
        ? t('document.shrunk', {
            from: formatBytes(originalBytes),
            to: formatBytes(prepared.size),
          })
        : null,
    )
    upload.mutate({ file: prepared, bookingId })
  }

  return (
    <section className="stack stack--tight">
      <h2 className="section__title">{t('document.title')}</h2>

      {attachments.length === 0 && <p className="muted">{t('document.none')}</p>}

      <ul className="docs">
        {attachments.map((attachment) => {
          // A file chosen with no network: it is on the phone and in the
          // queue, but the server has never seen it, so there is nothing
          // at its address to open, pin for offline, or delete. Saying so
          // is better than three controls that all fail.
          if (isWaiting(attachment)) {
            return (
              <li key={attachment.id} className="doc">
                <span className="doc__open" style={{ cursor: 'default' }}>
                  <span className="doc__name">{attachment.filename}</span>
                  <span className="doc__meta">
                    {formatBytes(attachment.byte_size)} · {t('document.waiting')}
                  </span>
                </span>
              </li>
            )
          }
          const url = attachmentUrl(tripId, attachment.id)
          return (
            <li key={attachment.id} className="doc">
              <button className="doc__open" onClick={() => setOpen(attachment)}>
                <span className="doc__name">{attachment.filename}</span>
                <span className="doc__meta">{formatBytes(attachment.byte_size)}</span>
              </button>
              <div className="doc__actions">
                <OfflineToggle url={url} />
                <button
                  className="chip chip--danger"
                  onClick={() => remove.mutate(attachment.id)}
                  disabled={remove.isPending}
                  aria-label={t('common.delete')}
                >
                  ×
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => void onPick(event)}
      />
      <button
        className="button button--quiet"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
      >
        {upload.isPending ? t('document.uploading') : t('document.add')}
      </button>

      {shrunk && <p className="muted small">{shrunk}</p>}
      {upload.error && (
        <p className="field__error" role="alert">
          {uploadErrorText(upload.error.code)}
        </p>
      )}

      {open && (
        <DocumentViewer
          url={attachmentUrl(tripId, open.id)}
          contentType={open.content_type}
          filename={open.filename}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  )
}
