/**
 * The language model, running on the phone.
 *
 * Free in the sense that matters here: no key, no account, no card, and
 * nothing leaves the device. That last part is why it is this and not a
 * hosted API — the whole app proxies its geocoding through your own
 * server rather than hand a third party "ryokan kyoto onsen" with your
 * address attached, and posting your itinerary to someone's free tier
 * would walk straight past that.
 *
 * Everything here is optional and lazy. The library is 13 MB on disk and
 * the weights are a few hundred more, so nothing is imported until you
 * ask, and the feature is hidden outright where WebGPU is missing rather
 * than offered and then failing. After the first download the weights sit
 * in the browser's cache, so it works with no signal — like the rest of
 * the app.
 */

/** Small enough for a phone, good enough to sort a list by a sentence. */
export const MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'

export interface Progress {
  /** 0–1 while the weights download; null once it is answering. */
  fraction: number | null
  text: string
}

/**
 * Whether this device can run it at all.
 *
 * Asked before anything is offered, and answered by requesting an adapter
 * rather than by looking for `navigator.gpu`: the object exists in
 * browsers that then hand back nothing, which is exactly the case that
 * would otherwise download half a gigabyte before failing.
 */
export async function canRun(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

/** What this module needs from the engine, and nothing more. */
interface Engine {
  chat: { completions: { create: (options: unknown) => Promise<unknown> } }
}

/** The one engine, kept between asks so the weights load once. */
let engine: Engine | null = null

export async function ask(
  prompt: string,
  onProgress: (progress: Progress) => void,
): Promise<string> {
  if (!engine) {
    const webllm = await import('@mlc-ai/web-llm')
    engine = (await webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (report) =>
        onProgress({ fraction: report.progress, text: report.text }),
    })) as unknown as Engine
  }

  onProgress({ fraction: null, text: '' })
  const reply = (await engine!.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    // Ranking is not a creative task, and a small model wanders when
    // allowed to. Deterministic also means the same list twice.
    temperature: 0,
    max_tokens: 1024,
  })) as { choices?: { message?: { content?: string } }[] }

  return reply.choices?.[0]?.message?.content ?? ''
}
