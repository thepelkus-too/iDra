// jsdom has no canvas and no layout: give the pieces our components touch harmless stand-ins.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {}
  const c: any = new Proxy({ canvas: null }, { get: (t: any, k) => (k in t ? t[k] : noop), set: (t: any, k, v) => ((t[k] = v), true) })
  ;(HTMLCanvasElement.prototype as any).getContext = () => c
  ;(HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/jpeg;base64,AAAA'
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0)
  ;(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
}
