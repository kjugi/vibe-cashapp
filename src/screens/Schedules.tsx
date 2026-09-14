import { useEffect, useState, type FormEvent } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { parseAmount } from '../lib/money'
import { todayISO } from '../lib/period'
import type { IntervalKind, Schedule, TxnKind } from '../db/types'

export function SchedulesScreen({ id }: { id?: string }) {
  const { api, refresh } = useDb()
  const [items, setItems] = useState<Schedule[]>([])

  useEffect(() => {
    void api.listSchedules().then(setItems)
  }, [api])

  if (id) {
    const existing = id === 'new' ? undefined : items.find((s) => s.id === id)
    if (id !== 'new' && items.length > 0 && !existing) return <p className="muted">Schedule not found.</p>
    if (id !== 'new' && !existing) return <p className="muted">Loading…</p>
    return (
      <ScheduleForm
        existing={existing}
        onDone={async () => {
          await refresh()
          go('/schedules')
        }}
      />
    )
  }

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => go('/settings')}>
          ←
        </button>
        <h2>Scheduled</h2>
      </div>
      {items.map((s) => (
        <button key={s.id} className="card" style={{ textAlign: 'left' }} onClick={() => go(`/schedules/${s.id}`)}>
          <strong>
            {s.kind} · next {s.next_date}
            {s.paused ? ' (paused)' : ''}
          </strong>
          <div className="muted">{s.note || s.interval_kind}</div>
        </button>
      ))}
      {items.length === 0 && <p className="muted">No subscriptions yet.</p>}
      <button className="primary" onClick={() => go('/schedules/new')}>
        New schedule
      </button>
    </div>
  )
}

function ScheduleForm({ existing, onDone }: { existing?: Schedule; onDone: () => Promise<void> }) {
  const { api, snapshot } = useDb()
  const [kind, setKind] = useState<TxnKind>(existing?.kind ?? 'expense')
  const [amount, setAmount] = useState(existing ? (existing.amount / 100).toFixed(2) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [categoryId, setCategoryId] = useState(existing?.category_id ?? '')
  const [walletId, setWalletId] = useState(existing?.wallet_id ?? '')
  const [fromId, setFromId] = useState(existing?.from_wallet_id ?? '')
  const [toId, setToId] = useState(existing?.to_wallet_id ?? '')
  const [interval, setInterval] = useState<IntervalKind>(existing?.interval_kind ?? 'monthly')
  const [days, setDays] = useState(existing?.interval_days ?? 30)
  const [nextDate, setNextDate] = useState(existing?.next_date ?? todayISO())
  const [endDate, setEndDate] = useState(existing?.end_date ?? '')
  const [error, setError] = useState<string | null>(null)

  const cats = (snapshot?.categories ?? []).filter((c) => c.kind === kind && c.hidden === 0)
  const wallets = snapshot?.wallets ?? []

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const amt = parseAmount(amount)
    if (amt === null || amt <= 0) {
      setError('Enter an amount.')
      return
    }
    const input = {
      kind,
      amount: amt,
      note,
      category_id: kind === 'transfer' ? null : categoryId,
      wallet_id: kind === 'transfer' ? null : walletId,
      from_wallet_id: kind === 'transfer' ? fromId : null,
      to_wallet_id: kind === 'transfer' ? toId : null,
      interval_kind: interval,
      interval_days: interval === 'days' ? days : null,
      next_date: nextDate,
      end_date: endDate || null,
    }
    try {
      if (existing) await api.updateSchedule(existing.id, input)
      else await api.createSchedule(input)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function skip() {
    if (!existing) return
    await api.skipSchedule(existing.id)
    await onDone()
  }
  async function pause() {
    if (!existing) return
    await api.pauseSchedule(existing.id, existing.paused === 0)
    await onDone()
  }
  async function remove() {
    if (!existing) return
    if (!confirm('Delete this schedule? Posted transactions stay.')) return
    await api.deleteSchedule(existing.id)
    await onDone()
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="topbar">
        <button type="button" className="icon-btn" onClick={() => go('/schedules')}>
          ←
        </button>
        <h2>{existing ? 'Edit schedule' : 'New schedule'}</h2>
      </div>
      <div className="tabs">
        {(['expense', 'income', 'transfer'] as TxnKind[]).map((k) => (
          <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Amount</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      {kind !== 'transfer' ? (
        <>
          <label className="field">
            <span>Wallet</span>
            <select value={walletId} onChange={(e) => setWalletId(e.target.value)} required>
              <option value="">Select</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              <option value="">Select</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>From</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} required>
              <option value="">Select</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)} required>
              <option value="">Select</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="field">
        <span>Repeat</span>
        <select value={interval} onChange={(e) => setInterval(e.target.value as IntervalKind)}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="days">Every N days</option>
        </select>
      </label>
      {interval === 'days' && (
        <label className="field">
          <span>Days</span>
          <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
      )}
      <label className="field">
        <span>Next date</span>
        <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required />
      </label>
      <label className="field">
        <span>End date (optional)</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="error">{error}</div>}
      <button className="primary" type="submit">
        Save
      </button>
      {existing && (
        <>
          <button type="button" className="ghost" onClick={() => void skip()}>
            Skip next
          </button>
          <button type="button" className="ghost" onClick={() => void pause()}>
            {existing.paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="danger" onClick={() => void remove()}>
            Delete template
          </button>
        </>
      )}
    </form>
  )
}
