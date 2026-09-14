export type TxnKind = 'income' | 'expense' | 'transfer'
export type CategoryKind = 'income' | 'expense'
export type IntervalKind = 'monthly' | 'yearly' | 'days'

export type Wallet = {
  id: string
  name: string
  currency: string
  archived: number
  created_at: string
}

export type Category = {
  id: string
  name: string
  kind: CategoryKind
  is_default: number
  hidden: number
  created_at: string
}

export type Transaction = {
  id: string
  kind: TxnKind
  date: string
  amount: number
  note: string
  category_id: string | null
  wallet_id: string | null
  from_wallet_id: string | null
  to_wallet_id: string | null
  schedule_id: string | null
  is_opening: number
  unpaired_import: number
  created_at: string
}

export type Budget = {
  id: string
  wallet_id: string
  name: string
  limit_amount: number
  roll_day: number
  archived: number
  created_at: string
  category_ids: string[]
}

export type Schedule = {
  id: string
  kind: TxnKind
  amount: number
  note: string
  category_id: string | null
  wallet_id: string | null
  from_wallet_id: string | null
  to_wallet_id: string | null
  interval_kind: IntervalKind
  interval_days: number | null
  next_date: string
  end_date: string | null
  paused: number
  created_at: string
}

export type WalletMonth = {
  wallet: Wallet
  runningBalance: number
  cashFlow: number
  pie: { key: string; label: string; amount: number }[]
  transactions: Transaction[]
  budgets: (Budget & { spent: number; periodStart: string; periodEnd: string })[]
}

export type NewWallet = {
  name: string
  currency: string
  openingAmount?: number
  openingDate?: string
}

export type NewTransaction = {
  kind: TxnKind
  date: string
  amount: number
  note: string
  category_id?: string | null
  wallet_id?: string | null
  from_wallet_id?: string | null
  to_wallet_id?: string | null
  is_opening?: boolean
}

export type NewBudget = {
  wallet_id: string
  name: string
  limit_amount: number
  roll_day: number
  category_ids: string[]
}

export type NewSchedule = {
  kind: TxnKind
  amount: number
  note: string
  category_id?: string | null
  wallet_id?: string | null
  from_wallet_id?: string | null
  to_wallet_id?: string | null
  interval_kind: IntervalKind
  interval_days?: number | null
  next_date: string
  end_date?: string | null
}

export type DbSnapshot = {
  wallets: Wallet[]
  categories: Category[]
  cashFlowStartDay: number
  lastExportAt: string | null
  persistGranted: boolean
}
