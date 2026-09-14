const PALETTE = ['#1c6b45', '#9f2d24', '#243044', '#c47b17', '#3d5a80', '#6b4f3a', '#2a6f97', '#7a4419']

export function Pie({
  slices,
}: {
  slices: { key: string; label: string; amount: number }[]
}) {
  const total = slices.reduce((s, x) => s + x.amount, 0)
  if (total <= 0) {
    return <p className="muted">No outflows in this month.</p>
  }
  const r = 42
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="stack">
      <svg viewBox="0 0 120 120" width="160" height="160" style={{ margin: '0 auto' }} aria-hidden>
        <g transform="rotate(-90 60 60)">
          {slices.map((slice, i) => {
            const len = (slice.amount / total) * c
            const gap = 1.2
            const dash = `${Math.max(len - gap, 0)} ${c}`
            const el = (
              <circle
                key={slice.key}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={slice.key === 'transfer' ? '#5c6b73' : PALETTE[i % PALETTE.length]}
                strokeWidth="16"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return el
          })}
        </g>
      </svg>
      <div className="legend">
        {slices.map((slice, i) => (
          <div key={slice.key}>
            <span
              className="swatch"
              style={{ background: slice.key === 'transfer' ? '#5c6b73' : PALETTE[i % PALETTE.length] }}
            />
            {slice.label}
          </div>
        ))}
      </div>
    </div>
  )
}
