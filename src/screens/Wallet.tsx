import { useEffect, useState } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { formatAmount, formatSigned } from '../lib/money'
import { periodContaining, periodLabel, shiftPeriod, todayISO } from '../lib/period'
import type { WalletMonth } from '../db/types'
import { Pie } from '../components/Pie'
import { WalletForm } from './WalletForm'

export function WalletScreen({ id, editing }: { id: string; editing?: boolean }) {
  const { api, snapshot } = useDb()
  const startDay = snapshot?.cashFlowStartDay ?? 1
  const [period, setPeriod] = useState(() => periodContaining(todayISO(), startDay))
  const [data, setData] = useState<WalletMonth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locale = navigator.language

  useEffect(() => {
    setPeriod(periodContaining(todayISO(), startDay))
  }, [startDay])

  useEffect(() => {
    let cancelled = false
    api
      .walletMonth(id, period.start, period.end, todayISO())
      .then((month) => {
        if (!cancelled) setData(month)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [api, id, period.start, period.end])

  if (editing) return <WalletForm id={id} />
  if (error) return <div className="error">{error}</div>
  if (!data) return <p className="muted">Loading…</p>

  const { wallet } = data
  const signFlow = data.cashFlow

  return (
    <div>
      <div className="topbar">
        <button className="icon-btn" onClick={() => go('/')}>
          ←
        </button>
        <h2>{wallet.name}</h2>
        <button className="ghost" onClick={() => go(`/wallets/${id}/edit`)}>
          Edit
        </button>
      </div>

      <div className="monthbar">
        <button className="icon-btn" onClick={() => setPeriod(shiftPeriod(period, -1, startDay))}>
          ‹
        </button>
        <strong>{periodLabel(period, locale)}</strong>
        <button className="icon-btn" onClick={() => setPeriod(shiftPeriod(period, 1, startDay))}>
          ›
        </button>
      </div>

      <div className="card hero">
        <div className="label">Monthly cash flow</div>
        <div className={`amount ${signFlow < 0 ? 'neg' : 'pos'}`}>
          {formatSigned(signFlow, wallet.currency, locale)}
        </div>
        <div className="substats">
          <div>
            <div className="label">Running balance</div>
            <div className="amount">{formatAmount(data.runningBalance, wallet.currency, locale)}</div>
          </div>
          <div>
            <div className="label">{wallet.currency}</div>
            <div className="muted">
              {period.start} → {period.end}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Outflows</h3>
        <Pie slices={data.pie} />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="wallet-row">
          <h3 style={{ margin: 0 }}>Budgets</h3>
          <button className="ghost" onClick={() => go(`/wallets/${id}/budgets`)}>
            Manage
          </button>
        </div>
        {data.budgets.length === 0 && <p className="muted">No budgets on this wallet.</p>}
        {data.budgets.map((b) => {
          const pct = b.limit_amount === 0 ? 0 : Math.min(100, Math.round((b.spent / b.limit_amount) * 100))
          const over = b.spent > b.limit_amount
          return (
            <div key={b.id} style={{ marginTop: 12 }}>
              <div className="wallet-row">
                <strong>{b.name}</strong>
                <span className={over ? 'neg' : ''}>
                  {formatAmount(b.spent, wallet.currency, locale)} /{' '}
                  {formatAmount(b.limit_amount, wallet.currency, locale)}
                </span>
              </div>
              <div className={`bar ${over ? 'over' : ''}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                {b.periodStart} → {b.periodEnd} · day {b.roll_day}
              </div>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>This month</h3>
        {data.transactions.length === 0 && <p className="muted">No transactions in this month.</p>}
        {data.transactions.map((t) => {
          const wallets = snapshot?.wallets ?? []
          const from = wallets.find((w) => w.id === t.from_wallet_id)?.name
          const to = wallets.find((w) => w.id === t.to_wallet_id)?.name
          const cat = snapshot?.categories.find((c) => c.id === t.category_id)?.name
          let label = cat ?? t.kind
          let signed = t.kind === 'income' ? t.amount : -t.amount
          if (t.kind === 'transfer') {
            if (t.from_wallet_id === id) {
              label = `Transfer to ${to ?? 'wallet'}`
              signed = -t.amount
            } else {
              label = `Transfer from ${from ?? 'wallet'}`
              signed = t.amount
            }
          }
          return (
            <button
              key={t.id}
              className="txn"
              style={{ width: '100%', background: 'transparent', borderLeft: 0, borderRight: 0, borderBottom: 0, textAlign: 'left' }}
              onClick={() => go(`/wallets/${id}/tx/${t.id}`)}
            >
              <div>
                <strong>
                  {label}
                  {t.unpaired_import === 1 && <span className="badge">unpaired import</span>}
                </strong>
                <div className="muted">
                  {t.date}
                  {t.note ? ` · ${t.note}` : ''}
                </div>
              </div>
              <div className={`amount ${signed < 0 ? 'neg' : 'pos'}`}>
                {formatSigned(signed, wallet.currency, locale)}
              </div>
            </button>
          )
        })}
      </div>

      <div className="fab">
        <button className="primary" onClick={() => go(`/wallets/${id}/tx/new`)}>
          Add transaction
        </button>
      </div>
    </div>
  )
}
