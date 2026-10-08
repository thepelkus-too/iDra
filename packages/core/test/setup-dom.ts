// jsdom has no canvas: give HTMLCanvasElement a harmless 2d context so audio meters / thumbnails do not log "not implemented".
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {}
  const ctx: any = new Proxy({ canvas: null }, { get: (t: any, k) => (k in t ? t[k] : noop), set: (t: any, k, v) => ((t[k] = v), true) })
  ;(HTMLCanvasElement.prototype as any).getContext = function () {
    return ctx
  }
  ;(HTMLCanvasElement.prototype as any).toDataURL = function () {
    return 'data:image/jpeg;base64,AAAA'
  }
}
