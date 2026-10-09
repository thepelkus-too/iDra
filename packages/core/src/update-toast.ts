import { getLibrary } from './library'
import { h, injectStyles, TOKENS_CSS } from './ui'

// "Update available, reload": the new service worker installs in the background and WAITS. We never reload on our own:
// the toast only appears, and the reload happens when the user taps it (after the library is flushed), so nothing is lost mid-edit.

const CSS = `${TOKENS_CSS}
.hi-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;display:flex;gap:12px;align-items:center;padding:10px 14px;background:var(--hi-panel);color:var(--hi-text);border:1px solid var(--hi-accent);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.4);font:14px system-ui,-apple-system,sans-serif}
.hi-toast button{min-height:40px;padding:0 14px;border-radius:8px;border:0;background:var(--hi-accent);color:#042;font:inherit;font-weight:600}
.hi-toast button.quiet{background:transparent;color:var(--hi-dim)}
`

export interface UpdateToastHandle {
  destroy(): void
  /** test hook: pretend an update is waiting */
  show(): void
}

export function mountUpdateToast(opts: { onBeforeReload?: () => Promise<void> | void } = {}): UpdateToastHandle {
  injectStyles('update-toast', CSS)
  let toast: HTMLElement | undefined
  let waiting: ServiceWorker | null = null
  let reloading = false
  const show = () => {
    if (toast) return
    toast = h(
      'div',
      { class: 'hi-toast', role: 'status' },
      'Update available.',
      h('button', {
        type: 'button',
        onclick: async () => {
          try {
            await (opts.onBeforeReload ? opts.onBeforeReload() : getLibrary().flush())
          } catch {
            /* reload anyway */
          }
          reloading = true
          if (waiting) waiting.postMessage('skipWaiting')
          else location.reload()
        },
      }, 'Reload'),
      h('button', { class: 'quiet', type: 'button', onclick: () => (toast?.remove(), (toast = undefined)) }, 'Later'),
    )
    document.body.appendChild(toast)
  }
  const track = (reg: ServiceWorkerRegistration) => {
    const check = () => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting
        show()
      }
    }
    check()
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed') check()
      })
    })
  }
  let cleanup = () => {}
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => reg && track(reg)).catch(() => {})
    const onChange = () => {
      if (reloading) location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    cleanup = () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }
  return {
    show,
    destroy() {
      cleanup()
      toast?.remove()
    },
  }
}
