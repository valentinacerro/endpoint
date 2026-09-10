/**
 * Shrinking photos before they are uploaded.
 *
 * A phone camera produces 3-6 MB per shot. Forty of those would fill a good
 * share of the free 0.5 GB the whole trip has to live in, and each one would
 * be re-downloaded onto the phone for offline use. A voucher photographed at
 * 2000 px is perfectly readable at roughly a tenth of the size.
 *
 * Everything here fails soft: if the browser cannot decode the image, the
 * original file is uploaded unchanged. A failed optimisation must never cost
 * you the document.
 */

const MAX_EDGE = 2000
const QUALITY = 0.82
/** Below this, shrinking is not worth the loss of quality. */
const SKIP_UNDER_BYTES = 400_000

export interface Downscaled {
  file: File
  originalBytes: number
}

export async function prepareForUpload(file: File): Promise<Downscaled> {
  const original = { file, originalBytes: file.size }

  if (!file.type.startsWith('image/')) return original
  if (file.size <= SKIP_UNDER_BYTES) return original
  if (typeof createImageBitmap !== 'function') return original

  try {
    const bitmap = await createImageBitmap(file)
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1

    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return original

    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    // Re-encoding sometimes produces a *larger* file than the original —
    // an already well-compressed JPEG, for instance. Keep whichever is
    // smaller rather than assuming the new one wins.
    if (!blob || blob.size >= file.size) return original

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return {
      file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
      originalBytes: file.size,
    }
  } catch {
    return original
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
