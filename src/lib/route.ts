export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'categories' }
  | { name: 'schedules' }
  | { name: 'schedule-edit'; id: string | 'new' }
  | { name: 'wallet'; id: string }
  | { name: 'wallet-edit'; id: string | 'new' }
  | { name: 'txn-edit'; walletId: string; txnId: string | 'new' }
  | { name: 'budgets'; walletId: string }
  | { name: 'budget-edit'; walletId: string; budgetId: string | 'new' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'home' }
  if (parts[0] === 'settings') return { name: 'settings' }
  if (parts[0] === 'categories') return { name: 'categories' }
  if (parts[0] === 'schedules' && parts[1] === 'new') return { name: 'schedule-edit', id: 'new' }
  if (parts[0] === 'schedules' && parts[1]) return { name: 'schedule-edit', id: parts[1] }
  if (parts[0] === 'schedules') return { name: 'schedules' }
  if (parts[0] === 'wallets' && parts[1] === 'new') return { name: 'wallet-edit', id: 'new' }
  if (parts[0] === 'wallets' && parts[1]) {
    const id = parts[1]
    if (parts[2] === 'edit') return { name: 'wallet-edit', id }
    if (parts[2] === 'tx' && parts[3]) return { name: 'txn-edit', walletId: id, txnId: parts[3] }
    if (parts[2] === 'tx') return { name: 'txn-edit', walletId: id, txnId: 'new' }
    if (parts[2] === 'budgets' && parts[3] === 'new') return { name: 'budget-edit', walletId: id, budgetId: 'new' }
    if (parts[2] === 'budgets' && parts[3]) return { name: 'budget-edit', walletId: id, budgetId: parts[3] }
    if (parts[2] === 'budgets') return { name: 'budgets', walletId: id }
    return { name: 'wallet', id }
  }
  return { name: 'home' }
}

export function go(path: string): void {
  const next = path.startsWith('#') ? path : `#${path}`
  if (location.hash === next || (next === '#/' && (location.hash === '' || location.hash === '#'))) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  location.hash = path.startsWith('#') ? path.slice(1) : path
}

export function backHome(): void {
  go('/')
}
