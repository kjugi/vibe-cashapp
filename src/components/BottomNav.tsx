export function BottomNav<T extends string>({
  label,
  current,
  onChange,
  items,
}: {
  label: string
  current: T
  onChange: (id: T) => void
  items: { id: T; icon: string; label: string }[]
}) {
  return (
    <nav className="bottom-nav" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" className={current === item.id ? 'on' : ''} onClick={() => onChange(item.id)}>
          <span aria-hidden>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
