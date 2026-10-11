// "Open in Hydra": a link to the plain Hydra editor with the sketch's code in it, to check a sketch still runs there.
// hydra.ojack.xyz reads `?code=` on load and runs it (hydra repo, src/stores/gallery.js: setSketchFromURL and
// decodeBase64 = decodeURIComponent(atob(code))), so the link carries btoa(encodeURIComponent(code)), escaped once more
// for the query string because base64 has `+`, `/` and `=`.

export const HYDRA_EDITOR = 'https://hydra.ojack.xyz/'

/**
 * Longest link we hand out. The code travels in the query string, so it reaches hydra.ojack.xyz's host (GitHub Pages),
 * and hosts commonly refuse request lines past about 8 KB; Safari itself takes far longer URLs. A self-contained sketch
 * (hydra-motion inlined, about 7 KB of source) does not fit, so callers fall back to the loadScript version.
 */
export const MAX_HYDRA_URL = 8000

export function hydraUrl(code: string): string {
  return `${HYDRA_EDITOR}?code=${encodeURIComponent(btoa(encodeURIComponent(code)))}`
}

/** The first candidate whose link fits, in order of preference; undefined when none does. */
export function firstFittingHydraUrl(codes: string[]): string | undefined {
  for (const code of codes) {
    const url = hydraUrl(code)
    if (url.length <= MAX_HYDRA_URL) return url
  }
  return undefined
}
