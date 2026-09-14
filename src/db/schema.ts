export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  is_default INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  category_id TEXT,
  wallet_id TEXT,
  from_wallet_id TEXT,
  to_wallet_id TEXT,
  schedule_id TEXT,
  is_opening INTEGER NOT NULL DEFAULT 0,
  unpaired_import INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  FOREIGN KEY (from_wallet_id) REFERENCES wallets(id),
  FOREIGN KEY (to_wallet_id) REFERENCES wallets(id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  name TEXT NOT NULL,
  limit_amount INTEGER NOT NULL,
  roll_day INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

CREATE TABLE IF NOT EXISTS budget_categories (
  budget_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (budget_id, category_id),
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  category_id TEXT,
  wallet_id TEXT,
  from_wallet_id TEXT,
  to_wallet_id TEXT,
  interval_kind TEXT NOT NULL CHECK (interval_kind IN ('monthly', 'yearly', 'days')),
  interval_days INTEGER,
  next_date TEXT NOT NULL,
  end_date TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_txn_from ON transactions(from_wallet_id);
CREATE INDEX IF NOT EXISTS idx_txn_to ON transactions(to_wallet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_posted ON transactions(schedule_id, date) WHERE schedule_id IS NOT NULL;
`

export const DEFAULT_CATEGORIES: { name: string; kind: 'income' | 'expense' }[] = [
  { name: 'Food', kind: 'expense' },
  { name: 'Hobby', kind: 'expense' },
  { name: 'Bills', kind: 'expense' },
  { name: 'Car', kind: 'expense' },
  { name: 'Travel', kind: 'expense' },
  { name: 'Other', kind: 'expense' },
  { name: 'Salary', kind: 'income' },
  { name: 'Refund', kind: 'income' },
  { name: 'Gift', kind: 'income' },
  { name: 'Other income', kind: 'income' },
  { name: 'Opening balance', kind: 'income' },
]
