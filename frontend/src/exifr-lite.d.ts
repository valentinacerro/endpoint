/**
 * exifr ships types for its main entry point but not for the individual
 * bundles, and the bundle is the point: the lite build is a third of the
 * full one and this app only ever needs GPS and a timestamp.
 *
 * Declared as narrowly as it is used, so the shape is checked at the one
 * place that touches the library rather than being `any` everywhere.
 */
declare module 'exifr/dist/lite.esm.mjs' {
  const exifr: {
    parse(
      input: File | Uint8Array,
      options: Record<string, unknown>,
    ): Promise<Record<string, unknown> | undefined>
  }
  export default exifr
}
