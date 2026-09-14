import { useEffect, useState, type FormEvent } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { parseAmount } from '../lib/money'
import { todayISO } from '../lib/period'
import type { NewTransaction, TxnKind } from '../db/types'

export function TxnForm({ walletId, txnId }: { walletId: string; txnId: string }) {
  const { api, snapshot, refresh } = useDb()
  const wallet = snapshot?.wallets.find((w) => w.id === walletId)
  const isNew = txnId === 'new'
  const [kind, setKind] = useState<TxnKind>('expense')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [otherWallet, setOtherWallet] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(isNew)

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    api.getTransaction(txnId).then((t) => {
      if (cancelled) return
      setKind(t.kind)
      setDate(t.date)
      setAmount((t.amount / 100).toFixed(2))
      setNote(t.note)
      setCategoryId(t.category_id ?? '')
      if (t.kind === 'transfer') {
        setOtherWallet(t.from_wallet_id === walletId ? (t.to_wallet_id ?? '') : (t.from_wallet_id ?? ''))
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [api, isNew, txnId, walletId])

  const cats = (snapshot?.categories ?? []).filter((c) => c.kind === kind && c.hidden === 0)
  const others = (snapshot?.wallets ?? []).filter((w) => w.id !== walletId && w.currency === wallet?.currency)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const minor = parseAmount(amount)
    if (minor === null || minor <= 0) {
      setError('Enter a valid amount.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let payload: NewTransaction =
        kind === 'transfer'
          ? {
              kind,
              date,
              amount: minor,
              note,
              from_wallet_id: walletId,
              to_wallet_id: otherWallet,
            }
          : {
              kind,
              date,
              amount: minor,
              note,
              wallet_id: walletId,
              category_id: categoryId,
            }
      if (!isNew) {
        const existing = await api.getTransaction(txnId)
        if (existing.kind === 'transfer') {
          payload = {
            ...payload,
            from_wallet_id: existing.from_wallet_id === walletId ? walletId : otherWallet,
            to_wallet_id: existing.from_wallet_id === walletId ? otherWallet : walletId,
          }
        }
        await api.updateTransaction(txnId, payload)
      } else {
        await api.createTransaction(payload)
      }
      await refresh()
      go(`/wallets/${walletId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this transaction?')) return
    await api.deleteTransaction(txnId)
    await refresh()
    go(`/wallets/${walletId}`)
  }

  if (!wallet || !loaded) return <p className="muted">Loading…</p>

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="topbar">
        <button type="button" className="icon-btn" onClick={() => go(`/wallets/${walletId}`)}>
          ←
        </button>
        <h2>{isNew ? 'Add' : 'Edit'}</h2>
      </div>
      <div className="tabs">
        {(['expense', 'income', 'transfer'] as TxnKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={kind === k ? 'on' : ''}
            disabled={!isNew && ((kind === 'transfer') !== (k === 'transfer'))}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Amount ({wallet.currency})</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      {kind !== 'transfer' && (
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
      )}
      {kind === 'transfer' && (
        <label className="field">
          <span>To wallet</span>
          <select value={otherWallet} onChange={(e) => setOtherWallet(e.target.value)} required>
            <option value="">Select</option>
            {others.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={busy} type="submit">
        Save
      </button>
      {!isNew && (
        <button type="button" className="danger" onClick={() => void remove()}>
          Delete
        </button>
      )}
    </form>
  )
}
