import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { formatAmount } from '../lib/money'
import { periodContaining, todayISO } from '../lib/period'
import { WalletForm } from './WalletForm'
import { useEffect, useState } from 'react'

export function Home({ creating }: { creating?: boolean }) {
  const { api, snapshot } = useDb()
  const [balances, setBalances] = useState<Record<string, { running: number; flow: number }>>({})

  useEffect(() => {
    if (!snapshot) return
    const startDay = snapshot.cashFlowStartDay
    const { start, end } = periodContaining(todayISO(), startDay)
    let cancelled = false
    ;(async () => {
      const next: Record<string, { running: number; flow: number }> = {}
      for (const w of snapshot.wallets) {
        const month = await api.walletMonth(w.id, start, end, todayISO())
        next[w.id] = { running: month.runningBalance, flow: month.cashFlow }
      }
      if (!cancelled) setBalances(next)
    })()
    return () => {
      cancelled = true
    }
  }, [api, snapshot])

  if (creating) return <WalletForm id="new" />
  const locale = navigator.language
  const stale =
    snapshot &&
    snapshot.wallets.length > 0 &&
    (!snapshot.lastExportAt || Date.now() - Date.parse(snapshot.lastExportAt) > 7 * 24 * 60 * 60 * 1000)

  return (
    <div className="stack">
      <div className="topbar">
        <div className="brand">
          <small>Offline ledger</small>
          <h1>Cashbook</h1>
        </div>
        <button className="icon-btn" onClick={() => go('/settings')} aria-label="Settings">
          ⚙
        </button>
      </div>
      {stale && (
        <div className="banner">
          Export a backup from Settings. iPhone can still throw this working copy away.
        </div>
      )}
      {snapshot?.wallets.length === 0 && (
        <div className="card empty">
          <h2>No wallets yet</h2>
          <p>This file lives on this phone. Create a wallet, or bring history in.</p>
          <div className="stack">
            <button className="primary" onClick={() => go('/wallets/new')}>
              Create wallet
            </button>
            <button className="ghost" onClick={() => go('/settings')}>
              Import Spendee CSV
            </button>
            <button className="ghost" onClick={() => go('/settings')}>
              Import SQLite backup
            </button>
          </div>
        </div>
      )}
      {snapshot?.wallets.map((w) => {
        const b = balances[w.id]
        return (
          <button
            key={w.id}
            className="card"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => go(`/wallets/${w.id}`)}
          >
            <div className="wallet-row">
              <div>
                <h3>{w.name}</h3>
                <div className="muted">{w.currency}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="amount">{b ? formatAmount(b.running, w.currency, locale) : '…'}</div>
                <div className={`muted amount ${b && b.flow < 0 ? 'neg' : b && b.flow > 0 ? 'pos' : ''}`}>
                  {b ? `this month ${formatAmount(b.flow, w.currency, locale)}` : ''}
                </div>
              </div>
            </div>
          </button>
        )
      })}
      {snapshot && snapshot.wallets.length > 0 && (
        <button className="primary" onClick={() => go('/wallets/new')}>
          Add wallet
        </button>
      )}
    </div>
  )
}
