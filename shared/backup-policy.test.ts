import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isBackupStale, shouldSendBackupPush, STALE_AFTER_MS, PUSH_EVERY_MS } from './backup-policy.ts'

const day = 24 * 60 * 60 * 1000

describe('isBackupStale', () => {
  it('treats a missing backup as stale', () => {
    assert.equal(isBackupStale(null), true)
  })

  it('is fresh before five days and stale after', () => {
    const now = Date.parse('2026-09-16T12:00:00.000Z')
    assert.equal(isBackupStale(new Date(now - 4 * day).toISOString(), now), false)
    assert.equal(isBackupStale(new Date(now - STALE_AFTER_MS - 1).toISOString(), now), true)
  })
})

describe('shouldSendBackupPush', () => {
  const now = Date.parse('2026-09-16T08:00:00.000Z')

  it('sends when there has never been a cloud backup', () => {
    assert.equal(shouldSendBackupPush({ lastBackupAt: null, lastPushAt: null, now }), true)
  })

  it('does not send when the cloud copy is younger than five days', () => {
    assert.equal(
      shouldSendBackupPush({
        lastBackupAt: new Date(now - 2 * day).toISOString(),
        lastPushAt: null,
        now,
      }),
      false,
    )
  })

  it('sends at most once a week while the copy stays stale', () => {
    const lastBackupAt = new Date(now - 6 * day).toISOString()
    assert.equal(shouldSendBackupPush({ lastBackupAt, lastPushAt: null, now }), true)
    assert.equal(
      shouldSendBackupPush({
        lastBackupAt,
        lastPushAt: new Date(now - 3 * day).toISOString(),
        now,
      }),
      false,
    )
    assert.equal(
      shouldSendBackupPush({
        lastBackupAt,
        lastPushAt: new Date(now - PUSH_EVERY_MS).toISOString(),
        now,
      }),
      true,
    )
  })
})
