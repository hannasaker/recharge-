import { describe, it, expect, vi } from 'vitest'
import { createLedgerLoader, fetchAllRows, fetchLedger } from './ledger'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const rows = (n) => Array.from({ length: n }, (_, id) => ({ id, amount: id * 1000 }))
function clientFor(tables, change = (result) => result) {
  let calls = 0
  return { from(table) {
    let start, end
    const query = {
      select(columns, options) { expect(options.count).toBe('exact'); return query },
      order(column, options) { expect(column).toBe('id'); expect(options.ascending).toBe(true); return query },
      range(first, last) { start = first; end = last; return query },
      abortSignal() {
        const all = tables[table] || []
        return Promise.resolve(change({ data: all.slice(start, end + 1), count: all.length, error: null }, ++calls, table))
      },
    }
    return query
  } }
}
function setup(read, options) {
  const states = []
  const loader = createLedgerLoader({ read, publish: state => states.push(state), ...options })
  loader.setOwner('user')
  return { loader, states, state: () => states.at(-1) }
}

describe('complete pagination', () => {
  it.each([0, 984, 1000, 1001, 2407])('returns every row for %i records', async n => {
    expect(await fetchAllRows(clientFor({ recharges: rows(n) }), 'recharges')).toEqual(rows(n))
  })
  it.each(['cap', 'count', 'duplicate', 'missing-count', 'error'])('rejects %s instead of publishing partial records', async mode => {
    const client = clientFor({ recharges: rows(1200) }, (r, call) => {
      if (mode === 'cap') r.data = r.data.slice(0, 100)
      if (mode === 'count' && call === 2) r.count++
      if (mode === 'duplicate' && call === 2) r.data[0] = { id: 0 }
      if (mode === 'missing-count') r.count = null
      if (mode === 'error' && call === 2) r.error = { message: 'offline' }
      return r
    })
    await expect(fetchAllRows(client, 'recharges')).rejects.toThrow()
  })
  it('checks every table, including >1000 payments, customers and services', async () => {
    const data = Object.fromEntries(['customers', 'payments', 'recharges', 'services'].map(table => [table, rows(1101)]))
    expect(await fetchLedger(clientFor(data))).toEqual(data)
  })
  it('rejects same-count edits between scans', async () => {
    const client = clientFor({ recharges: rows(2) }, (r, call, table) => {
      if (call > 4 && table === 'recharges') r.data = r.data.map(row => ({ ...row, amount: 77 }))
      return r
    })
    await expect(fetchLedger(client)).rejects.toThrow('ledger changed')
  })
  it('never returns a partial ledger when one table fails', async () => {
    await expect(fetchLedger(clientFor({}, (r, _, table) => table === 'payments' ? { ...r, error: { message: 'offline' } } : r))).rejects.toThrow('payments')
  })
})

describe('shared request lifecycle', () => {
  it('ignores an older response that arrives after a newer response, even if abort is ignored', async () => {
    const first = deferred(), second = deferred()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { loader, state } = setup(read)
    const old = loader.load(), current = loader.load()
    second.resolve({ recharges: rows(3) }); await current
    first.resolve({ recharges: rows(1) }); await old
    expect(state().data.recharges).toHaveLength(3)
    expect(read.mock.calls[0][0].aborted).toBe(true)
  })
  it('ignores stale errors as well as stale successes', async () => {
    const old = deferred()
    const { loader, state } = setup(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ value: 'new' }))
    const pending = loader.load(); await loader.load()
    old.reject(new Error('old failure')); await pending
    expect(state().status).toBe('ready')
    expect(state().data.value).toBe('new')
  })
  it('shows failure without data and succeeds on Retry', async () => {
    const { loader, state } = setup(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ value: 60 }))
    await loader.load()
    expect(state()).toMatchObject({ status: 'error', error: 'offline' })
    expect(state().data).toBeUndefined()
    expect(loader.beginWrite()).toBeNull()
    await expect(loader.readForBackup()).rejects.toThrow()
    await loader.load()
    expect(state()).toMatchObject({ status: 'ready', data: { value: 60 } })
  })
  it('suppresses refreshes and overlapping writes until the post-write reload', async () => {
    const read = vi.fn().mockResolvedValueOnce({ value: 60 }).mockResolvedValue({ value: 40 })
    const { loader, state } = setup(read)
    await loader.load()
    const finish = loader.beginWrite()
    expect(state().status).toBe('saving')
    expect(loader.beginWrite()).toBeNull()
    await loader.load()
    expect(read).toHaveBeenCalledTimes(1)
    await finish()
    expect(state()).toMatchObject({ status: 'ready', data: { value: 40 } })
    await finish()
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('blocks a pending initial load after logout', async () => {
    const d = deferred()
    const { loader, state } = setup(() => d.promise)
    const pending = loader.load()
    loader.setOwner(null)
    d.resolve({ value: 60 }); await pending
    expect(state().owner).toBeNull()
    expect(state().status).toBe('idle')
    expect(state().data.recharges).toEqual([])
  })
  it('does not finish an old write after logout and login as the same user', async () => {
    const read = vi.fn().mockResolvedValue({ value: 60 })
    const { loader } = setup(read)
    await loader.load()
    const finish = loader.beginWrite()
    loader.setOwner(null); loader.setOwner('user'); await loader.load()
    await finish()
    expect(read).toHaveBeenCalledTimes(2)
    expect(loader.isReady()).toBe(true)
  })
  it('invalidates backup reads when a write or logout intervenes', async () => {
    const d = deferred()
    const { loader } = setup(vi.fn().mockResolvedValueOnce({ value: 60 }).mockReturnValueOnce(d.promise))
    await loader.load()
    const pending = loader.readForBackup()
    loader.beginWrite()
    d.resolve({ value: 60 })
    await expect(pending).rejects.toThrow('changed')
  })
  it('allows a complete fresh read for payment allocation and rejects it after logout', async () => {
    const d = deferred()
    const { loader } = setup(vi.fn().mockResolvedValueOnce({ value: 60 }).mockReturnValueOnce(d.promise))
    await loader.load()
    const finish = loader.beginWrite()
    const pending = finish.read()
    loader.setOwner(null)
    d.resolve({ value: 60 })
    await expect(pending).rejects.toThrow('Session changed')
    await finish()
  })
  it('uses complete paginated data for backup without writing anything', async () => {
    const tables = { recharges: rows(2407), payments: rows(1001) }
    const { loader } = setup(signal => fetchLedger(clientFor(tables), signal))
    await loader.load()
    const data = await loader.readForBackup()
    expect(data.recharges).toHaveLength(2407)
    expect(data.payments).toHaveLength(1001)
  })
  it('times out hung requests and ignores their eventual result', async () => {
    const d = deferred()
    const { loader, state } = setup(vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue({ value: 60 }), { timeoutMs: 5 })
    await loader.load()
    expect(state().status).toBe('error')
    expect(state().error).toContain('timed out')
    await loader.load()
    d.resolve({ value: 0 }); await Promise.resolve()
    expect(state().data.value).toBe(60)
  })
})
