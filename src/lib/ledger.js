const tables = ['customers', 'recharges', 'payments', 'services']
export const emptyLedger = { customers: [], recharges: [], payments: [], services: [] }

// Count every page: a short/capped response must never look like a complete ledger.
export async function fetchAllRows(client, table, { signal, pageSize = 500 } = {}) {
  const rows = []
  const ids = new Set()
  let expected
  do {
    const { data, count, error } = await client.from(table)
      .select('*', { count: 'exact' }).order('id', { ascending: true })
      .range(rows.length, rows.length + pageSize - 1).abortSignal(signal)
    if (error) throw new Error(`${table}: ${error.message || 'Request failed'}`)
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${table}: Could not verify the complete row count.`)
    }
    expected ??= count
    if (count !== expected || data.length !== Math.min(pageSize, expected - rows.length)) {
      throw new Error(`${table}: Data changed or the response was incomplete. Retry.`)
    }
    for (const row of data) {
      if (row.id == null || ids.has(String(row.id))) {
        throw new Error(`${table}: Missing or duplicate row ID. Retry.`)
      }
      ids.add(String(row.id))
    }
    rows.push(...data)
  } while (rows.length < expected)
  return rows
}

export async function fetchLedger(client, signal) {
  const read = async () => Object.fromEntries(await Promise.all(tables.map(async table => (
    [table, await fetchAllRows(client, table, { signal })]
  ))))
  const first = await read()
  const second = await read()
  // REST pages are separate snapshots. Refuse observed edits, including same-count
  // changes, between two complete scans instead of publishing a mixed balance.
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('The ledger changed while loading. Retry to load a consistent balance.')
  }
  return second
}

export function createLedgerLoader({ read, publish, timeoutMs = 30000 }) {
  let generation = 0
  let ownerVersion = 0
  let owner = null
  let controller
  let writes = 0
  let status = 'idle'
  const emit = (next, extra = {}) => {
    status = next
    publish({ status, owner, ...extra })
  }
  const invalidate = () => {
    generation += 1
    controller?.abort()
  }
  const load = async () => {
    if (!owner || writes) return null
    invalidate()
    const request = generation
    controller = new AbortController()
    const signal = controller.signal
    emit('loading')
    let timer
    try {
      const data = await Promise.race([
        read(signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Loading timed out. Check your connection and Retry.'))
            if (request === generation) controller.abort()
          }, timeoutMs)
        }),
      ])
      if (request !== generation) return null
      emit('ready', { data })
      return data
    } catch (error) {
      if (request === generation) emit('error', { error: error.message || 'Could not load the complete ledger.' })
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    load,
    setOwner(next) {
      invalidate()
      ownerVersion += 1
      owner = next
      writes = 0
      emit('idle', { data: emptyLedger })
    },
    isReady: () => Boolean(owner) && status === 'ready' && !writes,
    beginWrite() {
      if (!owner || status !== 'ready' || writes) return null
      const writeVersion = ownerVersion
      invalidate()
      writes += 1
      controller = new AbortController()
      const writeSignal = controller.signal
      emit('saving')
      let finished = false
      const finish = async () => {
        if (finished || ownerVersion !== writeVersion) return
        finished = true
        writes -= 1
        await load()
      }
      finish.read = async () => {
        const data = await readWithTimeout(read, writeSignal, timeoutMs)
        if (ownerVersion !== writeVersion) throw new Error('Session changed while loading.')
        return data
      }
      return finish
    },
    // Backup uses the same complete read and is cancelled by writes/logout/refresh.
    async readForBackup() {
      if (!owner || status !== 'ready' || writes) throw new Error('Load the complete ledger before backing up.')
      const request = generation
      const data = await readWithTimeout(read, controller.signal, timeoutMs)
      if (request !== generation || !owner || writes) throw new Error('Ledger changed during backup. Retry.')
      return data
    },
  }
}

async function readWithTimeout(read, parentSignal, timeoutMs) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  parentSignal.addEventListener('abort', cancel, { once: true })
  if (parentSignal.aborted) cancel()
  let timer
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Loading timed out. Retry.'))
          controller.abort()
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', cancel)
  }
}
