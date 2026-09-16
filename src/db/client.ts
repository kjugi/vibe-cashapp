import type {
  BackupInterval,
  Budget,
  DbSnapshot,
  NewBudget,
  NewSchedule,
  NewTransaction,
  NewWallet,
  Schedule,
  Transaction,
  Wallet,
  WalletMonth,
  ExpenseBreakdown,
} from './types'
import type { SpendeeRow } from '../lib/spendee'
import { handle } from './engine'

export type DbApi = {
  init(): Promise<void>
  exportDb(): Promise<Uint8Array>
  importSqlite(bytes: Uint8Array): Promise<void>
  snapshot(): Promise<DbSnapshot>
  setCashFlowStartDay(day: number): Promise<void>
  setBackupInterval(interval: BackupInterval): Promise<void>
  markExported(): Promise<void>
  createWallet(input: NewWallet): Promise<Wallet>
  updateWallet(id: string, name: string, currency: string): Promise<void>
  archiveWallet(id: string): Promise<void>
  walletMonth(walletId: string, start: string, end: string, today: string): Promise<WalletMonth>
  expensesByCategory(start: string, end: string): Promise<ExpenseBreakdown[]>
  getTransaction(id: string): Promise<Transaction>
  createTransaction(input: NewTransaction): Promise<void>
  updateTransaction(id: string, input: NewTransaction): Promise<void>
  deleteTransaction(id: string): Promise<void>
  createCategory(name: string, kind: 'income' | 'expense'): Promise<void>
  renameCategory(id: string, name: string): Promise<void>
  hideCategory(id: string, hidden: boolean): Promise<void>
  listBudgets(walletId: string): Promise<Budget[]>
  createBudget(input: NewBudget): Promise<void>
  updateBudget(id: string, input: NewBudget): Promise<void>
  archiveBudget(id: string): Promise<void>
  listSchedules(): Promise<Schedule[]>
  createSchedule(input: NewSchedule): Promise<void>
  updateSchedule(id: string, input: NewSchedule): Promise<void>
  deleteSchedule(id: string): Promise<void>
  skipSchedule(id: string): Promise<void>
  pauseSchedule(id: string, paused: boolean): Promise<void>
  materialize(today: string): Promise<number>
  importSpendee(rows: SpendeeRow[]): Promise<{ created: number; unpaired: number }>
}

export function createDbClient(): DbApi {
  return {
    async init() {
      await handle({ op: 'init' })
    },
    async exportDb() {
      return (await handle({ op: 'export' })) as Uint8Array
    },
    async importSqlite(bytes) {
      await handle({ op: 'importSqlite', bytes })
    },
    async snapshot() {
      return (await handle({ op: 'snapshot' })) as DbSnapshot
    },
    async setCashFlowStartDay(day) {
      await handle({ op: 'setCashFlowStartDay', day })
    },
    async setBackupInterval(interval) {
      await handle({ op: 'setBackupInterval', interval })
    },
    async markExported() {
      await handle({ op: 'markExported' })
    },
    async createWallet(input) {
      return (await handle({ op: 'createWallet', input })) as Wallet
    },
    async updateWallet(idWallet, name, currency) {
      await handle({ op: 'updateWallet', idWallet, name, currency })
    },
    async archiveWallet(idWallet) {
      await handle({ op: 'archiveWallet', idWallet })
    },
    async walletMonth(walletId, start, end, today) {
      return (await handle({ op: 'walletMonth', walletId, start, end, today })) as WalletMonth
    },
    async expensesByCategory(start, end) {
      return (await handle({ op: 'expensesByCategory', start, end })) as ExpenseBreakdown[]
    },
    async getTransaction(txnId) {
      return (await handle({ op: 'getTransaction', txnId })) as Transaction
    },
    async createTransaction(input) {
      await handle({ op: 'createTransaction', input })
    },
    async updateTransaction(idTxn, input) {
      await handle({ op: 'updateTransaction', idTxn, input })
    },
    async deleteTransaction(idTxn) {
      await handle({ op: 'deleteTransaction', idTxn })
    },
    async createCategory(name, kind) {
      await handle({ op: 'createCategory', name, kind })
    },
    async renameCategory(idCat, name) {
      await handle({ op: 'renameCategory', idCat, name })
    },
    async hideCategory(idCat, hidden) {
      await handle({ op: 'hideCategory', idCat, hidden })
    },
    async listBudgets(walletId) {
      return (await handle({ op: 'listBudgets', walletId })) as Budget[]
    },
    async createBudget(input) {
      await handle({ op: 'createBudget', input })
    },
    async updateBudget(idBudget, input) {
      await handle({ op: 'updateBudget', idBudget, input })
    },
    async archiveBudget(idBudget) {
      await handle({ op: 'archiveBudget', idBudget })
    },
    async listSchedules() {
      return (await handle({ op: 'listSchedules' })) as Schedule[]
    },
    async createSchedule(input) {
      await handle({ op: 'createSchedule', input })
    },
    async updateSchedule(idSchedule, input) {
      await handle({ op: 'updateSchedule', idSchedule, input })
    },
    async deleteSchedule(idSchedule) {
      await handle({ op: 'deleteSchedule', idSchedule })
    },
    async skipSchedule(idSchedule) {
      await handle({ op: 'skipSchedule', idSchedule })
    },
    async pauseSchedule(idSchedule, paused) {
      await handle({ op: 'pauseSchedule', idSchedule, paused })
    },
    async materialize(today) {
      return (await handle({ op: 'materialize', today })) as number
    },
    async importSpendee(rows) {
      return (await handle({ op: 'importSpendee', rows })) as { created: number; unpaired: number }
    },
  }
}
