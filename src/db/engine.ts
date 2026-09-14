import initSqlJs, { type Database } from 'sql.js/dist/sql-wasm.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'
import { DEFAULT_CATEGORIES, SCHEMA_SQL } from './schema'
import type { DbOp } from './protocol'
import type {
  Budget,
  Category,
  NewTransaction,
  NewWallet,
  Schedule,
  Transaction,
  Wallet,
} from './types'
import type { SpendeeRow } from '../lib/spendee'
import { addDaysISO, addMonthsISO, addYearsISO, periodContaining } from '../lib/period'

const DB_FILE = 'cashbook.sqlite'
const SQLITE_HEADER = 'SQLite format 3'

let db: Database | null = null
let persistGranted = false
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null
let initLock: Promise<void> | null = null

function uuid(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

function requireDb(): Database {
  if (!db) throw new Error('Database is not open.')
  return db
}

function all<T>(sql: string, params: BindValue[] = []): T[] {
  const stmt = requireDb().prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

function one<T>(sql: string, params: BindValue[] = []): T | undefined {
  return all<T>(sql, params)[0]
}

function run(sql: string, params: BindValue[] = []): void {
  requireDb().run(sql, params)
}

function meta(key: string): string | undefined {
  return one<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value
}

function setMeta(key: string, value: string): void {
  run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ])
}

type BindValue = string | number | null | Uint8Array

async function requestPersist(): Promise<boolean> {
  try {
    persistGranted = await navigator.storage.persist()
  } catch {
    persistGranted = false
  }
  return persistGranted
}

async function writeOpfs(bytes: Uint8Array): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const fh = await root.getFileHandle(DB_FILE, { create: true })
  const sync = fh as FileSystemFileHandle & {
    createSyncAccessHandle?: () => Promise<{
      truncate: (n: number) => void
      write: (buf: BufferSource, opts?: { at?: number }) => number
      flush: () => void
      close: () => void
    }>
  }
  try {
    if (sync.createSyncAccessHandle) {
      const h = await sync.createSyncAccessHandle()
      h.truncate(0)
      h.write(bytes, { at: 0 })
      h.flush()
      h.close()
      return
    }
  } catch {
    // Main thread / some browsers only allow createWritable.
  }
  const w = await fh.createWritable({ keepExistingData: false })
  await w.write(bytes.buffer as ArrayBuffer)
  await w.close()
}

async function readOpfs(): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle(DB_FILE)
    const sync = fh as FileSystemFileHandle & {
      createSyncAccessHandle?: () => Promise<{
        getSize: () => number
        read: (buf: BufferSource, opts?: { at?: number }) => number
        close: () => void
      }>
    }
    if (sync.createSyncAccessHandle) {
      const h = await sync.createSyncAccessHandle()
      const size = h.getSize()
      const buf = new Uint8Array(size)
      if (size > 0) h.read(buf, { at: 0 })
      h.close()
      return size > 0 ? buf : null
    }
    const file = await fh.getFile()
    if (file.size === 0) return null
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

async function persist(): Promise<void> {
  const data = requireDb().export()
  await writeOpfs(data)
}

function seedIfEmpty(): void {
  const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM categories')?.n ?? 0
  if (count > 0) return
  const created = nowIso()
  for (const cat of DEFAULT_CATEGORIES) {
    run('INSERT INTO categories (id, name, kind, is_default, hidden, created_at) VALUES (?, ?, ?, 1, 0, ?)', [
      uuid(),
      cat.name,
      cat.kind,
      created,
    ])
  }
  if (!meta('cash_flow_start_day')) setMeta('cash_flow_start_day', '1')
  if (!meta('schema_version')) setMeta('schema_version', '1')
}

function applySchema(): void {
  requireDb().exec('PRAGMA foreign_keys = ON;')
  requireDb().exec(SCHEMA_SQL)
  seedIfEmpty()
}

function walletById(id: string): Wallet {
  const w = one<Wallet>('SELECT * FROM wallets WHERE id = ?', [id])
  if (!w) throw new Error('Wallet not found.')
  return w
}

function txnById(id: string): Transaction {
  const t = one<Transaction>('SELECT * FROM transactions WHERE id = ?', [id])
  if (!t) throw new Error('Transaction not found.')
  return t
}

function assertSameCurrency(a: string, b: string): void {
  const wa = walletById(a)
  const wb = walletById(b)
  if (wa.currency !== wb.currency) {
    throw new Error('Transfers are only allowed between wallets with the same currency.')
  }
}

function validateTxn(input: NewTransaction): void {
  if (input.amount <= 0) throw new Error('Amount must be greater than zero.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Date must be YYYY-MM-DD.')
  if (input.kind === 'transfer') {
    if (!input.from_wallet_id || !input.to_wallet_id) throw new Error('Transfer needs both wallets.')
    if (input.from_wallet_id === input.to_wallet_id) throw new Error('Cannot transfer to the same wallet.')
    assertSameCurrency(input.from_wallet_id, input.to_wallet_id)
    return
  }
  if (!input.wallet_id) throw new Error('Wallet is required.')
  walletById(input.wallet_id)
  if (!input.category_id) throw new Error('Category is required.')
  const cat = one<Category>('SELECT * FROM categories WHERE id = ?', [input.category_id])
  if (!cat) throw new Error('Category not found.')
  if (cat.kind !== input.kind) throw new Error('Category type does not match the transaction.')
}

function insertTxn(input: NewTransaction, extra?: { schedule_id?: string; unpaired?: boolean }): string {
  validateTxn(input)
  const id = uuid()
  run(
    `INSERT INTO transactions (
      id, kind, date, amount, note, category_id, wallet_id, from_wallet_id, to_wallet_id,
      schedule_id, is_opening, unpaired_import, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.kind,
      input.date,
      input.amount,
      input.note ?? '',
      input.kind === 'transfer' ? null : (input.category_id ?? null),
      input.kind === 'transfer' ? null : (input.wallet_id ?? null),
      input.kind === 'transfer' ? (input.from_wallet_id ?? null) : null,
      input.kind === 'transfer' ? (input.to_wallet_id ?? null) : null,
      extra?.schedule_id ?? null,
      input.is_opening ? 1 : 0,
      extra?.unpaired ? 1 : 0,
      nowIso(),
    ],
  )
  return id
}

function effectSql(): string {
  return `COALESCE(SUM(CASE
    WHEN kind = 'income' AND wallet_id = $w THEN amount
    WHEN kind = 'expense' AND wallet_id = $w THEN -amount
    WHEN kind = 'transfer' AND from_wallet_id = $w THEN -amount
    WHEN kind = 'transfer' AND to_wallet_id = $w THEN amount
    ELSE 0 END), 0)`
}

function listWallets(): Wallet[] {
  return all<Wallet>('SELECT * FROM wallets WHERE archived = 0 ORDER BY name COLLATE NOCASE')
}

function listCategories(): Category[] {
  return all<Category>('SELECT * FROM categories ORDER BY kind, name COLLATE NOCASE')
}

function budgetCategoryIds(budgetId: string): string[] {
  return all<{ category_id: string }>('SELECT category_id FROM budget_categories WHERE budget_id = ?', [budgetId]).map(
    (r) => r.category_id,
  )
}

function loadBudget(row: Omit<Budget, 'category_ids'>): Budget {
  return { ...row, category_ids: budgetCategoryIds(row.id) }
}

function occupiedCategories(walletId: string, exceptBudget?: string): Set<string> {
  const rows = all<{ category_id: string }>(
    `SELECT bc.category_id FROM budget_categories bc
     JOIN budgets b ON b.id = bc.budget_id
     WHERE b.wallet_id = ? AND b.archived = 0 ${exceptBudget ? 'AND b.id != ?' : ''}`,
    exceptBudget ? [walletId, exceptBudget] : [walletId],
  )
  return new Set(rows.map((r) => r.category_id))
}

function saveBudgetCategories(budgetId: string, walletId: string, categoryIds: string[], except?: string): void {
  if (categoryIds.length === 0) throw new Error('Pick at least one expense category.')
  const taken = occupiedCategories(walletId, except)
  for (const id of categoryIds) {
    if (taken.has(id)) throw new Error('That category is already in another budget on this wallet.')
    const cat = one<Category>('SELECT * FROM categories WHERE id = ?', [id])
    if (!cat || cat.kind !== 'expense') throw new Error('Budgets only use expense categories.')
  }
  run('DELETE FROM budget_categories WHERE budget_id = ?', [budgetId])
  for (const id of categoryIds) {
    run('INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)', [budgetId, id])
  }
}

function snapshot() {
  return {
    wallets: listWallets(),
    categories: listCategories(),
    cashFlowStartDay: Number(meta('cash_flow_start_day') ?? '1'),
    lastExportAt: meta('last_export_at') ?? null,
    persistGranted,
  }
}

function walletMonth(walletId: string, start: string, end: string, today: string) {
  const wallet = walletById(walletId)
  const running = sumEffect(walletId)
  const cashFlow = sumEffect(walletId, start, end)
  const transactions = all<Transaction>(
    `SELECT * FROM transactions
     WHERE date >= ? AND date <= ?
       AND (
         (kind IN ('income', 'expense') AND wallet_id = ?)
         OR (kind = 'transfer' AND (from_wallet_id = ? OR to_wallet_id = ?))
       )
     ORDER BY date DESC, created_at DESC`,
    [start, end, walletId, walletId, walletId],
  )
  const expenseSlices = all<{ category_id: string; amount: number }>(
    `SELECT category_id, SUM(amount) AS amount FROM transactions
     WHERE kind = 'expense' AND wallet_id = ? AND date >= ? AND date <= ?
     GROUP BY category_id`,
    [walletId, start, end],
  )
  const cats = new Map(listCategories().map((c) => [c.id, c.name]))
  const pie = expenseSlices
    .filter((s) => s.amount > 0)
    .map((s) => ({
      key: s.category_id,
      label: cats.get(s.category_id) ?? 'Unknown',
      amount: s.amount,
    }))
  const transferOut =
    one<{ n: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
       WHERE kind = 'transfer' AND from_wallet_id = ? AND date >= ? AND date <= ?`,
      [walletId, start, end],
    )?.n ?? 0
  if (transferOut > 0) pie.push({ key: 'transfer', label: 'Transfer', amount: transferOut })
  pie.sort((a, b) => b.amount - a.amount)

  const budgets = all<Omit<Budget, 'category_ids'>>(
    'SELECT * FROM budgets WHERE wallet_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE',
    [walletId],
  ).map((row) => {
    const budget = loadBudget(row)
    const period = periodContaining(today, budget.roll_day)
    const spent =
      budget.category_ids.length === 0
        ? 0
        : (one<{ n: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
             WHERE kind = 'expense' AND wallet_id = ? AND date >= ? AND date <= ?
               AND category_id IN (${budget.category_ids.map(() => '?').join(',')})`,
            [walletId, period.start, period.end, ...budget.category_ids],
          )?.n ?? 0)
    return { ...budget, spent, periodStart: period.start, periodEnd: period.end }
  })

  return { wallet, runningBalance: running, cashFlow, pie, transactions, budgets }
}

function sumEffect(walletId: string, start?: string, end?: string): number {
  let sql = `SELECT ${effectSql()} AS n FROM transactions`
  const params: Record<string, BindValue> = { $w: walletId }
  if (start && end) {
    sql += ' WHERE date >= $s AND date <= $e'
    params.$s = start
    params.$e = end
  }
  const stmt = requireDb().prepare(sql)
  stmt.bind(params)
  let n = 0
  if (stmt.step()) n = Number(stmt.getAsObject().n ?? 0)
  stmt.free()
  return n
}

function nextScheduleDate(s: Schedule): string {
  if (s.interval_kind === 'monthly') return addMonthsISO(s.next_date, 1)
  if (s.interval_kind === 'yearly') return addYearsISO(s.next_date, 1)
  return addDaysISO(s.next_date, s.interval_days || 1)
}

function materialize(today: string): number {
  const schedules = all<Schedule>('SELECT * FROM schedules WHERE paused = 0')
  let posted = 0
  for (const s of schedules) {
    while (s.next_date <= today && (!s.end_date || s.next_date <= s.end_date)) {
      const already = one<{ id: string }>(
        'SELECT id FROM transactions WHERE schedule_id = ? AND date = ?',
        [s.id, s.next_date],
      )
      if (already) {
        s.next_date = nextScheduleDate(s)
        run('UPDATE schedules SET next_date = ? WHERE id = ?', [s.next_date, s.id])
        continue
      }
      insertTxn(
        {
          kind: s.kind,
          date: s.next_date,
          amount: s.amount,
          note: s.note,
          category_id: s.category_id,
          wallet_id: s.wallet_id,
          from_wallet_id: s.from_wallet_id,
          to_wallet_id: s.to_wallet_id,
        },
        { schedule_id: s.id },
      )
      posted += 1
      s.next_date = nextScheduleDate(s)
      run('UPDATE schedules SET next_date = ? WHERE id = ?', [s.next_date, s.id])
    }
  }
  return posted
}

function ensureWallet(name: string, currency: string): Wallet {
  const existing = one<Wallet>('SELECT * FROM wallets WHERE name = ? COLLATE NOCASE AND archived = 0', [name])
  if (existing) return existing
  const w: Wallet = { id: uuid(), name, currency, archived: 0, created_at: nowIso() }
  run('INSERT INTO wallets (id, name, currency, archived, created_at) VALUES (?, ?, ?, 0, ?)', [
    w.id,
    w.name,
    w.currency,
    w.created_at,
  ])
  return w
}

function ensureCategory(name: string, kind: 'income' | 'expense'): Category {
  const existing = one<Category>(
    'SELECT * FROM categories WHERE name = ? COLLATE NOCASE AND kind = ?',
    [name, kind],
  )
  if (existing) {
    if (existing.hidden) run('UPDATE categories SET hidden = 0 WHERE id = ?', [existing.id])
    return existing
  }
  const c: Category = {
    id: uuid(),
    name,
    kind,
    is_default: 0,
    hidden: 0,
    created_at: nowIso(),
  }
  run('INSERT INTO categories (id, name, kind, is_default, hidden, created_at) VALUES (?, ?, ?, 0, 0, ?)', [
    c.id,
    c.name,
    c.kind,
    c.created_at,
  ])
  return c
}

function importSpendee(rows: SpendeeRow[]): { created: number; unpaired: number } {
  type Transferish = SpendeeRow & { used?: boolean }
  const outgoing: Transferish[] = []
  const incoming: Transferish[] = []
  const normal: SpendeeRow[] = []
  for (const row of rows) {
    if (!row.wallet) continue
    if (row.type === 'Outgoing Transfer') outgoing.push(row)
    else if (row.type === 'Incoming Transfer') incoming.push(row)
    else normal.push(row)
  }

  let created = 0
  let unpaired = 0
  requireDb().exec('BEGIN')
  try {
    for (const row of normal) {
      const kind = row.type === 'Income' ? 'income' : 'expense'
      const wallet = ensureWallet(row.wallet, row.currency)
      const catName = row.category || (kind === 'income' ? 'Other income' : 'Other')
      const cat = ensureCategory(catName, kind)
      insertTxn({
        kind,
        date: row.date,
        amount: row.amount,
        note: row.note,
        wallet_id: wallet.id,
        category_id: cat.id,
      })
      created += 1
    }

    for (const out of outgoing) {
      if (out.used) continue
      const match = incoming.find(
        (inn) =>
          !inn.used && inn.date === out.date && inn.amount === out.amount && inn.wallet !== out.wallet,
      )
      if (match) {
        out.used = true
        match.used = true
        const from = ensureWallet(out.wallet, out.currency)
        const to = ensureWallet(match.wallet, match.currency)
        if (from.currency !== to.currency) {
          // Same-currency rule: import as two unpaired legs instead of a lying transfer.
          const exp = ensureCategory(out.category || 'Other', 'expense')
          const inc = ensureCategory(match.category || 'Other income', 'income')
          insertTxn(
            {
              kind: 'expense',
              date: out.date,
              amount: out.amount,
              note: out.note || `Transfer to ${match.wallet}`,
              wallet_id: from.id,
              category_id: exp.id,
            },
            { unpaired: true },
          )
          insertTxn(
            {
              kind: 'income',
              date: match.date,
              amount: match.amount,
              note: match.note || `Transfer from ${out.wallet}`,
              wallet_id: to.id,
              category_id: inc.id,
            },
            { unpaired: true },
          )
          created += 2
          unpaired += 2
          continue
        }
        insertTxn({
          kind: 'transfer',
          date: out.date,
          amount: out.amount,
          note: out.note || match.note,
          from_wallet_id: from.id,
          to_wallet_id: to.id,
        })
        created += 1
      }
    }

    for (const out of outgoing.filter((r) => !r.used)) {
      const wallet = ensureWallet(out.wallet, out.currency)
      const cat = ensureCategory(out.category || 'Other', 'expense')
      insertTxn(
        {
          kind: 'expense',
          date: out.date,
          amount: out.amount,
          note: out.note || 'Unpaired Spendee transfer',
          wallet_id: wallet.id,
          category_id: cat.id,
        },
        { unpaired: true },
      )
      created += 1
      unpaired += 1
    }
    for (const inn of incoming.filter((r) => !r.used)) {
      const wallet = ensureWallet(inn.wallet, inn.currency)
      const cat = ensureCategory(inn.category || 'Other income', 'income')
      insertTxn(
        {
          kind: 'income',
          date: inn.date,
          amount: inn.amount,
          note: inn.note || 'Unpaired Spendee transfer',
          wallet_id: wallet.id,
          category_id: cat.id,
        },
        { unpaired: true },
      )
      created += 1
      unpaired += 1
    }
    requireDb().exec('COMMIT')
  } catch (err) {
    requireDb().exec('ROLLBACK')
    throw err
  }
  return { created, unpaired }
}

function createWallet(input: NewWallet): Wallet {
  const name = input.name.trim()
  if (!name) throw new Error('Wallet name is required.')
  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a 3-letter code (e.g. CZK).')
  const w: Wallet = { id: uuid(), name, currency, archived: 0, created_at: nowIso() }
  run('INSERT INTO wallets (id, name, currency, archived, created_at) VALUES (?, ?, ?, 0, ?)', [
    w.id,
    w.name,
    w.currency,
    w.created_at,
  ])
  if (input.openingAmount && input.openingAmount > 0) {
    const cat = ensureCategory('Opening balance', 'income')
    insertTxn({
      kind: 'income',
      date: input.openingDate || new Date().toISOString().slice(0, 10),
      amount: input.openingAmount,
      note: 'Opening balance',
      wallet_id: w.id,
      category_id: cat.id,
      is_opening: true,
    })
  }
  return w
}

async function openDb(bytes?: Uint8Array): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => sqlWasm })
  }
  db?.close()
  db = bytes ? new SQL.Database(bytes) : new SQL.Database()
  applySchema()
}

async function handle(req: DbOp): Promise<unknown> {
  switch (req.op) {
    case 'init': {
      if (!initLock) {
        initLock = (async () => {
          await requestPersist()
          const existing = await readOpfs()
          await openDb(existing ?? undefined)
          await persist()
        })()
      }
      await initLock
      return snapshot()
    }
    case 'export':
      return requireDb().export()
    case 'importSqlite': {
      const header = new TextDecoder().decode(req.bytes.slice(0, 16))
      if (!header.startsWith(SQLITE_HEADER)) throw new Error('That file is not a SQLite database.')
      await openDb(req.bytes)
      await persist()
      return snapshot()
    }
    case 'snapshot':
      return snapshot()
    case 'setCashFlowStartDay': {
      const day = Math.min(28, Math.max(1, Math.round(req.day)))
      setMeta('cash_flow_start_day', String(day))
      await persist()
      return snapshot()
    }
    case 'markExported': {
      setMeta('last_export_at', nowIso())
      await persist()
      return snapshot()
    }
    case 'createWallet': {
      const w = createWallet(req.input)
      await persist()
      return w
    }
    case 'updateWallet': {
      const w = walletById(req.idWallet)
      const currency = req.currency.trim().toUpperCase()
      if (currency !== w.currency) {
        const used = one<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ? OR from_wallet_id = ? OR to_wallet_id = ?', [
          w.id,
          w.id,
          w.id,
        ])?.n ?? 0
        if (used > 0) throw new Error('Cannot change currency on a wallet that already has transactions.')
      }
      run('UPDATE wallets SET name = ?, currency = ? WHERE id = ?', [req.name.trim(), currency, w.id])
      await persist()
      return
    }
    case 'archiveWallet': {
      run('UPDATE wallets SET archived = 1 WHERE id = ?', [req.idWallet])
      await persist()
      return
    }
    case 'walletMonth':
      return walletMonth(req.walletId, req.start, req.end, req.today)
    case 'getTransaction':
      return txnById(req.txnId)
    case 'createTransaction': {
      insertTxn(req.input)
      await persist()
      return
    }
    case 'updateTransaction': {
      const existing = txnById(req.idTxn)
      if (existing.kind === 'transfer' && req.input.kind !== 'transfer') {
        throw new Error('Cannot change a transfer into an expense or income. Delete it and create a new one.')
      }
      if (existing.kind !== 'transfer' && req.input.kind === 'transfer') {
        throw new Error('Cannot change an expense or income into a transfer. Delete it and create a new one.')
      }
      validateTxn(req.input)
      run(
        `UPDATE transactions SET kind = ?, date = ?, amount = ?, note = ?, category_id = ?, wallet_id = ?,
         from_wallet_id = ?, to_wallet_id = ? WHERE id = ?`,
        [
          req.input.kind,
          req.input.date,
          req.input.amount,
          req.input.note ?? '',
          req.input.kind === 'transfer' ? null : (req.input.category_id ?? null),
          req.input.kind === 'transfer' ? null : (req.input.wallet_id ?? null),
          req.input.kind === 'transfer' ? (req.input.from_wallet_id ?? null) : null,
          req.input.kind === 'transfer' ? (req.input.to_wallet_id ?? null) : null,
          req.idTxn,
        ],
      )
      await persist()
      return
    }
    case 'deleteTransaction': {
      run('DELETE FROM transactions WHERE id = ?', [req.idTxn])
      await persist()
      return
    }
    case 'createCategory': {
      ensureCategory(req.name.trim(), req.kind)
      await persist()
      return
    }
    case 'renameCategory': {
      run('UPDATE categories SET name = ? WHERE id = ?', [req.name.trim(), req.idCat])
      await persist()
      return
    }
    case 'hideCategory': {
      run('UPDATE categories SET hidden = ? WHERE id = ?', [req.hidden ? 1 : 0, req.idCat])
      await persist()
      return
    }
    case 'listBudgets':
      return all<Omit<Budget, 'category_ids'>>(
        'SELECT * FROM budgets WHERE wallet_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE',
        [req.walletId],
      ).map(loadBudget)
    case 'createBudget': {
      const id = uuid()
      if (req.input.limit_amount <= 0) throw new Error('Budget limit must be greater than zero.')
      const roll = Math.min(28, Math.max(1, req.input.roll_day))
      run(
        'INSERT INTO budgets (id, wallet_id, name, limit_amount, roll_day, archived, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [id, req.input.wallet_id, req.input.name.trim(), req.input.limit_amount, roll, nowIso()],
      )
      saveBudgetCategories(id, req.input.wallet_id, req.input.category_ids)
      await persist()
      return
    }
    case 'updateBudget': {
      const roll = Math.min(28, Math.max(1, req.input.roll_day))
      run('UPDATE budgets SET name = ?, limit_amount = ?, roll_day = ? WHERE id = ?', [
        req.input.name.trim(),
        req.input.limit_amount,
        roll,
        req.idBudget,
      ])
      const b = one<Budget>('SELECT * FROM budgets WHERE id = ?', [req.idBudget])
      if (!b) throw new Error('Budget not found.')
      saveBudgetCategories(req.idBudget, b.wallet_id, req.input.category_ids, req.idBudget)
      await persist()
      return
    }
    case 'archiveBudget': {
      run('UPDATE budgets SET archived = 1 WHERE id = ?', [req.idBudget])
      await persist()
      return
    }
    case 'listSchedules':
      return all<Schedule>('SELECT * FROM schedules ORDER BY next_date')
    case 'createSchedule': {
      if (req.input.amount <= 0) throw new Error('Amount must be greater than zero.')
      run(
        `INSERT INTO schedules (
          id, kind, amount, note, category_id, wallet_id, from_wallet_id, to_wallet_id,
          interval_kind, interval_days, next_date, end_date, paused, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          uuid(),
          req.input.kind,
          req.input.amount,
          req.input.note ?? '',
          req.input.kind === 'transfer' ? null : (req.input.category_id ?? null),
          req.input.kind === 'transfer' ? null : (req.input.wallet_id ?? null),
          req.input.kind === 'transfer' ? (req.input.from_wallet_id ?? null) : null,
          req.input.kind === 'transfer' ? (req.input.to_wallet_id ?? null) : null,
          req.input.interval_kind,
          req.input.interval_kind === 'days' ? (req.input.interval_days ?? 1) : null,
          req.input.next_date,
          req.input.end_date ?? null,
          nowIso(),
        ],
      )
      await persist()
      return
    }
    case 'updateSchedule': {
      run(
        `UPDATE schedules SET kind = ?, amount = ?, note = ?, category_id = ?, wallet_id = ?,
         from_wallet_id = ?, to_wallet_id = ?, interval_kind = ?, interval_days = ?, next_date = ?, end_date = ?
         WHERE id = ?`,
        [
          req.input.kind,
          req.input.amount,
          req.input.note ?? '',
          req.input.kind === 'transfer' ? null : (req.input.category_id ?? null),
          req.input.kind === 'transfer' ? null : (req.input.wallet_id ?? null),
          req.input.kind === 'transfer' ? (req.input.from_wallet_id ?? null) : null,
          req.input.kind === 'transfer' ? (req.input.to_wallet_id ?? null) : null,
          req.input.interval_kind,
          req.input.interval_kind === 'days' ? (req.input.interval_days ?? 1) : null,
          req.input.next_date,
          req.input.end_date ?? null,
          req.idSchedule,
        ],
      )
      await persist()
      return
    }
    case 'deleteSchedule': {
      run('DELETE FROM schedules WHERE id = ?', [req.idSchedule])
      await persist()
      return
    }
    case 'skipSchedule': {
      const s = one<Schedule>('SELECT * FROM schedules WHERE id = ?', [req.idSchedule])
      if (!s) throw new Error('Schedule not found.')
      run('UPDATE schedules SET next_date = ? WHERE id = ?', [nextScheduleDate(s), s.id])
      await persist()
      return
    }
    case 'pauseSchedule': {
      run('UPDATE schedules SET paused = ? WHERE id = ?', [req.paused ? 1 : 0, req.idSchedule])
      await persist()
      return
    }
    case 'materialize': {
      const n = materialize(req.today)
      if (n > 0) await persist()
      return n
    }
    case 'importSpendee': {
      const result = importSpendee(req.rows)
      await persist()
      return result
    }
    default:
      throw new Error('Unknown operation')
  }
}

export { handle }
