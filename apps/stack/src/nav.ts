// Scrolling to and flashing a statement or call (the tap on a variable chip, the code ↔ blocks selection).
export function focusNode(id: string, opts: { flash?: boolean } = {}): void {
  const el = document.querySelector<HTMLElement>(`[data-stmt="${CSS.escape(id)}"], [data-call="${CSS.escape(id)}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (opts.flash === false) return
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 1100)
}
