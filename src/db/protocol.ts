import type {
  BackupInterval,
  NewBudget,
  NewSchedule,
  NewTransaction,
  NewWallet,
} from './types'
import type { SpendeeRow } from '../lib/spendee'

export type DbOp =
  | { op: 'init' }
  | { op: 'export' }
  | { op: 'importSqlite'; bytes: Uint8Array }
  | { op: 'snapshot' }
  | { op: 'setCashFlowStartDay'; day: number }
  | { op: 'setBackupInterval'; interval: BackupInterval }
  | { op: 'markExported' }
  | { op: 'createWallet'; input: NewWallet }
  | { op: 'updateWallet'; idWallet: string; name: string; currency: string }
  | { op: 'archiveWallet'; idWallet: string }
  | { op: 'walletMonth'; walletId: string; start: string; end: string; today: string }
  | { op: 'expensesByCategory'; start: string; end: string }
  | { op: 'getTransaction'; txnId: string }
  | { op: 'createTransaction'; input: NewTransaction }
  | { op: 'updateTransaction'; idTxn: string; input: NewTransaction }
  | { op: 'deleteTransaction'; idTxn: string }
  | { op: 'createCategory'; name: string; kind: 'income' | 'expense' }
  | { op: 'renameCategory'; idCat: string; name: string }
  | { op: 'hideCategory'; idCat: string; hidden: boolean }
  | { op: 'listBudgets'; walletId: string }
  | { op: 'createBudget'; input: NewBudget }
  | { op: 'updateBudget'; idBudget: string; input: NewBudget }
  | { op: 'archiveBudget'; idBudget: string }
  | { op: 'listSchedules' }
  | { op: 'createSchedule'; input: NewSchedule }
  | { op: 'updateSchedule'; idSchedule: string; input: NewSchedule }
  | { op: 'deleteSchedule'; idSchedule: string }
  | { op: 'skipSchedule'; idSchedule: string }
  | { op: 'pauseSchedule'; idSchedule: string; paused: boolean }
  | { op: 'materialize'; today: string }
  | { op: 'importSpendee'; rows: SpendeeRow[] }
