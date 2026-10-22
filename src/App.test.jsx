// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

const mock = vi.hoisted(() => ({ tables: {}, query: null, authCallback: null, insert: vi.fn() }))
vi.mock('./lib/supabase', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'test-user', email: 'test@example.com' } } } }),
    onAuthStateChange: callback => {
      mock.authCallback = callback
      return { data: { subscription: { unsubscribe() {} } } }
    },
    signOut: async () => { mock.authCallback('SIGNED_OUT', null); return { error: null } },
  },
  from: table => {
    let start, end
    const query = {
      select: () => query,
      order: () => query,
      range: (first, last) => { start = first; end = last; return query },
      abortSignal: async () => {
        if (mock.query) await mock.query(table)
        const data = mock.tables[table] || []
        return { data: data.slice(start, end + 1), count: data.length, error: null }
      },
      insert: mock.insert,
    }
    return query
  },
} }))

beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.localStorage.clear()
  mock.tables = {
    customers: [{ id: 'customer', name: 'Test Customer', phone: '03123456', customer_type: 'normal' }],
    recharges: [
      { id: '1', customer_id: 'customer', amount: 6300000, paid_amount: 900000, status: 'unpaid' },
      { id: '2', customer_id: 'customer', amount: 900000, paid_amount: null, status: 'paid' },
    ],
    payments: [], services: [{ id: 'service', name: 'Alfa' }],
  }
  mock.query = null
  mock.insert.mockReset()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real external calls are forbidden in tests') }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const balanceCard = () => screen.getByText('Total unpaid').parentElement
const visibleCard = () => !balanceCard().closest('[hidden]')

describe('ledger availability in the actual app', () => {
  it('hides all balances/actions during a delayed load; preserves partial-payment and paid-status calculations', async () => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    mock.query = () => pending
    render(<App />)
    await screen.findByRole('status')
    expect(visibleCard()).toBe(false)
    expect(screen.queryByRole('button', { name: /Backup to Google Sheets/i })).toBeNull()
    release()
    await waitFor(() => expect(visibleCard()).toBe(true))
    expect(balanceCard().textContent).toContain('5,400,000 LBP')
    expect(balanceCard().textContent).toContain('$60.00')
    expect(mock.insert).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('shows a clear failed-load warning, hides zero totals, and supports a successful Retry', async () => {
    mock.query = table => { if (table === 'recharges') throw new Error('Connection lost') }
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Balances unavailable')
    expect(alert.textContent).toContain('Connection lost')
    expect(visibleCard()).toBe(false)
    mock.query = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(visibleCard()).toBe(true))
    expect(balanceCard().textContent).toContain('$60.00')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('blocks actions while saving, then reloads the whole ledger even after a write fails', async () => {
    let release
    mock.insert.mockImplementation(() => new Promise(resolve => { release = resolve }))
    render(<App />)
    await waitFor(() => expect(visibleCard()).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Add Customer', exact: true }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mock customer' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '03123456' } })
    fireEvent.submit(screen.getByLabelText('Name').closest('form'))
    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Add customer', exact: true })).toBeNull()
    release({ error: { message: 'Test write failed' } })
    await screen.findByText('Test write failed')
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard', exact: true }))
    expect(balanceCard().textContent).toContain('$60.00')
  })
  it('does not send an incomplete backup when a backup read fails', async () => {
    render(<App />)
    await waitFor(() => expect(visibleCard()).toBe(true))
    mock.query = table => { if (table === 'recharges') throw new Error('Backup read failed') }
    fireEvent.click(screen.getAllByRole('button', { name: /Backup to Google Sheets/i })[0])
    await screen.findAllByText('Backup read failed')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not repopulate the UI when an old request completes after logout', async () => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    mock.query = () => pending
    render(<App />)
    await screen.findByRole('status')
    fireEvent.click(screen.getAllByRole('button', { name: 'Logout' })[0])
    await screen.findByRole('button', { name: 'Log in' })
    release()
    await waitFor(() => expect(screen.queryByText('Total unpaid')).toBeNull())
  })
})
