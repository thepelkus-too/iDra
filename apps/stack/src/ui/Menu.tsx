import { closePopover, openPopover } from '../overlay'

export interface MenuItem {
  label: string
  run: () => void
  danger?: boolean
  disabled?: boolean
  hint?: string
  testid?: string
  /** a thin divider before this item */
  sep?: boolean
}

export function MenuList({ items, title }: { items: MenuItem[]; title?: string }) {
  return (
    <div class="menu" role="menu" data-testid="menu">
      {title && <div class="menu-title">{title}</div>}
      {items.map((it, i) => (
        <>
          {it.sep && <div class="sep" />}
          <button
            type="button"
            role="menuitem"
            key={i}
            class={`item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            data-testid={it.testid}
            onClick={() => {
              closePopover()
              it.run()
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        </>
      ))}
    </div>
  )
}

export function openMenu(anchor: Element, items: MenuItem[], title?: string, width = 260): void {
  openPopover(anchor, () => <MenuList items={items} title={title} />, { width, label: title ?? 'menu' })
}
