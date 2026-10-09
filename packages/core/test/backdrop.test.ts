// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createBackdrop, fitResolution, readBackdropState, VEIL_ALPHA } from '../src/backdrop'
import { appStorage } from '../src/storage'

const memStore = () => {
  const m = new Map<string, string>()
  const s = {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
  return appStorage('core', s as Storage)
}

const setViewport = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

afterEach(() => {
  document.documentElement.className = ''
  vi.useRealTimers()
})

describe('fitResolution', () => {
  test('keeps the aspect and caps the longest side', () => {
    expect(fitResolution(1366, 1024)).toEqual({ width: 1280, height: 960 })
    expect(fitResolution(820, 1180)).toEqual({ width: 820, height: 1180 })
    expect(fitResolution(1024, 1366)).toEqual({ width: 960, height: 1280 })
    expect(fitResolution(640, 360)).toEqual({ width: 640, height: 360 })
    expect(fitResolution(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 })
  })
  test('never degenerate', () => {
    expect(fitResolution(0, 0).width).toBeGreaterThanOrEqual(16)
  })
})

describe('createBackdrop', () => {
  test('defaults to a panel and the base resolution; nothing applied at start', () => {
    const setResolution = vi.fn()
    const store = memStore()
    const b = createBackdrop({ store, setResolution, base: { width: 960, height: 540 } })
    expect(b.on).toBe(false)
    expect(b.state).toEqual({ placement: 'panel', veil: 'medium' })
    expect(b.resolution()).toEqual({ width: 960, height: 540 })
    expect(setResolution).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('hi-backdrop')).toBe(false)
    b.dispose()
  })

  test('toggle: root class, screen-shaped resolution, shared preference, back to base', () => {
    setViewport(1180, 820)
    const setResolution = vi.fn()
    const store = memStore()
    const b = createBackdrop({ store, setResolution })
    const seen: string[] = []
    b.subscribe((s) => seen.push(s.placement))
    b.toggle()
    expect(b.on).toBe(true)
    expect(document.documentElement.classList.contains('hi-backdrop')).toBe(true)
    expect(setResolution).toHaveBeenLastCalledWith(1180, 820)
    expect(readBackdropState(store).placement).toBe('backdrop')
    // another editor opening later sees the same preference
    const other = createBackdrop({ store: store, setResolution: vi.fn() })
    expect(other.on).toBe(true)
    expect(other.resolution()).toEqual({ width: 1180, height: 820 })
    other.dispose()
    b.toggle()
    expect(setResolution).toHaveBeenLastCalledWith(960, 540)
    expect(document.documentElement.classList.contains('hi-backdrop')).toBe(false)
    expect(seen).toEqual(['backdrop', 'panel'])
    b.dispose()
  })

  test('veil strength sets the token and cycles', () => {
    const b = createBackdrop({ store: memStore() })
    b.cycleVeil()
    expect(b.state.veil).toBe('strong')
    expect(document.documentElement.style.getPropertyValue('--hi-veil-a')).toBe(String(VEIL_ALPHA.strong))
    b.cycleVeil()
    expect(b.state.veil).toBe('light')
    b.dispose()
  })

  test('re-fits on resize while on (debounced), ignores resize as a panel', () => {
    vi.useFakeTimers()
    setViewport(1366, 1024)
    const setResolution = vi.fn()
    const b = createBackdrop({ store: memStore(), setResolution })
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    expect(setResolution).not.toHaveBeenCalled()
    b.setPlacement('backdrop')
    expect(setResolution).toHaveBeenLastCalledWith(1280, 960)
    setViewport(1024, 1366)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    expect(setResolution).toHaveBeenLastCalledWith(960, 1280)
    // refresh() re-applies even when unchanged (a restarted runtime starts at its own size)
    setResolution.mockClear()
    b.refresh()
    expect(setResolution).toHaveBeenCalledWith(960, 1280)
    b.dispose()
  })

  test('a throwing or rejecting setResolution does not break toggling', async () => {
    const b = createBackdrop({ store: memStore(), setResolution: () => Promise.reject(new Error('not ready')) })
    b.toggle()
    const c = createBackdrop({
      store: memStore(),
      setResolution: () => {
        throw new Error('no runtime')
      },
    })
    c.toggle()
    expect(b.on && c.on).toBe(true)
    b.dispose()
    c.dispose()
  })
})
