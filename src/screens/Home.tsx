import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { formatAmount } from '../lib/money'
import { periodContaining, todayISO } from '../lib/period'
import { Pie } from '../components/Pie'
import { WalletForm } from './WalletForm'
import { useEffect, useMemo, useState } from 'react'
import type { Wallet } from '../db/types'

type WalletBalance = { running: number; flow: number }

function wealthByCurrency(wallets: Wallet[], balances: Record<string, WalletBalance>) {
  const groups = new Map<string, { currency: string; total: number; slices: { key: string; label: string; amount: number }[] }>()
  for (const w of wallets) {
    const running = balances[w.id]?.running ?? 0
    let group = groups.get(w.currency)
    if (!group) {
      group = { currency: w.currency, total: 0, slices: [] }
      groups.set(w.currency, group)
    }
    group.total += running
    if (running > 0) group.slices.push({ key: w.id, label: w.name, amount: running })
  }
  for (const group of groups.values()) {
    group.slices.sort((a, b) => b.amount - a.amount)
  }
  return [...groups.values()]
}

export function Home({ creating }: { creating?: boolean }) {
  const { api, snapshot } = useDb()
  const [balances, setBalances] = useState<Record<string, WalletBalance>>({})
  const [view, setView] = useState<'list' | 'wealth'>('list')

  useEffect(() => {
    if (!snapshot) return
    const startDay = snapshot.cashFlowStartDay
    const { start, end } = periodContaining(todayISO(), startDay)
    let cancelled = false
    ;(async () => {
      const next: Record<string, WalletBalance> = {}
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

  const wealth = useMemo(
    () => (snapshot ? wealthByCurrency(snapshot.wallets, balances) : []),
    [snapshot, balances],
  )
  const balancesReady = Boolean(snapshot && snapshot.wallets.every((w) => balances[w.id]))

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
      {snapshot && snapshot.wallets.length > 0 && (
        <div className="tabs">
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            Wallets
          </button>
          <button type="button" className={view === 'wealth' ? 'on' : ''} onClick={() => setView('wealth')}>
            Wealth
          </button>
        </div>
      )}
      {view === 'list' &&
        snapshot?.wallets.map((w) => {
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
      {view === 'wealth' && snapshot && snapshot.wallets.length > 0 && (
        <>
          {!balancesReady && <p className="muted">Loading…</p>}
          {balancesReady &&
            wealth.map((group) => (
              <div key={group.currency} className="card">
                <div className="hero">
                  <div className="label">{wealth.length === 1 ? 'Total wealth' : `Total wealth · ${group.currency}`}</div>
                  <div className={`amount ${group.total < 0 ? 'neg' : group.total > 0 ? 'pos' : ''}`}>
                    {formatAmount(group.total, group.currency, locale)}
                  </div>
                </div>
                <Pie
                  slices={group.slices}
                  empty="No positive balances to chart."
                  format={(amount, share) =>
                    `${formatAmount(amount, group.currency, locale)} · ${Math.round(share * 100)}%`
                  }
                  onSelect={(id) => go(`/wallets/${id}`)}
                />
              </div>
            ))}
        </>
      )}
      {snapshot && snapshot.wallets.length > 0 && (
        <button className="primary" onClick={() => go('/wallets/new')}>
          Add wallet
        </button>
      )}
    </div>
  )
}
