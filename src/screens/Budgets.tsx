import { useEffect, useState, type FormEvent } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { parseAmount } from '../lib/money'
import type { Budget } from '../db/types'

export function BudgetsScreen({ walletId, budgetId }: { walletId: string; budgetId?: string }) {
  const { api, refresh } = useDb()
  const [budgets, setBudgets] = useState<Budget[] | null>(null)
  const editing = budgetId !== undefined
  const existing = budgetId && budgetId !== 'new' ? budgets?.find((b) => b.id === budgetId) : undefined

  useEffect(() => {
    void api.listBudgets(walletId).then(setBudgets)
  }, [api, walletId])

  if (editing) {
    if (budgetId !== 'new' && budgets === null) return <p className="muted">Loading…</p>
    if (budgetId !== 'new' && !existing) return <p className="muted">Budget not found.</p>
    return (
      <BudgetForm
        walletId={walletId}
        existing={existing}
        isNew={budgetId === 'new'}
        onDone={async () => {
          await refresh()
          go(`/wallets/${walletId}/budgets`)
        }}
      />
    )
  }

  if (budgets === null) return <p className="muted">Loading…</p>

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => go(`/wallets/${walletId}`)}>
          ←
        </button>
        <h2>Budgets</h2>
      </div>
      {budgets.map((b) => (
        <button key={b.id} className="card" style={{ textAlign: 'left' }} onClick={() => go(`/wallets/${walletId}/budgets/${b.id}`)}>
          <strong>{b.name}</strong>
          <div className="muted">Rolls on day {b.roll_day}</div>
        </button>
      ))}
      {budgets.length === 0 && <p className="muted">No budgets yet.</p>}
      <button className="primary" onClick={() => go(`/wallets/${walletId}/budgets/new`)}>
        New budget
      </button>
    </div>
  )
}

function BudgetForm({
  walletId,
  existing,
  isNew,
  onDone,
}: {
  walletId: string
  existing?: Budget
  isNew: boolean
  onDone: () => Promise<void>
}) {
  const { api, snapshot } = useDb()
  const [name, setName] = useState(existing?.name ?? '')
  const [limit, setLimit] = useState(existing ? (existing.limit_amount / 100).toFixed(2) : '')
  const [rollDay, setRollDay] = useState(existing?.roll_day ?? 1)
  const [cats, setCats] = useState<string[]>(existing?.category_ids ?? [])
  const [error, setError] = useState<string | null>(null)

  const expenses = (snapshot?.categories ?? []).filter((c) => c.kind === 'expense' && (c.hidden === 0 || cats.includes(c.id)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const amt = parseAmount(limit)
    if (amt === null || amt <= 0) {
      setError('Enter a limit.')
      return
    }
    try {
      const input = { wallet_id: walletId, name, limit_amount: amt, roll_day: rollDay, category_ids: cats }
      if (isNew) await api.createBudget(input)
      else if (existing) await api.updateBudget(existing.id, input)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function archive() {
    if (!existing) return
    if (!confirm('Archive this budget?')) return
    await api.archiveBudget(existing.id)
    await onDone()
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="topbar">
        <button type="button" className="icon-btn" onClick={() => go(`/wallets/${walletId}/budgets`)}>
          ←
        </button>
        <h2>{isNew ? 'New budget' : 'Edit budget'}</h2>
      </div>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Groceries" />
      </label>
      <label className="field">
        <span>Monthly limit</span>
        <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} required />
      </label>
      <label className="field">
        <span>Period starts on day</span>
        <input
          type="number"
          min={1}
          max={28}
          value={rollDay}
          onChange={(e) => setRollDay(Number(e.target.value))}
        />
      </label>
      <div className="field">
        <span>Expense categories</span>
        <div className="checks">
          {expenses.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={cats.includes(c.id)}
                onChange={(e) =>
                  setCats(e.target.checked ? [...cats, c.id] : cats.filter((id) => id !== c.id))
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <button className="primary" type="submit">
        Save
      </button>
      {!isNew && (
        <button type="button" className="danger" onClick={() => void archive()}>
          Archive
        </button>
      )}
    </form>
  )
}
