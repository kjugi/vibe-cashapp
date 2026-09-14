import { useState, type FormEvent } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import type { CategoryKind } from '../db/types'

export function CategoriesScreen() {
  const { api, snapshot, refresh } = useDb()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    try {
      await api.createCategory(name, kind)
      setName('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const groups: CategoryKind[] = ['expense', 'income']

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => go('/settings')}>
          ←
        </button>
        <h2>Categories</h2>
      </div>
      <form className="card stack" onSubmit={add}>
        <label className="field">
          <span>New category</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="tabs">
          {groups.map((k) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">
          Add
        </button>
      </form>
      {groups.map((k) => (
        <div key={k} className="card">
          <h3 style={{ textTransform: 'capitalize', marginTop: 0 }}>{k}</h3>
          {(snapshot?.categories ?? [])
            .filter((c) => c.kind === k)
            .map((c) => (
              <div key={c.id} className="wallet-row" style={{ padding: '8px 0' }}>
                <span className={c.hidden ? 'muted' : ''}>{c.name}</span>
                <button
                  className="ghost"
                  onClick={() => void api.hideCategory(c.id, c.hidden === 0).then(refresh)}
                >
                  {c.hidden ? 'Show' : 'Hide'}
                </button>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
