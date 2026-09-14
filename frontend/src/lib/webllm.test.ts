import { afterEach, describe, expect, it, vi } from 'vitest'

import { canRun } from './webllm'

/**
 * Whether the phone can run it at all.
 *
 * The only part of this worth testing without a GPU, and the part that
 * matters most: a feature offered on a device that cannot run it is worse
 * than one that was never there, because the cost of finding out is a
 * few hundred megabytes.
 */

function withGpu(gpu: unknown) {
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'gpu')
})

describe('deciding whether to offer it', () => {
  it('says no where there is no WebGPU at all', async () => {
    expect(await canRun()).toBe(false)
  })

  it('says no when the object is there but hands back nothing', async () => {
    // The case that matters: `navigator.gpu` exists in browsers that then
    // refuse an adapter — a software-rendered desktop, an older phone.
    // Checking only for the object would download the weights first and
    // fail afterwards.
    withGpu({ requestAdapter: async () => null })
    expect(await canRun()).toBe(false)
  })

  it('says no when asking throws', async () => {
    withGpu({
      requestAdapter: async () => {
        throw new Error('no')
      },
    })
    expect(await canRun()).toBe(false)
  })

  it('says yes only when an adapter actually comes back', async () => {
    withGpu({ requestAdapter: async () => ({ limits: {} }) })
    expect(await canRun()).toBe(true)
  })

  it('never imports the library just to answer', async () => {
    // 6 MB. Asking the question must not cost anything.
    const spy = vi.fn()
    withGpu({
      requestAdapter: async () => {
        spy()
        return null
      },
    })
    await canRun()
    expect(spy).toHaveBeenCalledOnce()
  })
})
