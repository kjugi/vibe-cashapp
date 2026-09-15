import { useState, type FormEvent } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { parseAmount } from '../lib/money'
import { todayISO } from '../lib/period'

const CURRENCIES = ['PLN', 'CZK', 'EUR', 'USD', 'GBP', 'HUF', 'CHF']

export function WalletForm({ id }: { id: string }) {
  const { api, snapshot, refresh } = useDb()
  const existing = id !== 'new' ? snapshot?.wallets.find((w) => w.id === id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? 'PLN')
  const [opening, setOpening] = useState('')
  const [openingDate, setOpeningDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (existing) {
        await api.updateWallet(existing.id, name, currency)
        await refresh()
        go(`/wallets/${existing.id}`)
      } else {
        const amt = opening.trim() ? parseAmount(opening) : 0
        if (opening.trim() && (amt === null || amt < 0)) throw new Error('Opening amount is invalid.')
        const wallet = await api.createWallet({
          name,
          currency,
          openingAmount: amt || undefined,
          openingDate,
        })
        await refresh()
        go(`/wallets/${wallet.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!existing) return
    if (!confirm('Hide this wallet from the list? Transactions stay in the file.')) return
    await api.archiveWallet(existing.id)
    await refresh()
    go('/')
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="topbar">
        <button type="button" className="icon-btn" onClick={() => history.back()}>
          ←
        </button>
        <h2>{existing ? 'Edit wallet' : 'New wallet'}</h2>
      </div>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Checking" />
      </label>
      <label className="field">
        <span>Currency</span>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {!existing && (
        <>
          <label className="field">
            <span>Opening balance (optional)</span>
            <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          </label>
          <label className="field">
            <span>Opening date</span>
            <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </label>
        </>
      )}
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={busy} type="submit">
        Save
      </button>
      {existing && (
        <button type="button" className="danger" onClick={() => void archive()}>
          Archive wallet
        </button>
      )}
    </form>
  )
}
