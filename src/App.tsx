import { useEffect, useState, type ReactNode } from 'react'
import { DbProvider, useDb } from './state/DbContext'
import { parseHash, type Route } from './lib/route'
import { Home } from './screens/Home'
import { WalletScreen } from './screens/Wallet'
import { TxnForm } from './screens/TxnForm'
import { BudgetsScreen } from './screens/Budgets'
import { CategoriesScreen } from './screens/Categories'
import { SchedulesScreen } from './screens/Schedules'
import { SettingsScreen } from './screens/Settings'

function Router() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const { ready, error } = useDb()
  if (error) {
    return (
      <div className="shell">
        <div className="error">{error}</div>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="shell">
        <p className="muted">Opening ledger…</p>
      </div>
    )
  }

  let page: ReactNode
  switch (route.name) {
    case 'home':
      page = <Home />
      break
    case 'wallet-edit':
      page = route.id === 'new' ? <Home creating /> : <WalletScreen id={route.id} editing />
      break
    case 'wallet':
      page = <WalletScreen id={route.id} />
      break
    case 'txn-edit':
      page = <TxnForm walletId={route.walletId} txnId={route.txnId} />
      break
    case 'budgets':
      page = <BudgetsScreen walletId={route.walletId} />
      break
    case 'budget-edit':
      page = <BudgetsScreen walletId={route.walletId} budgetId={route.budgetId} />
      break
    case 'categories':
      page = <CategoriesScreen />
      break
    case 'schedules':
      page = <SchedulesScreen />
      break
    case 'schedule-edit':
      page = <SchedulesScreen id={route.id} />
      break
    case 'settings':
      page = <SettingsScreen />
      break
  }

  return <div className="shell">{page}</div>
}

export default function App() {
  return (
    <DbProvider>
      <Router />
    </DbProvider>
  )
}
