import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const defaultServices = ['Alfa', 'Touch', 'Ushare', 'Other']
const rechargeStatuses = ['unpaid', 'paid']
const pages = [
  { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Dashboard' },
  { id: 'addCustomer', label: 'Add Customer', mobileLabel: 'Add' },
  { id: 'customers', label: 'Customers & Balances', mobileLabel: 'Customers' },
  { id: 'addRecharge', label: 'Add Recharge', mobileLabel: 'Recharge' },
  { id: 'services', label: 'Bundles/Services', mobileLabel: 'Services' },
  { id: 'history', label: 'Recharge History', mobileLabel: 'History' },
]
const mobilePages = [
  ...pages,
  { id: 'monthlySummary', label: 'Monthly Summary', mobileLabel: 'Monthly Summary' },
]
const defaultExchangeRate = '90000'
const exchangeRateStorageKey = 'rechargeTrackerExchangeRate'
const exchangeRateUpdatedAtStorageKey = 'rechargeTrackerExchangeRateUpdatedAt'
const googleSheetsBackupUrl = 'https://script.google.com/macros/s/AKfycbzzXXC2zflYlsyRBm2ejQA9Zaw6Onn_xG3Pv8R_II3gSAUPXVy3EJAeX7LHSFCuXo2HJg/exec'
const googleSheetsBackupSecret = 'hanna_2005_recharge_key_backup_2026'

function getPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

function cleanPhoneInput(value) {
  return getPhoneDigits(value).slice(0, 8)
}

function formatPhoneInput(value) {
  const digits = cleanPhoneInput(value)
  const parts = [
    digits.slice(0, 2),
    digits.slice(2, 5),
    digits.slice(5, 8),
  ].filter(Boolean)

  return parts.join(' ')
}

function formatStoredPhone(value) {
  const digits = getPhoneDigits(value)

  if (digits.length === 8) {
    return formatPhoneInput(digits)
  }

  return String(value || '')
}

function formatLbp(amount) {
  return `${Math.round(Number(amount) || 0).toLocaleString('en-US')} LBP`
}

function formatUsdFromLbp(amount, exchangeRate) {
  const rate = Number(exchangeRate)

  if (!Number.isFinite(rate) || rate <= 0) {
    return '$0'
  }

  return `$${Math.round((Number(amount) || 0) / rate).toLocaleString('en-US')}`
}

function formatUsdFromLbpDetailed(amount, exchangeRate) {
  const rate = Number(exchangeRate)

  if (!Number.isFinite(rate) || rate <= 0) {
    return '$0'
  }

  return `$${((Number(amount) || 0) / rate).toLocaleString('en-US', { 
    maximumFractionDigits: 2,
  })}`
}

function getUsdAmountFromLbp(amount, exchangeRate) {
  const rate = Number(exchangeRate)

  if (!Number.isFinite(rate) || rate <= 0) {
    return 0
  }

  return Math.round(((Number(amount) || 0) / rate) * 100) / 100
}

function formatBackupDate(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString()
}

function formatBackupLbp(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('en-US')
}

function formatBackupUsd(amount, exchangeRate) {
  return getUsdAmountFromLbp(amount, exchangeRate).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function cleanBackupServiceName(value) {
  return String(value || '').replaceAll('$', '').trim()
}

function formatBackupActive(value) {
  if (value === true) {
    return 'Yes'
  }

  if (value === false) {
    return 'No'
  }

  return ''
}

function getSavedValue(key, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback
  }

  return window.localStorage.getItem(key) || fallback
}

function saveExchangeRate(rate, updatedAt) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(exchangeRateStorageKey, rate)
  window.localStorage.setItem(exchangeRateUpdatedAtStorageKey, updatedAt)
}

function getMonthValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')

  return `${year}-${month}`
}

function getLastMonthValue() {
  const date = new Date()
  date.setMonth(date.getMonth() - 1)

  return getMonthValue(date)
}

function formatMonthLabel(monthValue) {
  const [year, month] = String(monthValue || '').split('-')
  const monthNumber = Number(month)
  const yearNumber = Number(year)

  if (!yearNumber || !monthNumber) {
    return 'Custom month'
  }

  return new Date(yearNumber, monthNumber - 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function getSelectedMonthValue(monthFilter, customMonth) {
  if (monthFilter === 'this') {
    return getMonthValue()
  }

  if (monthFilter === 'last') {
    return getLastMonthValue()
  }

  if (monthFilter === 'custom') {
    return customMonth
  }

  return ''
}

function getSelectedMonthLabel(monthFilter, customMonth) {
  if (monthFilter === 'all') {
    return 'All time'
  }

  return formatMonthLabel(getSelectedMonthValue(monthFilter, customMonth))
}

function rechargeMatchesMonth(recharge, monthFilter, customMonth) {
  if (monthFilter === 'all') {
    return true
  }

  const selectedMonth = getSelectedMonthValue(monthFilter, customMonth)
  const createdAt = recharge?.created_at ? new Date(recharge.created_at) : null

  if (!selectedMonth || !createdAt || Number.isNaN(createdAt.getTime())) {
    return false
  }

  return getMonthValue(createdAt) === selectedMonth
}

function getThousandsFromLbp(amount) {
  return String((Number(amount) || 0) / 1000)
}

function getServiceName(service) {
  return String(service?.name || service?.service || service?.title || '').trim()
}

function getCustomerLabel(customer) {
  if (!customer) {
    return ''
  }

  return `${customer.name || 'Unnamed'} - ${formatStoredPhone(customer.phone)}`
}

function escapeCsv(value) {
  const text = String(value ?? '')

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

const styles = {
  appShell: {
    display: 'flex',
    minHeight: '100svh',
    textAlign: 'left',
    width: '100%',
    overflowX: 'hidden',
  },
  sidebar: {
    width: 'clamp(220px, 18vw, 270px)',
    flex: '0 0 clamp(220px, 18vw, 270px)',
    borderRight: '1px solid var(--border)',
    background: 'var(--social-bg)',
    padding: '24px 16px',
    boxSizing: 'border-box',
  },
  brand: {
    margin: '0 0 24px',
    color: 'var(--text-h)',
    fontSize: '22px',
    fontWeight: 700,
  },
  nav: {
    display: 'grid',
    gap: '8px',
  },
  navButton: {
    width: '100%',
    textAlign: 'left',
    minHeight: '44px',
    padding: '10px 12px',
    border: '1px solid transparent',
    borderRadius: '8px',
    background: 'transparent',
    color: 'var(--text-h)',
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: 600,
  },
  activeNavButton: {
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--accent)',
  },
  content: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    maxWidth: '1280px',
    padding: '32px 28px',
    boxSizing: 'border-box',
  },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'end',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '22px',
  },
  pageTitle: {
    margin: 0,
    fontSize: '34px',
    letterSpacing: 0,
  },
  pageHint: {
    marginTop: '4px',
    color: 'var(--text)',
  },
  section: {
    marginBottom: '26px',
  },
  sectionTitle: {
    margin: '0 0 14px',
  },
  dashboardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: '12px',
  },
  statCard: {
    display: 'grid',
    gap: '6px',
    padding: '16px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--social-bg)',
  },
  statLabel: {
    color: 'var(--text)',
    fontSize: '14px',
  },
  statValue: {
    color: 'var(--text-h)',
    fontSize: '24px',
    fontWeight: 700,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
    gap: '16px',
  },
  panel: {
    display: 'grid',
    gap: '12px',
    padding: '20px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg)',
  },
  field: {
    display: 'grid',
    gap: '6px',
  },
  label: {
    color: 'var(--text-h)',
    fontSize: '14px',
    fontWeight: 600,
  },
  input: {
    width: '100%',
    minHeight: '44px',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    boxSizing: 'border-box',
    font: 'inherit',
    background: 'var(--bg)',
    color: 'var(--text-h)',
  },
  textarea: {
    width: '100%',
    minHeight: '76px',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    boxSizing: 'border-box',
    font: 'inherit',
    resize: 'vertical',
    background: 'var(--bg)',
    color: 'var(--text-h)',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  button: {
    minHeight: '44px',
    padding: '10px 16px',
    border: '0',
    borderRadius: '6px',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: 600,
  },
  smallButton: {
    minHeight: '40px',
    padding: '7px 10px',
    border: '0',
    borderRadius: '6px',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  quietButton: {
    minHeight: '40px',
    padding: '7px 10px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg)',
    color: 'var(--text-h)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  dangerButton: {
    minHeight: '40px',
    padding: '7px 10px',
    border: '1px solid #dc2626',
    borderRadius: '6px',
    background: 'transparent',
    color: '#dc2626',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  error: {
    color: '#dc2626',
    fontSize: '14px',
  },
  selectorWrap: {
    position: 'relative',
  },
  selectorList: {
    position: 'absolute',
    zIndex: 4,
    left: 0,
    right: 0,
    top: 'calc(100% + 4px)',
    display: 'grid',
    gap: '4px',
    padding: '8px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg)',
    boxShadow: 'var(--shadow)',
    maxHeight: '260px',
    overflowY: 'auto',
  },
  selectorOption: {
    width: '100%',
    textAlign: 'left',
    padding: '9px 10px',
    border: '0',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--text-h)',
    cursor: 'pointer',
    font: 'inherit',
  },
  selectedText: {
    color: 'var(--text)',
    fontSize: '14px',
  },
  listHeader: {
    display: 'grid',
    gap: '10px',
    marginBottom: '16px',
  },
  list: {
    display: 'grid',
    gap: '12px',
  },
  customer: {
    display: 'grid',
    gap: '10px',
    padding: '16px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--social-bg)',
    cursor: 'pointer',
  },
  customerUnpaid: {
    borderColor: 'rgba(220, 38, 38, 0.45)',
    background: 'rgba(220, 38, 38, 0.06)',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    gap: '12px',
    flexWrap: 'wrap',
    minWidth: 0,
  },
  customerName: {
    color: 'var(--text-h)',
    fontSize: '20px',
    fontWeight: 700,
  },
  balance: {
    color: 'var(--text-h)',
    fontWeight: 700,
  },
  unpaidText: {
    color: '#dc2626',
    fontWeight: 700,
  },
  paidText: {
    color: '#16a34a',
    fontWeight: 700,
  },
  phone: {
    color: 'var(--text)',
  },
  notes: {
    color: 'var(--text)',
    fontSize: '15px',
  },
  editBox: {
    display: 'grid',
    gap: '10px',
    padding: '12px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg)',
  },
  historyItem: {
    display: 'grid',
    gap: '10px',
    padding: '16px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--social-bg)',
  },
  rechargePreviewList: {
    display: 'grid',
    gap: '8px',
    marginTop: '4px',
  },
  rechargePreview: {
    display: 'grid',
    gap: '6px',
    padding: '10px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg)',
  },
  historyTitle: {
    color: 'var(--text-h)',
    fontSize: '17px',
    fontWeight: 700,
  },
  historyMeta: {
    color: 'var(--text)',
    fontSize: '14px',
  },
  status: {
    borderRadius: '999px',
    padding: '3px 9px',
    border: '1px solid var(--border)',
    fontSize: '13px',
    fontWeight: 700,
    textTransform: 'capitalize',
  },
  empty: {
    padding: '16px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    textAlign: 'center',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10,
    display: 'grid',
    placeItems: 'center',
    padding: '20px',
    background: 'rgba(0, 0, 0, 0.45)',
    boxSizing: 'border-box',
  },
  modal: {
    width: 'min(760px, calc(100vw - 24px))',
    maxHeight: 'calc(100svh - 24px)',
    overflowY: 'auto',
    display: 'grid',
    gap: '14px',
    padding: '20px',
    borderRadius: '8px',
    background: 'var(--bg)',
    boxShadow: 'var(--shadow)',
    boxSizing: 'border-box',
  },
  statementBox: {
    display: 'grid',
    gap: '10px',
    padding: '14px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--social-bg)',
  },
  messageBox: {
    whiteSpace: 'pre-wrap',
    padding: '12px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg)',
    color: 'var(--text-h)',
    font: 'inherit',
  },
  authShell: {
    minHeight: '100svh',
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
    boxSizing: 'border-box',
    background: 'var(--social-bg)',
  },
  authCard: {
    width: 'min(420px, 100%)',
    display: 'grid',
    gap: '14px',
    padding: '24px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg)',
    boxShadow: 'var(--shadow)',
    boxSizing: 'border-box',
  },
  sidebarFooter: {
    display: 'grid',
    gap: '8px',
    marginTop: '24px',
  },
}

function App() {
  const customerNameInputRef = useRef(null)
  const mainRechargeCustomerInputRef = useRef(null)
  const quickRechargeAmountInputRef = useRef(null)
  const serviceNameInputRef = useRef(null)

  const [session, setSession] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [isMobileView, setIsMobileView] = useState(() => (
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 768px)').matches
  ))
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [expandedCustomerId, setExpandedCustomerId] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [activePage, setActivePage] = useState('dashboard')
  const [customers, setCustomers] = useState([])
  const [recharges, setRecharges] = useState([])
  const [services, setServices] = useState([])
  const [exchangeRate, setExchangeRate] = useState(() =>
    getSavedValue(exchangeRateStorageKey, defaultExchangeRate)
  )
  const [exchangeRateUpdatedAt, setExchangeRateUpdatedAt] = useState(() =>
    getSavedValue(exchangeRateUpdatedAtStorageKey, '')
  )
  const [exchangeRateError, setExchangeRateError] = useState('')
  const [isUpdatingExchangeRate, setIsUpdatingExchangeRate] = useState(false)
  const [isBackingUpSheets, setIsBackingUpSheets] = useState(false)
  const [sheetsBackupMessage, setSheetsBackupMessage] = useState('')
  const [sheetsBackupError, setSheetsBackupError] = useState('')
  const [monthFilter, setMonthFilter] = useState('all')
  const [customMonth, setCustomMonth] = useState(() => getMonthValue())
  const [newServiceName, setNewServiceName] = useState('')
  const [serviceError, setServiceError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rechargeCustomerId, setRechargeCustomerId] = useState('')
  const [customerSelectorQuery, setCustomerSelectorQuery] = useState('')
  const [isCustomerSelectorOpen, setIsCustomerSelectorOpen] = useState(false)
  const [rechargeService, setRechargeService] = useState('')
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [rechargeNotes, setRechargeNotes] = useState('')
  const [rechargeError, setRechargeError] = useState('')
  const [isRechargeSubmitting, setIsRechargeSubmitting] = useState(false)
  const [lastSelectedService, setLastSelectedService] = useState('')
  const [quickRechargeCustomerId, setQuickRechargeCustomerId] = useState('')
  const [quickRechargeService, setQuickRechargeService] = useState('')
  const [quickRechargeAmount, setQuickRechargeAmount] = useState('')
  const [quickRechargeNotes, setQuickRechargeNotes] = useState('')
  const [quickRechargeError, setQuickRechargeError] = useState('')
  const [isQuickRechargeSubmitting, setIsQuickRechargeSubmitting] = useState(false)
  const [detailCustomerId, setDetailCustomerId] = useState('')
  const [isStatementVisible, setIsStatementVisible] = useState(false)
  const [payingRechargeId, setPayingRechargeId] = useState('')
  const [payingCustomerId, setPayingCustomerId] = useState('')
  const [editingCustomerId, setEditingCustomerId] = useState('')
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editCustomerPhone, setEditCustomerPhone] = useState('')
  const [editCustomerNotes, setEditCustomerNotes] = useState('')
  const [customerEditError, setCustomerEditError] = useState('')
  const [isCustomerEditSubmitting, setIsCustomerEditSubmitting] = useState(false)
  const [deletingCustomerId, setDeletingCustomerId] = useState('')
  const [editingRechargeId, setEditingRechargeId] = useState('')
  const [editRechargeService, setEditRechargeService] = useState('')
  const [editRechargeAmount, setEditRechargeAmount] = useState('')
  const [editRechargeNotes, setEditRechargeNotes] = useState('')
  const [editRechargeStatus, setEditRechargeStatus] = useState('unpaid')
  const [isRechargeEditSubmitting, setIsRechargeEditSubmitting] = useState(false)
  const [deletingRechargeId, setDeletingRechargeId] = useState('')

  async function fetchCustomers() {
    const { data, error } = await supabase
      .from('customers')
      .select('*')

    if (error) {
      console.log('Error fetching customers:', error)
    } else {
      setCustomers(data || [])
    }
  }

  async function fetchRecharges() {
    const { data, error } = await supabase
      .from('recharges')
      .select('*')

    if (error) {
      console.log('Error fetching recharges:', error)
    } else {
      setRecharges(data || [])
    }
  }

  async function seedDefaultServices() {
    const { error } = await supabase
      .from('services')
      .insert(defaultServices.map((service) => ({ name: service })))

    if (error) {
      console.log('Error creating default services:', error)
    } else {
      await fetchServices()
    }
  }

  async function fetchServices() {
    const { data, error } = await supabase
      .from('services')
      .select('*')

    if (error) {
      console.log('Error fetching services:', error)
      setServices([])
      return
    }

    if ((data || []).length === 0) {
      await seedDefaultServices()
      return
    }

    setServices(data || [])
  }

  async function refreshData() {
    await Promise.all([fetchCustomers(), fetchRecharges()])
  }

  function clearAppData() {
    setCustomers([])
    setRecharges([])
    setServices([])
    setRechargeCustomerId('')
    setCustomerSelectorQuery('')
    setQuickRechargeCustomerId('')
    setDetailCustomerId('')
    setIsStatementVisible(false)
    setExpandedCustomerId('')
    setEditingCustomerId('')
    setEditingRechargeId('')
  }

  async function handleLoginSubmit(event) {
    event.preventDefault()

    try {
      setIsLoggingIn(true)
      setLoginError('')

      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      })

      if (error) {
        console.log('Error logging in:', error)
        setLoginError(error.message || 'Could not log in. Check your email and password.')
      } else {
        setSession(data.session)
        setLoginPassword('')
      }
    } finally {
      setIsLoggingIn(false)
    }
  }

  async function handleLogout() {
    try {
      setIsLoggingOut(true)

      const { error } = await supabase.auth.signOut()

      if (error) {
        console.log('Error logging out:', error)
      } else {
        setSession(null)
        clearAppData()
      }
    } finally {
      setIsLoggingOut(false)
    }
  }

  function handleExchangeRateChange(value) {
    const updatedAt = new Date().toISOString()

    setExchangeRate(value)
    setExchangeRateUpdatedAt(updatedAt)
    setExchangeRateError('')
    saveExchangeRate(value, updatedAt)
  }

  async function updateExchangeRate() {
    try {
      setIsUpdatingExchangeRate(true)
      setExchangeRateError('')

      // This no-key endpoint can be replaced later if you choose a preferred rate provider.
      const response = await fetch('https://open.er-api.com/v6/latest/USD')

      if (!response.ok) {
        throw new Error(`Exchange rate request failed with ${response.status}`)
      }

      const data = await response.json()
      const nextRate = Number(data?.rates?.LBP)

      if (!Number.isFinite(nextRate) || nextRate <= 0) {
        throw new Error('Exchange rate response did not include a valid LBP rate.')
      }

      const updatedAt = new Date().toISOString()
      const roundedRate = String(Math.round(nextRate))

      setExchangeRate(roundedRate)
      setExchangeRateUpdatedAt(updatedAt)
      saveExchangeRate(roundedRate, updatedAt)
    } catch (error) {
      console.log('Error updating exchange rate:', error)
      setExchangeRateError('Could not update exchange rate. Using the saved/manual rate.')
    } finally {
      setIsUpdatingExchangeRate(false)
    }
  }

  async function backupToGoogleSheets() {
    try {
      setIsBackingUpSheets(true)
      setSheetsBackupMessage('')
      setSheetsBackupError('')

      if (
        googleSheetsBackupUrl === 'YOUR_WEB_APP_URL' ||
        googleSheetsBackupSecret === 'YOUR_SECRET_KEY'
      ) {
        throw new Error('Add your Google Apps Script URL and secret key in App.jsx first.')
      }

      const [
        customersResult,
        rechargesResult,
        servicesResult,
      ] = await Promise.all([
        supabase.from('customers').select('*'),
        supabase.from('recharges').select('*'),
        supabase.from('services').select('*'),
      ])

      if (customersResult.error) {
        throw customersResult.error
      }

      if (rechargesResult.error) {
        throw rechargesResult.error
      }

      if (servicesResult.error) {
        throw servicesResult.error
      }

      const customers = customersResult.data || []
      const recharges = rechargesResult.data || []
      const services = servicesResult.data || []

      const backupCustomers = customers.map((customer) => ({
        'Customer Name': customer.name || '',
        Phone: formatStoredPhone(customer.phone),
        Notes: customer.notes || '',
        Active: formatBackupActive(customer.is_active),
        'Created Date': formatBackupDate(customer.created_at),
      }))
      const backupCustomersById = customers.reduce((lookup, customer) => {
        lookup[String(customer.id)] = customer
        return lookup
      }, {})
      const backupRecharges = recharges.map((recharge) => {
        const customer = backupCustomersById[String(recharge.customer_id)]
        const amountLbp = Math.round(Number(recharge.amount) || 0)

        return {
          Date: formatBackupDate(recharge.created_at),
          'Customer Name': customer?.name || '',
          Phone: formatStoredPhone(customer?.phone),
          Service: cleanBackupServiceName(recharge.service),
          'Amount LBP': formatBackupLbp(amountLbp),
          'Amount USD': formatBackupUsd(amountLbp, exchangeRate),
          Status: recharge.status || '',
          Notes: recharge.notes || '',
        }
      })
      const backupServices = services.map((service) => ({
        'Service Name': cleanBackupServiceName(getServiceName(service)),
        'Created Date': formatBackupDate(service.created_at),
      }))

      console.log('Backup customers:', backupCustomers)
      console.log('Backup recharges:', backupRecharges)
      console.log('Backup services:', backupServices)

      await fetch(googleSheetsBackupUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify({
          secret: googleSheetsBackupSecret,
          customers: backupCustomers,
          recharges: backupRecharges,
          services: backupServices,
        }),
      })

      setSheetsBackupMessage('Backup sent. Check Google Sheet to confirm.')
    } catch (error) {
      console.log('Error backing up to Google Sheets:', error)
      setSheetsBackupError(error.message || 'Could not backup to Google Sheets.')
    } finally {
      setIsBackingUpSheets(false)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const updateMobileView = () => {
      setIsMobileView(mediaQuery.matches)

      if (!mediaQuery.matches) {
        setIsMobileMenuOpen(false)
      }
    }

    updateMobileView()
    mediaQuery.addEventListener('change', updateMobileView)

    return () => {
      mediaQuery.removeEventListener('change', updateMobileView)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isCurrent) {
        return
      }

      if (error) {
        console.log('Error checking auth session:', error)
      }

      setSession(data?.session || null)
      setIsAuthLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isCurrent) {
        return
      }

      setSession(nextSession)
      setIsAuthLoading(false)

      if (!nextSession) {
        clearAppData()
      }
    })

    return () => {
      isCurrent = false
      authListener?.subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      return
    }

    let isCurrent = true

    Promise.all([
      supabase.from('customers').select('*'),
      supabase.from('recharges').select('*'),
      supabase.from('services').select('*'),
    ]).then(([customersResult, rechargesResult, servicesResult]) => {
      if (!isCurrent) {
        return
      }

      if (customersResult.error) {
        console.log('Error fetching customers:', customersResult.error)
      } else {
        setCustomers(customersResult.data || [])
      }

      if (rechargesResult.error) {
        console.log('Error fetching recharges:', rechargesResult.error)
      } else {
        setRecharges(rechargesResult.data || [])
      }

      if (servicesResult.error) {
        console.log('Error fetching services:', servicesResult.error)
      } else if ((servicesResult.data || []).length === 0) {
        supabase
          .from('services')
          .insert(defaultServices.map((service) => ({ name: service })))
          .then(({ error }) => {
            if (error) {
              console.log('Error creating default services:', error)
              return
            }

            supabase
              .from('services')
              .select('*')
              .then((nextServicesResult) => {
                if (!isCurrent) {
                  return
                }

                if (nextServicesResult.error) {
                  console.log('Error fetching services:', nextServicesResult.error)
                } else {
                  setServices(nextServicesResult.data || [])
                }
              })
          })
      } else {
        setServices(servicesResult.data || [])
      }
    })

    return () => {
      isCurrent = false
    }
  }, [session])

  const serviceNames = services
    .map(getServiceName)
    .filter(Boolean)
    .filter((service, index, allServices) => allServices.indexOf(service) === index)
    .sort((firstService, secondService) => firstService.localeCompare(secondService))
  const serviceCounts = recharges.reduce((counts, recharge) => {
    const service = String(recharge.service || '')
    counts[service] = (counts[service] || 0) + 1
    return counts
  }, {})
  const mostUsedService = serviceNames.reduce((currentBest, service) => {
    if (!currentBest) {
      return service
    }

    return (serviceCounts[service] || 0) > (serviceCounts[currentBest] || 0)
      ? service
      : currentBest
  }, '')
  const preferredService = (
    serviceNames.includes(lastSelectedService)
      ? lastSelectedService
      : mostUsedService || serviceNames[0] || ''
  )
  const selectedRechargeService = serviceNames.includes(rechargeService)
    ? rechargeService
    : preferredService
  const selectedQuickRechargeService = serviceNames.includes(quickRechargeService)
    ? quickRechargeService
    : preferredService

  async function addRechargeToSupabase(customerId, service, amountInThousands, notes) {
    const parsedAmount = Number(amountInThousands)
    const cleanService = String(service || '').trim()

    if (!customerId || !cleanService || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return { error: { message: 'Please choose a customer, service, and a valid amount.' } }
    }

    return supabase
      .from('recharges')
      .insert([{
        customer_id: customerId,
        service: cleanService,
        amount: parsedAmount * 1000,
        notes: notes.trim() || null,
        status: 'unpaid',
      }])
  }

  async function handleCustomerSubmit(event) {
    event.preventDefault()

    const trimmedName = name.trim()
    const cleanPhone = cleanPhoneInput(phone)
    const trimmedNotes = customerNotes.trim()

    if (!trimmedName) {
      setFormError('Please enter a customer name.')
      return
    }

    if (cleanPhone.length !== 8) {
      setFormError('Phone number must be exactly 8 digits.')
      return
    }

    try {
      setIsSubmitting(true)
      setFormError('')

      const { error } = await supabase
        .from('customers')
        .insert([{
          name: trimmedName,
          phone: cleanPhone,
          notes: trimmedNotes || null,
        }])

      if (error) {
        console.log('Error adding customer:', error)
        setFormError(error.message || 'Could not add customer.')
      } else {
        setName('')
        setPhone('')
        setCustomerNotes('')
        await fetchCustomers()
        customerNameInputRef.current?.focus()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRechargeSubmit(event) {
    event.preventDefault()

    try {
      setIsRechargeSubmitting(true)
      setRechargeError('')

      const { error } = await addRechargeToSupabase(
        rechargeCustomerId,
        selectedRechargeService,
        rechargeAmount,
        rechargeNotes
      )

      if (error) {
        console.log('Error adding recharge:', error)
        setRechargeError(error.message || 'Could not add recharge.')
      } else {
        setLastSelectedService(selectedRechargeService)
        setRechargeCustomerId('')
        setCustomerSelectorQuery('')
        setRechargeAmount('')
        setRechargeNotes('')
        await fetchRecharges()
        mainRechargeCustomerInputRef.current?.focus()
      }
    } finally {
      setIsRechargeSubmitting(false)
    }
  }

  function openQuickRecharge(customerId) {
    setQuickRechargeCustomerId(String(customerId))
    setQuickRechargeService(preferredService)
    setQuickRechargeAmount('')
    setQuickRechargeNotes('')
    setQuickRechargeError('')
    setTimeout(() => quickRechargeAmountInputRef.current?.focus(), 0)
  }

  function closeQuickRecharge() {
    setQuickRechargeCustomerId('')
    setQuickRechargeService('')
    setQuickRechargeAmount('')
    setQuickRechargeNotes('')
    setQuickRechargeError('')
  }

  function closeCustomerDetail() {
    setDetailCustomerId('')
    setIsStatementVisible(false)
  }

  function openCustomerDetail(customerId) {
    setDetailCustomerId(String(customerId))
    setIsStatementVisible(false)
  }

  function openMobileCustomerEdit(customer) {
    openCustomerDetail(customer.id)
    startEditingCustomer(customer)
    setExpandedCustomerId('')
  }

  async function handleQuickRechargeSubmit(event) {
    event.preventDefault()

    try {
      setIsQuickRechargeSubmitting(true)
      setQuickRechargeError('')

      const { error } = await addRechargeToSupabase(
        quickRechargeCustomerId,
        selectedQuickRechargeService,
        quickRechargeAmount,
        quickRechargeNotes
      )

      if (error) {
        console.log('Error adding quick recharge:', error)
        setQuickRechargeError(error.message || 'Could not add quick recharge.')
      } else {
        setLastSelectedService(selectedQuickRechargeService)
        closeQuickRecharge()
        await fetchRecharges()
      }
    } finally {
      setIsQuickRechargeSubmitting(false)
    }
  }

  function startEditingCustomer(customer) {
    setEditingCustomerId(String(customer.id))
    setEditCustomerName(customer.name || '')
    setEditCustomerPhone(cleanPhoneInput(customer.phone))
    setEditCustomerNotes(customer.notes || '')
    setCustomerEditError('')
  }

  function cancelEditingCustomer() {
    setEditingCustomerId('')
    setEditCustomerName('')
    setEditCustomerPhone('')
    setEditCustomerNotes('')
    setCustomerEditError('')
  }

  async function handleCustomerEditSubmit(event) {
    event.preventDefault()

    const trimmedName = editCustomerName.trim()
    const cleanPhone = cleanPhoneInput(editCustomerPhone)
    const trimmedNotes = editCustomerNotes.trim()

    if (!trimmedName) {
      setCustomerEditError('Please enter a customer name.')
      return
    }

    if (cleanPhone.length !== 8) {
      setCustomerEditError('Phone number must be exactly 8 digits.')
      return
    }

    try {
      setIsCustomerEditSubmitting(true)
      setCustomerEditError('')

      const { error } = await supabase
        .from('customers')
        .update({
          name: trimmedName,
          phone: cleanPhone,
          notes: trimmedNotes || null,
        })
        .eq('id', editingCustomerId)

      if (error) {
        console.log('Error editing customer:', error)
        setCustomerEditError(error.message || 'Could not edit customer.')
      } else {
        cancelEditingCustomer()
        await fetchCustomers()
      }
    } finally {
      setIsCustomerEditSubmitting(false)
    }
  }

  async function handleDeleteCustomer(customerId) {
    if (!window.confirm('Delete this customer?')) {
      return
    }

    try {
      setDeletingCustomerId(String(customerId))

      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId)

      if (error) {
        console.log('Error deleting customer:', error)
      } else {
        await refreshData()
      }
    } finally {
      setDeletingCustomerId('')
    }
  }

  async function handleMarkRechargePaid(rechargeId) {
    try {
      setPayingRechargeId(String(rechargeId))

      const { error } = await supabase
        .from('recharges')
        .update({ status: 'paid' })
        .eq('id', rechargeId)

      if (error) {
        console.log('Error marking recharge as paid:', error)
      } else {
        await fetchRecharges()
      }
    } finally {
      setPayingRechargeId('')
    }
  }

  async function handleMarkAllPaid(customerId) {
    try {
      setPayingCustomerId(String(customerId))

      const { error } = await supabase
        .from('recharges')
        .update({ status: 'paid' })
        .eq('customer_id', customerId)
        .eq('status', 'unpaid')

      if (error) {
        console.log('Error marking all customer recharges as paid:', error)
      } else {
        await fetchRecharges()
      }
    } finally {
      setPayingCustomerId('')
    }
  }

  function startEditingRecharge(recharge) {
    setEditingRechargeId(String(recharge.id))
    setEditRechargeService(recharge.service || preferredService)
    setEditRechargeAmount(getThousandsFromLbp(recharge.amount))
    setEditRechargeNotes(recharge.notes || '')
    setEditRechargeStatus(recharge.status || 'unpaid')
  }

  function cancelEditingRecharge() {
    setEditingRechargeId('')
    setEditRechargeService('')
    setEditRechargeAmount('')
    setEditRechargeNotes('')
    setEditRechargeStatus('unpaid')
  }

  async function handleRechargeEditSubmit(event) {
    event.preventDefault()

    const parsedAmount = Number(editRechargeAmount)
    const cleanService = editRechargeService || preferredService
    const trimmedNotes = editRechargeNotes.trim()

    if (!cleanService || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      console.log('Error editing recharge: service and a valid amount are required.')
      return
    }

    try {
      setIsRechargeEditSubmitting(true)

      const { error } = await supabase
        .from('recharges')
        .update({
          service: cleanService,
          amount: parsedAmount * 1000,
          notes: trimmedNotes || null,
          status: editRechargeStatus,
        })
        .eq('id', editingRechargeId)

      if (error) {
        console.log('Error editing recharge:', error)
      } else {
        setLastSelectedService(cleanService)
        cancelEditingRecharge()
        await fetchRecharges()
      }
    } finally {
      setIsRechargeEditSubmitting(false)
    }
  }

  async function handleDeleteRecharge(rechargeId) {
    if (!window.confirm('Delete this recharge?')) {
      return
    }

    try {
      setDeletingRechargeId(String(rechargeId))

      const { error } = await supabase
        .from('recharges')
        .delete()
        .eq('id', rechargeId)

      if (error) {
        console.log('Error deleting recharge:', error)
      } else {
        await fetchRecharges()
      }
    } finally {
      setDeletingRechargeId('')
    }
  }

  async function handleAddService(event) {
    event.preventDefault()

    const trimmedService = newServiceName.trim()

    if (!trimmedService) {
      setServiceError('Please enter a service name.')
      return
    }

    const alreadyExists = serviceNames.some(
      (service) => service.toLowerCase() === trimmedService.toLowerCase()
    )

    if (alreadyExists) {
      setServiceError('That service already exists.')
      return
    }

    const { error } = await supabase
      .from('services')
      .insert([{ name: trimmedService }])

    if (error) {
      console.log('Error adding service:', error)
      setServiceError(error.message || 'Could not add service.')
    } else {
      setNewServiceName('')
      setServiceError('')
      setLastSelectedService(trimmedService)
      await fetchServices()
      serviceNameInputRef.current?.focus()
    }
  }

  async function handleDeleteService(service) {
    if (!window.confirm('Delete this service?')) {
      return
    }

    const serviceName = getServiceName(service)
    let query = supabase.from('services').delete()

    if (service.id) {
      query = query.eq('id', service.id)
    } else {
      query = query.eq('name', serviceName)
    }

    const { error } = await query

    if (error) {
      console.log('Error deleting service:', error)
      setServiceError(error.message || 'Could not delete service.')
    } else {
      if (lastSelectedService === serviceName) {
        setLastSelectedService('')
      }

      if (rechargeService === serviceName) {
        setRechargeService('')
      }

      if (quickRechargeService === serviceName) {
        setQuickRechargeService('')
      }

      if (editRechargeService === serviceName) {
        setEditRechargeService('')
      }

      setServiceError('')
      await fetchServices()
    }
  }

  function selectRechargeCustomer(customer) {
    setRechargeCustomerId(String(customer.id))
    setCustomerSelectorQuery(getCustomerLabel(customer))
    setIsCustomerSelectorOpen(false)
  }

  function exportData() {
    const rows = [
      [
        'record_type',
        'id',
        'customer_id',
        'customer_name',
        'phone',
        'service',
        'amount_lbp',
        'amount_usd',
        'status',
        'notes',
        'created_at',
      ],
      ...customers.map((customer) => [
        'customer',
        customer.id,
        '',
        customer.name || '',
        getPhoneDigits(customer.phone),
        '',
        '',
        '',
        '',
        customer.notes || '',
        customer.created_at || '',
      ]),
      ...recharges.map((recharge) => {
        const customer = customersById[String(recharge.customer_id)]

        return [
          'recharge',
          recharge.id,
          recharge.customer_id || '',
          customer?.name || '',
          getPhoneDigits(customer?.phone),
          recharge.service || '',
          Math.round(Number(recharge.amount) || 0),
          formatUsdFromLbp(recharge.amount, exchangeRate).replace('$', ''),
          recharge.status || '',
          recharge.notes || '',
          recharge.created_at || '',
        ]
      }),
    ]
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'recharge-tracker-export.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportMonthSummary() {
    const rows = [
      [
        'selected_period',
        'customer_name',
        'phone',
        'total_unpaid_lbp',
        'total_unpaid_usd',
      ],
      ...monthSummaryCustomers.map(({ customer, balance }) => [
        selectedMonthLabel,
        customer.name || '',
        getPhoneDigits(customer.phone),
        Math.round(Number(balance) || 0),
        formatUsdFromLbpDetailed(balance, exchangeRate).replace('$', ''),
      ]),
    ]
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const fileNameMonth = getSelectedMonthValue(monthFilter, customMonth) || 'all-time'

    link.href = url
    link.download = `end-of-month-summary-${fileNameMonth}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function copyWhatsAppMessage(message) {
    try {
      await navigator.clipboard.writeText(message)
    } catch (error) {
      console.log('Error copying WhatsApp message:', error)
    }
  }

  function sendWhatsAppMessage(customer, message) {
    const phoneDigits = getPhoneDigits(customer?.phone)
    const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const customersById = customers.reduce((lookup, customer) => {
    lookup[String(customer.id)] = customer
    return lookup
  }, {})
  const sortedAllRecharges = [...recharges].sort((firstRecharge, secondRecharge) => {
    const firstDate = new Date(firstRecharge.created_at || 0).getTime()
    const secondDate = new Date(secondRecharge.created_at || 0).getTime()

    return secondDate - firstDate
  })
  const allRechargesByCustomer = sortedAllRecharges.reduce((groups, recharge) => {
    const customerId = String(recharge.customer_id || '')

    if (!groups[customerId]) {
      groups[customerId] = []
    }

    groups[customerId].push(recharge)
    return groups
  }, {})
  const visibleRecharges = recharges.filter((recharge) =>
    rechargeMatchesMonth(recharge, monthFilter, customMonth)
  )
  const sortedRecharges = [...visibleRecharges].sort((firstRecharge, secondRecharge) => {
    const firstDate = new Date(firstRecharge.created_at || 0).getTime()
    const secondDate = new Date(secondRecharge.created_at || 0).getTime()

    return secondDate - firstDate
  })
  const unpaidRecharges = visibleRecharges.filter(
    (recharge) => String(recharge.status || '').toLowerCase() === 'unpaid'
  )
  const unpaidBalances = unpaidRecharges.reduce((balances, recharge) => {
    const customerId = String(recharge.customer_id || '')
    const amount = Number(recharge.amount) || 0

    balances[customerId] = (balances[customerId] || 0) + amount
    return balances
  }, {})
  const rechargesByCustomer = sortedRecharges.reduce((groups, recharge) => {
    const customerId = String(recharge.customer_id || '')

    if (!groups[customerId]) {
      groups[customerId] = []
    }

    groups[customerId].push(recharge)
    return groups
  }, {})
  const totalUnpaid = Object.values(unpaidBalances).reduce(
    (total, amount) => total + amount,
    0
  )
  const selectedMonthLabel = getSelectedMonthLabel(monthFilter, customMonth)
  const exchangeRateNumber = Number(exchangeRate)
  const formattedCurrentRate = Number.isFinite(exchangeRateNumber) && exchangeRateNumber > 0
    ? exchangeRateNumber.toLocaleString('en-US')
    : '0'
  const formattedExchangeRateUpdatedAt = exchangeRateUpdatedAt
    ? new Date(exchangeRateUpdatedAt).toLocaleString()
    : 'Not updated yet'
  const isSubmitDisabled = isSubmitting || !name.trim() || cleanPhoneInput(phone).length !== 8
  const rechargeAmountNumber = Number(rechargeAmount)
  const isRechargeSubmitDisabled = (
    isRechargeSubmitting ||
    !rechargeCustomerId ||
    !selectedRechargeService ||
    !Number.isFinite(rechargeAmountNumber) ||
    rechargeAmountNumber <= 0
  )
  const quickRechargeAmountNumber = Number(quickRechargeAmount)
  const isQuickRechargeSubmitDisabled = (
    isQuickRechargeSubmitting ||
    !quickRechargeCustomerId ||
    !selectedQuickRechargeService ||
    !Number.isFinite(quickRechargeAmountNumber) ||
    quickRechargeAmountNumber <= 0
  )
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const searchDigits = getPhoneDigits(searchTerm)
  const sortedCustomers = [...customers].sort((firstCustomer, secondCustomer) =>
    String(firstCustomer.name || '').localeCompare(String(secondCustomer.name || ''))
  )
  const filteredCustomers = sortedCustomers.filter((customer) => {
    const customerName = String(customer.name || '').toLowerCase()
    const rawPhone = String(customer.phone || '').toLowerCase()
    const formattedPhone = formatStoredPhone(customer.phone).toLowerCase()
    const phoneDigits = getPhoneDigits(customer.phone)

    return (
      customerName.includes(normalizedSearchTerm) ||
      rawPhone.includes(normalizedSearchTerm) ||
      formattedPhone.includes(normalizedSearchTerm) ||
      (searchDigits && phoneDigits.includes(searchDigits))
    )
  })
  const monthSummaryCustomers = sortedCustomers
    .map((customer) => ({
      customer,
      balance: unpaidBalances[String(customer.id)] || 0,
    }))
    .filter(({ balance }) => balance > 0)
  const selectorQuery = customerSelectorQuery.trim().toLowerCase()
  const selectorDigits = getPhoneDigits(customerSelectorQuery)
  const filteredSelectorCustomers = sortedCustomers.filter((customer) => {
    const customerName = String(customer.name || '').toLowerCase()
    const formattedPhone = formatStoredPhone(customer.phone).toLowerCase()
    const phoneDigits = getPhoneDigits(customer.phone)

    return (
      !selectorQuery ||
      customerName.includes(selectorQuery) ||
      formattedPhone.includes(selectorQuery) ||
      (selectorDigits && phoneDigits.includes(selectorDigits))
    )
  }).slice(0, 8)
  const hasCustomers = customers.length > 0
  const hasMatchingCustomers = filteredCustomers.length > 0
  const activePageLabel = mobilePages.find((page) => page.id === activePage)?.label || 'Dashboard'
  const detailCustomer = customersById[String(detailCustomerId)]
  const quickRechargeCustomer = customersById[String(quickRechargeCustomerId)]

  function renderServiceSelect(value, onChange, includeExistingService = '') {
    const options = serviceNames.includes(includeExistingService) || !includeExistingService
      ? serviceNames
      : [includeExistingService, ...serviceNames]

    return (
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setLastSelectedService(event.target.value)
        }}
        style={styles.input}
      >
        {options.length === 0 && (
          <option value="">Add a service first</option>
        )}
        {options.map((service) => (
          <option key={service} value={service}>
            {service}
          </option>
        ))}
      </select>
    )
  }

  function renderCustomerSelector() {
    return (
      <div style={styles.selectorWrap}>
        <input
          ref={mainRechargeCustomerInputRef}
          type="search"
          value={customerSelectorQuery}
          onChange={(event) => {
            setCustomerSelectorQuery(event.target.value)
            setRechargeCustomerId('')
            setIsCustomerSelectorOpen(true)
          }}
          onFocus={() => setIsCustomerSelectorOpen(true)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              isCustomerSelectorOpen &&
              !rechargeCustomerId &&
              filteredSelectorCustomers.length > 0
            ) {
              event.preventDefault()
              selectRechargeCustomer(filteredSelectorCustomers[0])
            }
          }}
          placeholder="Type customer name or phone"
          style={styles.input}
        />

        {rechargeCustomerId && (
          <p style={styles.selectedText}>
            Selected: {getCustomerLabel(customersById[String(rechargeCustomerId)])}
          </p>
        )}

        {isCustomerSelectorOpen && (
          <div style={styles.selectorList}>
            {filteredSelectorCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectRechargeCustomer(customer)}
                style={styles.selectorOption}
              >
                {getCustomerLabel(customer)}
              </button>
            ))}

            {filteredSelectorCustomers.length === 0 && (
              <p style={styles.empty}>No customers found.</p>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderRechargeActions(recharge) {
    const isPaid = String(recharge.status || '').toLowerCase() === 'paid'
    const isPayingRecharge = payingRechargeId === String(recharge.id)
    const isDeletingRecharge = deletingRechargeId === String(recharge.id)

    return (
      <div className="rt-actions" style={styles.actions}>
        {!isPaid && (
          <button
            type="button"
            disabled={isPayingRecharge}
            onClick={() => handleMarkRechargePaid(recharge.id)}
            style={{
              ...styles.smallButton,
              opacity: isPayingRecharge ? 0.6 : 1,
            }}
          >
            {isPayingRecharge ? 'Updating...' : 'Mark as Paid'}
          </button>
        )}
        <button
          type="button"
          onClick={() => startEditingRecharge(recharge)}
          style={styles.quietButton}
        >
          Edit Recharge
        </button>
        <button
          type="button"
          disabled={isDeletingRecharge}
          onClick={() => handleDeleteRecharge(recharge.id)}
          style={{
            ...styles.dangerButton,
            opacity: isDeletingRecharge ? 0.6 : 1,
          }}
        >
          {isDeletingRecharge ? 'Deleting...' : 'Delete Recharge'}
        </button>
      </div>
    )
  }

  function renderRechargeEditForm() {
    return (
      <form className="rt-panel" onSubmit={handleRechargeEditSubmit} style={styles.editBox}>
        <label style={styles.field}>
          <span style={styles.label}>Service</span>
          {renderServiceSelect(
            editRechargeService || preferredService,
            setEditRechargeService,
            editRechargeService
          )}
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Amount (in thousands LBP)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={editRechargeAmount}
            onChange={(event) => setEditRechargeAmount(event.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Status</span>
          <select
            value={editRechargeStatus}
            onChange={(event) => setEditRechargeStatus(event.target.value)}
            style={styles.input}
          >
            {rechargeStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Notes</span>
          <textarea
            value={editRechargeNotes}
            onChange={(event) => setEditRechargeNotes(event.target.value)}
            style={styles.textarea}
          />
        </label>
        <div className="rt-actions" style={styles.actions}>
          <button
            type="submit"
            disabled={isRechargeEditSubmitting}
            style={{
              ...styles.smallButton,
              opacity: isRechargeEditSubmitting ? 0.6 : 1,
            }}
          >
            {isRechargeEditSubmitting ? 'Saving...' : 'Save recharge'}
          </button>
          <button
            type="button"
            onClick={cancelEditingRecharge}
            style={styles.quietButton}
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  function renderRechargeCard(recharge, showCustomerName = true) {
    const customer = customersById[String(recharge.customer_id)]
    const isPaid = String(recharge.status || '').toLowerCase() === 'paid'
    const isEditingRecharge = editingRechargeId === String(recharge.id)
    const formattedDate = recharge.created_at
      ? new Date(recharge.created_at).toLocaleDateString()
      : ''

    return (
      <div className="rt-history-card" key={recharge.id} style={styles.historyItem}>
        <div className="rt-card-top" style={styles.cardTop}>
          <div>
            <p style={styles.historyTitle}>
              {showCustomerName ? `${customer?.name || 'Unknown customer'} - ` : ''}
              {recharge.service || 'Recharge'}
            </p>
            <p style={styles.historyMeta}>
              {formatLbp(recharge.amount)} / {formatUsdFromLbp(recharge.amount, exchangeRate)}
            </p>
            {formattedDate && (
              <p style={styles.historyMeta}>{formattedDate}</p>
            )}
          </div>
          <span
            className={`rt-status ${isPaid ? 'rt-status-paid' : 'rt-status-unpaid'}`}
            style={{
              ...styles.status,
              ...(isPaid ? styles.paidText : styles.unpaidText),
            }}
          >
            {recharge.status || 'unpaid'}
          </span>
        </div>

        {recharge.notes && (
          <p style={styles.notes}>Notes: {recharge.notes}</p>
        )}

        {isEditingRecharge ? renderRechargeEditForm() : renderRechargeActions(recharge)}
      </div>
    )
  }

  function renderMonthFilterPanel(extraClassName = '') {
    return (
      <div className={`rt-panel rt-month-filter-panel ${extraClassName}`} style={styles.panel}>
        <h2 style={styles.sectionTitle}>Month Filter</h2>
        <label style={styles.field}>
          <span style={styles.label}>Selected period</span>
          <select
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            style={styles.input}
          >
            <option value="all">All time</option>
            <option value="this">This month</option>
            <option value="last">Last month</option>
            <option value="custom">Custom month</option>
          </select>
        </label>

        {monthFilter === 'custom' && (
          <label style={styles.field}>
            <span style={styles.label}>Custom month</span>
            <input
              type="month"
              value={customMonth}
              onChange={(event) => setCustomMonth(event.target.value)}
              style={styles.input}
            />
          </label>
        )}

        <p style={styles.historyMeta}>Showing: {selectedMonthLabel}</p>
      </div>
    )
  }

  function renderExchangeRatePanel(extraClassName = '') {
    return (
      <div className={`rt-panel rt-exchange-panel ${extraClassName}`} style={styles.panel}>
        <h2 style={styles.sectionTitle}>Exchange Rate</h2>
        <p style={styles.historyTitle}>
          Current rate: 1 USD = {formattedCurrentRate} LBP
        </p>
        <p style={styles.historyMeta}>Last updated: {formattedExchangeRateUpdatedAt}</p>

        <label style={styles.field}>
          <span style={styles.label}>Manual exchange rate</span>
          <input
            type="number"
            min="1"
            step="1000"
            value={exchangeRate}
            onChange={(event) => handleExchangeRateChange(event.target.value)}
            style={styles.input}
          />
        </label>

        {exchangeRateError && <p style={styles.error}>{exchangeRateError}</p>}

        <div className="rt-actions" style={styles.actions}>
          <button
            type="button"
            disabled={isUpdatingExchangeRate}
            onClick={updateExchangeRate}
            style={{
              ...styles.button,
              opacity: isUpdatingExchangeRate ? 0.6 : 1,
            }}
          >
            {isUpdatingExchangeRate ? 'Updating...' : 'Update Exchange Rate'}
          </button>
          <button type="button" onClick={exportData} style={styles.quietButton}>
            Export Data
          </button>
        </div>
      </div>
    )
  }

  function renderGoogleSheetsBackupPanel(extraClassName = '') {
    return (
      <div className={`rt-panel rt-backup-panel ${extraClassName}`} style={styles.panel}>
        <h2 style={styles.sectionTitle}>Google Sheets Backup</h2>
        <p style={styles.historyMeta}>
          Send all customers, recharges, and services to your Google Apps Script backup.
        </p>

        {sheetsBackupMessage && <p style={styles.paidText}>{sheetsBackupMessage}</p>}
        {sheetsBackupError && <p style={styles.error}>{sheetsBackupError}</p>}

        <button
          type="button"
          disabled={isBackingUpSheets}
          onClick={backupToGoogleSheets}
          style={{
            ...styles.button,
            justifySelf: 'start',
            opacity: isBackingUpSheets ? 0.6 : 1,
          }}
        >
          {isBackingUpSheets ? 'Backing up...' : 'Backup to Google Sheets'}
        </button>
      </div>
    )
  }

  function renderEndOfMonthSummary(extraClassName = '') {
    return (
      <section className={`rt-summary-section ${extraClassName}`} style={styles.section}>
        <div className="rt-panel" style={styles.panel}>
          <div className="rt-card-top" style={styles.cardTop}>
            <div>
              <h2 style={styles.sectionTitle}>End of Month Summary</h2>
              <p style={styles.historyMeta}>
                Customers who still owe money for {selectedMonthLabel}.
              </p>
            </div>
            <button type="button" onClick={exportMonthSummary} style={styles.quietButton}>
              Export Selected Month Summary
            </button>
          </div>

          <div className="rt-list rt-summary-list" style={styles.list}>
            {monthSummaryCustomers.map(({ customer, balance }) => (
              <div className="rt-history-card" key={customer.id} style={styles.historyItem}>
                <div className="rt-card-top" style={styles.cardTop}>
                  <div>
                    <p style={styles.historyTitle}>{customer.name}</p>
                    <p style={styles.phone}>{formatStoredPhone(customer.phone)}</p>
                  </div>
                  <p style={styles.unpaidText}>
                    {formatLbp(balance)} / {formatUsdFromLbp(balance, exchangeRate)}
                  </p>
                </div>
              </div>
            ))}

            {monthSummaryCustomers.length === 0 && (
              <p style={styles.empty}>No unpaid balances for this period.</p>
            )}
          </div>
        </div>
      </section>
    )
  }

  function renderDashboardPage() {
    return (
      <div className="rt-dashboard-page">
        <section className="rt-dashboard-top-tools" style={styles.section}>
          <div className="rt-grid" style={styles.grid}>
            {renderMonthFilterPanel()}
            {renderExchangeRatePanel('rt-dashboard-tool-panel')}
            {renderGoogleSheetsBackupPanel('rt-dashboard-tool-panel')}
          </div>
        </section>

        <section style={styles.section}>
          <div className="rt-dashboard-grid" style={styles.dashboardGrid}>
            <div className="rt-stat-card" style={styles.statCard}>
              <p style={styles.statLabel}>Total unpaid LBP</p>
              <p style={styles.statValue}>{formatLbp(totalUnpaid)}</p>
            </div>
            <div className="rt-stat-card" style={styles.statCard}>
              <p style={styles.statLabel}>Total unpaid USD</p>
              <p style={styles.statValue}>{formatUsdFromLbp(totalUnpaid, exchangeRate)}</p>
            </div>
            <div className="rt-stat-card" style={styles.statCard}>
              <p style={styles.statLabel}>Customers</p>
              <p style={styles.statValue}>{customers.length}</p>
            </div>
            <div className="rt-stat-card" style={styles.statCard}>
              <p style={styles.statLabel}>Unpaid recharges</p>
              <p style={styles.statValue}>{unpaidRecharges.length}</p>
            </div>
            <div className="rt-stat-card" style={styles.statCard}>
              <p style={styles.statLabel}>Current exchange rate</p>
              <p style={styles.statValue}>{formattedCurrentRate}</p>
            </div>
          </div>
        </section>

        <details className="rt-mobile-dashboard-tools">
          <summary>Exchange rate and backup</summary>
          <div className="rt-list" style={styles.list}>
            {renderExchangeRatePanel('rt-mobile-tool-panel')}
            {renderGoogleSheetsBackupPanel('rt-mobile-tool-panel')}
          </div>
        </details>

        {renderEndOfMonthSummary()}
      </div>
    )
  }

  function renderMonthlySummaryPage() {
    return (
      <div className="rt-monthly-summary-page">
        <section style={styles.section}>
          {renderMonthFilterPanel('rt-mobile-summary-filter')}
        </section>
        {renderEndOfMonthSummary('rt-mobile-summary-section')}
      </div>
    )
  }

  function renderAddCustomerPage() {
    return (
      <section style={styles.section}>
        <form className="rt-panel rt-form" onSubmit={handleCustomerSubmit} style={styles.panel}>
          <label style={styles.field}>
            <span style={styles.label}>Name</span>
            <input
              ref={customerNameInputRef}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Customer name"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Phone</span>
            <input
              type="tel"
              value={formatPhoneInput(phone)}
              onChange={(event) => setPhone(cleanPhoneInput(event.target.value))}
              placeholder="03 123 456"
              maxLength="10"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Notes</span>
            <textarea
              value={customerNotes}
              onChange={(event) => setCustomerNotes(event.target.value)}
              placeholder="Optional customer notes"
              style={styles.textarea}
            />
          </label>

          {formError && <p style={styles.error}>{formError}</p>}

          <button
            className="rt-submit-button"
            type="submit"
            disabled={isSubmitDisabled}
            style={{
              ...styles.button,
              justifySelf: 'start',
              opacity: isSubmitDisabled ? 0.6 : 1,
            }}
          >
            {isSubmitting ? 'Adding...' : 'Add customer'}
          </button>
        </form>
      </section>
    )
  }

  function renderCustomersPage() {
    const showRechargeDetails = normalizedSearchTerm.length > 0 || searchDigits.length > 0

    return (
      <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Customers & Balances</h2>
          <div style={styles.listHeader}>
            <label style={styles.field}>
              <span style={styles.label}>Search customers</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name or phone"
                style={styles.input}
              />
            </label>
          </div>

          <div className="rt-list rt-customer-list" style={styles.list}>
            {filteredCustomers.map((customer) => {
              const customerBalance = unpaidBalances[String(customer.id)] || 0
              const customerRecharges = rechargesByCustomer[String(customer.id)] || []
              const hasUnpaidRecharges = unpaidRecharges.some(
                (recharge) => String(recharge.customer_id) === String(customer.id)
              )
              const isPayingCustomer = payingCustomerId === String(customer.id)
              const isEditingCustomer = editingCustomerId === String(customer.id)
              const isDeletingCustomer = deletingCustomerId === String(customer.id)
              const isExpandedCustomer = expandedCustomerId === String(customer.id)

              return (
                <div
                  className={`rt-customer-card ${isExpandedCustomer ? 'rt-customer-card-expanded' : ''}`}
                  key={customer.id}
                  onClick={() => {
                    if (isMobileView) {
                      setExpandedCustomerId(isExpandedCustomer ? '' : String(customer.id))
                      return
                    }

                    if (!isEditingCustomer) {
                      openCustomerDetail(customer.id)
                    }
                  }}
                  style={{
                    ...styles.customer,
                    ...(hasUnpaidRecharges ? styles.customerUnpaid : {}),
                  }}
                >
                  <div className="rt-card-top" style={styles.cardTop}>
                    <div>
                      <p className="rt-customer-name" style={styles.customerName}>{customer.name}</p>
                      <p className="rt-customer-phone" style={styles.phone}>{formatStoredPhone(customer.phone)}</p>
                    </div>
                    <p
                      className="rt-customer-balance"
                      style={hasUnpaidRecharges ? styles.unpaidText : styles.balance}
                    >
                      Unpaid: {formatLbp(customerBalance)} / {formatUsdFromLbp(customerBalance, exchangeRate)}
                    </p>
                  </div>

                  {customer.notes && (
                    <p className="rt-customer-extra" style={styles.notes}>Notes: {customer.notes}</p>
                  )}

                  {showRechargeDetails && (
                    <div className="rt-recharge-preview-list rt-customer-extra" style={styles.rechargePreviewList}>
                      {customerRecharges.map((recharge) => {
                        const isPaid = String(recharge.status || '').toLowerCase() === 'paid'
                        const isPayingRecharge = payingRechargeId === String(recharge.id)

                        return (
                          <div
                            className="rt-recharge-preview"
                            key={recharge.id}
                            onClick={(event) => event.stopPropagation()}
                            style={styles.rechargePreview}
                          >
                            <div className="rt-card-top" style={styles.cardTop}>
                              <div>
                                <p style={styles.historyTitle}>{recharge.service || 'Recharge'}</p>
                                <p style={styles.historyMeta}>
                                  {formatLbp(recharge.amount)} / {formatUsdFromLbp(recharge.amount, exchangeRate)}
                                </p>
                              </div>
                              <span
                                className={`rt-status ${isPaid ? 'rt-status-paid' : 'rt-status-unpaid'}`}
                                style={{
                                  ...styles.status,
                                  ...(isPaid ? styles.paidText : styles.unpaidText),
                                }}
                              >
                                {recharge.status || 'unpaid'}
                              </span>
                            </div>
                            {recharge.notes && (
                              <p style={styles.notes}>Notes: {recharge.notes}</p>
                            )}
                            {!isPaid && (
                              <button
                                type="button"
                                disabled={isPayingRecharge}
                                onClick={() => handleMarkRechargePaid(recharge.id)}
                                style={{
                                  ...styles.smallButton,
                                  justifySelf: 'start',
                                  opacity: isPayingRecharge ? 0.6 : 1,
                                }}
                              >
                                {isPayingRecharge ? 'Updating...' : 'Mark as Paid'}
                              </button>
                            )}
                          </div>
                        )
                      })}

                      {customerRecharges.length === 0 && (
                        <p style={styles.empty}>No recharges for this customer.</p>
                      )}
                    </div>
                  )}

                  {isEditingCustomer ? (
                    <form
                      className="rt-panel rt-customer-extra"
                      onClick={(event) => event.stopPropagation()}
                      onSubmit={handleCustomerEditSubmit}
                      style={styles.editBox}
                    >
                      <label style={styles.field}>
                        <span style={styles.label}>Name</span>
                        <input
                          type="text"
                          value={editCustomerName}
                          onChange={(event) => setEditCustomerName(event.target.value)}
                          style={styles.input}
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.label}>Phone</span>
                        <input
                          type="tel"
                          value={formatPhoneInput(editCustomerPhone)}
                          onChange={(event) => setEditCustomerPhone(cleanPhoneInput(event.target.value))}
                          maxLength="10"
                          style={styles.input}
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.label}>Notes</span>
                        <textarea
                          value={editCustomerNotes}
                          onChange={(event) => setEditCustomerNotes(event.target.value)}
                          style={styles.textarea}
                        />
                      </label>
                      {customerEditError && <p style={styles.error}>{customerEditError}</p>}
                      <div className="rt-actions" style={styles.actions}>
                        <button
                          type="submit"
                          disabled={isCustomerEditSubmitting}
                          style={{
                            ...styles.smallButton,
                            opacity: isCustomerEditSubmitting ? 0.6 : 1,
                          }}
                        >
                          {isCustomerEditSubmitting ? 'Saving...' : 'Save customer'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditingCustomer}
                          style={styles.quietButton}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="rt-actions rt-customer-card-actions" onClick={(event) => event.stopPropagation()} style={styles.actions}>
                      <button
                        type="button"
                        onClick={() => openQuickRecharge(customer.id)}
                        style={styles.smallButton}
                      >
                        + Recharge
                      </button>
                      {(!isMobileView || isExpandedCustomer) && (
                        <>
                          <button
                            type="button"
                            disabled={!hasUnpaidRecharges || isPayingCustomer}
                            onClick={() => handleMarkAllPaid(customer.id)}
                            style={{
                              ...styles.quietButton,
                              opacity: !hasUnpaidRecharges || isPayingCustomer ? 0.6 : 1,
                            }}
                          >
                            {isPayingCustomer ? 'Updating...' : 'Mark All as Paid'}
                          </button>
                          <button
                            type="button"
                            onClick={() => (isMobileView ? openMobileCustomerEdit(customer) : startEditingCustomer(customer))}
                            style={styles.quietButton}
                          >
                            Edit Customer
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingCustomer}
                            onClick={() => handleDeleteCustomer(customer.id)}
                            style={{
                              ...styles.dangerButton,
                              opacity: isDeletingCustomer ? 0.6 : 1,
                            }}
                          >
                            {isDeletingCustomer ? 'Deleting...' : 'Delete Customer'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {!hasCustomers && (
              <p style={styles.empty}>No customers yet.</p>
            )}

            {hasCustomers && !hasMatchingCustomers && (
              <p style={styles.empty}>No customers match your search.</p>
            )}
          </div>
        </section>
    )
  }

  function renderAddRechargePage() {
    return (
      <section style={styles.section}>
        <form className="rt-panel rt-form rt-add-recharge-form" onSubmit={handleRechargeSubmit} style={styles.panel}>
          <label style={styles.field}>
            <span style={styles.label}>Customer</span>
            {renderCustomerSelector()}
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Service</span>
            {renderServiceSelect(selectedRechargeService, setRechargeService)}
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Amount (in thousands LBP)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={rechargeAmount}
              onChange={(event) => setRechargeAmount(event.target.value)}
              placeholder="1800"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Notes</span>
            <textarea
              value={rechargeNotes}
              onChange={(event) => setRechargeNotes(event.target.value)}
              placeholder="Optional recharge notes"
              style={styles.textarea}
            />
          </label>

          {rechargeError && <p style={styles.error}>{rechargeError}</p>}

          <button
            className="rt-submit-button"
            type="submit"
            disabled={isRechargeSubmitDisabled}
            style={{
              ...styles.button,
              justifySelf: 'start',
              opacity: isRechargeSubmitDisabled ? 0.6 : 1,
            }}
          >
            {isRechargeSubmitting ? 'Adding...' : 'Add recharge'}
          </button>
        </form>
      </section>
    )
  }

  function renderRechargeHistoryPage() {
    return (
      <section style={styles.section}>
        <div style={styles.listHeader}>
          <p style={styles.historyMeta}>Showing: {selectedMonthLabel}</p>
        </div>

        <div className="rt-list rt-history-list" style={styles.list}>
          {sortedRecharges.map((recharge) => renderRechargeCard(recharge))}

          {sortedRecharges.length === 0 && (
            <p style={styles.empty}>No recharges for this period.</p>
          )}
        </div>
      </section>
    )
  }

  function renderServicesPage() {
    return (
      <section style={styles.section}>
        <div className="rt-grid" style={styles.grid}>
          <form className="rt-panel rt-form" onSubmit={handleAddService} style={styles.panel}>
            <h2 style={styles.sectionTitle}>Add Bundle/Service</h2>
            <label style={styles.field}>
              <span style={styles.label}>Service name</span>
              <input
                ref={serviceNameInputRef}
                type="text"
                value={newServiceName}
                onChange={(event) => setNewServiceName(event.target.value)}
                placeholder="Example: Touch 10GB"
                style={styles.input}
              />
            </label>
            {serviceError && <p style={styles.error}>{serviceError}</p>}
            <button className="rt-submit-button" type="submit" style={{ ...styles.button, justifySelf: 'start' }}>
              Add service
            </button>
          </form>

          <div className="rt-panel" style={styles.panel}>
            <h2 style={styles.sectionTitle}>Current Bundles/Services</h2>
            <div style={styles.list}>
              {services.map((service) => {
                const serviceName = getServiceName(service)

                return (
                  <div className="rt-history-card" key={service.id || serviceName} style={styles.historyItem}>
                    <div className="rt-card-top" style={styles.cardTop}>
                      <p style={styles.historyTitle}>{serviceName}</p>
                      <button
                        type="button"
                        onClick={() => handleDeleteService(service)}
                        style={styles.dangerButton}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}

              {services.length === 0 && (
                <p style={styles.empty}>No services yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderActivePage() {
    if (activePage === 'dashboard') {
      return renderDashboardPage()
    }

    if (activePage === 'addCustomer') {
      return renderAddCustomerPage()
    }

    if (activePage === 'customers') {
      return renderCustomersPage()
    }

    if (activePage === 'addRecharge') {
      return renderAddRechargePage()
    }

    if (activePage === 'services') {
      return renderServicesPage()
    }

    if (activePage === 'monthlySummary') {
      return renderMonthlySummaryPage()
    }

    return renderRechargeHistoryPage()
  }

  function renderQuickRechargeModal() {
    if (!quickRechargeCustomer) {
      return null
    }

    return (
      <div className="rt-overlay" style={styles.overlay}>
        <form className="rt-modal" onSubmit={handleQuickRechargeSubmit} style={styles.modal}>
          <div className="rt-card-top" style={styles.cardTop}>
            <div>
              <h2 style={styles.sectionTitle}>Quick Recharge</h2>
              <p style={styles.phone}>{getCustomerLabel(quickRechargeCustomer)}</p>
            </div>
            <button type="button" onClick={closeQuickRecharge} style={styles.quietButton}>
              Close
            </button>
          </div>

          <label style={styles.field}>
            <span style={styles.label}>Service</span>
            {renderServiceSelect(selectedQuickRechargeService, setQuickRechargeService)}
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Amount (in thousands LBP)</span>
            <input
              ref={quickRechargeAmountInputRef}
              type="number"
              min="0"
              step="1"
              value={quickRechargeAmount}
              onChange={(event) => setQuickRechargeAmount(event.target.value)}
              placeholder="1800"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Notes</span>
            <textarea
              value={quickRechargeNotes}
              onChange={(event) => setQuickRechargeNotes(event.target.value)}
              placeholder="Optional notes"
              style={styles.textarea}
            />
          </label>

          {quickRechargeError && <p style={styles.error}>{quickRechargeError}</p>}

          <button
            type="submit"
            disabled={isQuickRechargeSubmitDisabled}
            style={{
              ...styles.button,
              justifySelf: 'start',
              opacity: isQuickRechargeSubmitDisabled ? 0.6 : 1,
            }}
          >
            {isQuickRechargeSubmitting ? 'Adding...' : 'Add recharge'}
          </button>
        </form>
      </div>
    )
  }

  function renderCustomerDetailModal() {
    if (!detailCustomer) {
      return null
    }

    const customerRecharges = (
      isMobileView
        ? allRechargesByCustomer[String(detailCustomer.id)]
        : rechargesByCustomer[String(detailCustomer.id)]
    ) || []
    const customerBalance = unpaidBalances[String(detailCustomer.id)] || 0
    const hasUnpaidRecharges = unpaidRecharges.some(
      (recharge) => String(recharge.customer_id) === String(detailCustomer.id)
    )
    const isPayingCustomer = payingCustomerId === String(detailCustomer.id)
    const isEditingDetailCustomer = editingCustomerId === String(detailCustomer.id)
    const isDeletingDetailCustomer = deletingCustomerId === String(detailCustomer.id)
    const unpaidCustomerRecharges = customerRecharges.filter(
      (recharge) => String(recharge.status || '').toLowerCase() === 'unpaid'
    )
    const statementTotal = unpaidCustomerRecharges.reduce(
      (total, recharge) => total + (Number(recharge.amount) || 0),
      0
    )
    const messageServiceTotals = unpaidCustomerRecharges.reduce((totals, recharge) => {
      const service = recharge.service || 'Recharge'

      totals[service] = (totals[service] || 0) + (Number(recharge.amount) || 0)
      return totals
    }, {})
    const messageLines = Object.entries(messageServiceTotals).map(
      ([service, amount]) => `- ${service}: ${formatLbp(amount)}`
    )
    const whatsappMessage = [
      `Hello ${detailCustomer.name || 'Customer'},`,
      'Your recharge balance is:',
      '',
      ...(messageLines.length > 0 ? messageLines : ['No unpaid recharges.']),
      '',
      `Total: ${formatLbp(statementTotal)} (${formatUsdFromLbpDetailed(statementTotal, exchangeRate)})`,
    ].join('\n')

    return (
      <div className="rt-overlay" style={styles.overlay}>
        <div className="rt-modal" style={styles.modal}>
          <div className="rt-card-top" style={styles.cardTop}>
            <div>
              <h2 style={styles.sectionTitle}>{detailCustomer.name}</h2>
              <p style={styles.phone}>{formatStoredPhone(detailCustomer.phone)}</p>
            </div>
            <button type="button" onClick={closeCustomerDetail} style={styles.quietButton}>
              Close
            </button>
          </div>

          <p style={hasUnpaidRecharges ? styles.unpaidText : styles.balance}>
            Total unpaid: {formatLbp(customerBalance)} / {formatUsdFromLbp(customerBalance, exchangeRate)}
          </p>
          <p style={styles.historyMeta}>
            {isMobileView ? 'Showing all recharges.' : `Showing recharges for: ${selectedMonthLabel}`}
          </p>

          {detailCustomer.notes && (
            <p style={styles.notes}>Notes: {detailCustomer.notes}</p>
          )}

          <div className="rt-actions" style={styles.actions}>
            <button
              type="button"
              disabled={!hasUnpaidRecharges || isPayingCustomer}
              onClick={() => handleMarkAllPaid(detailCustomer.id)}
              style={{
                ...styles.smallButton,
                opacity: !hasUnpaidRecharges || isPayingCustomer ? 0.6 : 1,
              }}
            >
              {isPayingCustomer ? 'Updating...' : 'Mark All as Paid'}
            </button>
            <button
              type="button"
              onClick={() => openQuickRecharge(detailCustomer.id)}
              style={styles.quietButton}
            >
              + Recharge
            </button>
            <button
              type="button"
              onClick={() => setIsStatementVisible(true)}
              style={styles.quietButton}
            >
              Generate Statement
            </button>
            <button
              className="rt-mobile-only"
              type="button"
              onClick={() => startEditingCustomer(detailCustomer)}
              style={styles.quietButton}
            >
              Edit Customer
            </button>
            <button
              className="rt-mobile-only"
              type="button"
              disabled={isDeletingDetailCustomer}
              onClick={() => handleDeleteCustomer(detailCustomer.id)}
              style={{
                ...styles.dangerButton,
                opacity: isDeletingDetailCustomer ? 0.6 : 1,
              }}
            >
              {isDeletingDetailCustomer ? 'Deleting...' : 'Delete Customer'}
            </button>
          </div>

          {isEditingDetailCustomer && (
            <form
              className="rt-mobile-only rt-mobile-detail-edit"
              onSubmit={handleCustomerEditSubmit}
              style={styles.editBox}
            >
              <label style={styles.field}>
                <span style={styles.label}>Name</span>
                <input
                  type="text"
                  value={editCustomerName}
                  onChange={(event) => setEditCustomerName(event.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>Phone</span>
                <input
                  type="tel"
                  value={formatPhoneInput(editCustomerPhone)}
                  onChange={(event) => setEditCustomerPhone(cleanPhoneInput(event.target.value))}
                  maxLength="10"
                  style={styles.input}
                />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>Notes</span>
                <textarea
                  value={editCustomerNotes}
                  onChange={(event) => setEditCustomerNotes(event.target.value)}
                  style={styles.textarea}
                />
              </label>
              {customerEditError && <p style={styles.error}>{customerEditError}</p>}
              <div className="rt-actions" style={styles.actions}>
                <button
                  type="submit"
                  disabled={isCustomerEditSubmitting}
                  style={{
                    ...styles.smallButton,
                    opacity: isCustomerEditSubmitting ? 0.6 : 1,
                  }}
                >
                  {isCustomerEditSubmitting ? 'Saving...' : 'Save customer'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditingCustomer}
                  style={styles.quietButton}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {isStatementVisible && (
            <div style={styles.statementBox}>
              <div>
                <h2 style={styles.sectionTitle}>Customer Statement</h2>
                <p style={styles.customerName}>{detailCustomer.name}</p>
              </div>

              <div className="rt-list" style={styles.list}>
                {unpaidCustomerRecharges.map((recharge) => {
                  const formattedDate = recharge.created_at
                    ? new Date(recharge.created_at).toLocaleDateString()
                    : 'No date'

                  return (
                    <div className="rt-recharge-preview" key={recharge.id} style={styles.rechargePreview}>
                      <p style={styles.historyTitle}>
                        {formattedDate} - {recharge.service || 'Recharge'}
                      </p>
                      <p style={styles.unpaidText}>{formatLbp(recharge.amount)}</p>
                    </div>
                  )
                })}

                {unpaidCustomerRecharges.length === 0 && (
                  <p style={styles.empty}>No unpaid recharges.</p>
                )}
              </div>

              <p style={styles.unpaidText}>
                Total unpaid: {formatLbp(statementTotal)} / {formatUsdFromLbpDetailed(statementTotal, exchangeRate)}
              </p>

              <pre style={styles.messageBox}>{whatsappMessage}</pre>

              <div className="rt-actions" style={styles.actions}>
                <button
                  type="button"
                  onClick={() => copyWhatsAppMessage(whatsappMessage)}
                  style={styles.smallButton}
                >
                  Copy Message
                </button>
                <button
                  type="button"
                  onClick={() => sendWhatsAppMessage(detailCustomer, whatsappMessage)}
                  style={styles.quietButton}
                >
                  Send via WhatsApp
                </button>
              </div>
            </div>
          )}

          <div className="rt-list" style={styles.list}>
            {customerRecharges.map((recharge) => renderRechargeCard(recharge, false))}

            {customerRecharges.length === 0 && (
              <p style={styles.empty}>No recharges for this customer.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  function renderAuthLoadingScreen() {
    return (
      <div className="rt-auth-shell" style={styles.authShell}>
        <div className="rt-auth-card" style={styles.authCard}>
          <h1 style={styles.pageTitle}>Recharge Tracker</h1>
          <p style={styles.pageHint}>Checking your login session...</p>
        </div>
      </div>
    )
  }

  function renderLoginScreen() {
    return (
      <div className="rt-auth-shell" style={styles.authShell}>
        <form className="rt-auth-card" onSubmit={handleLoginSubmit} style={styles.authCard}>
          <div>
            <h1 style={styles.pageTitle}>Recharge Tracker</h1>
            <p style={styles.pageHint}>Log in to manage customers, balances, and recharges.</p>
          </div>

          <label style={styles.field}>
            <span style={styles.label}>Email</span>
            <input
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Password</span>
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              style={styles.input}
            />
          </label>

          {loginError && <p style={styles.error}>{loginError}</p>}

          <button
            type="submit"
            disabled={isLoggingIn || !loginEmail.trim() || !loginPassword}
            style={{
              ...styles.button,
              opacity: isLoggingIn || !loginEmail.trim() || !loginPassword ? 0.6 : 1,
            }}
          >
            {isLoggingIn ? 'Logging in...' : 'Log in'}
          </button>
        </form>
      </div>
    )
  }

  function openMobilePage(pageId) {
    setActivePage(pageId)
    setIsMobileMenuOpen(false)
  }

  function renderMobileHeader() {
    return (
      <header className="rt-mobile-header">
        <button
          className="rt-hamburger-button"
          type="button"
          aria-label="Open menu"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen(true)}
        >
          <span className="rt-hamburger-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div>
          <p className="rt-mobile-header-title">Recharge Tracker</p>
          <p className="rt-mobile-header-page">{activePageLabel}</p>
        </div>

        {isMobileMenuOpen && (
          <div
            className="rt-mobile-menu-backdrop"
            role="presentation"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <div
              className="rt-mobile-menu"
              role="dialog"
              aria-label="Mobile navigation"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="rt-card-top" style={styles.cardTop}>
                <div>
                  <p style={styles.customerName}>Menu</p>
                  <p style={styles.historyMeta}>{session.user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  style={styles.quietButton}
                >
                  Close
                </button>
              </div>

              <nav className="rt-mobile-menu-nav">
                {mobilePages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    aria-current={activePage === page.id ? 'page' : undefined}
                    onClick={() => openMobilePage(page.id)}
                    style={activePage === page.id ? styles.activeNavButton : undefined}
                  >
                    {page.label}
                  </button>
                ))}
              </nav>

              <button
                type="button"
                disabled={isLoggingOut}
                onClick={handleLogout}
                style={{
                  ...styles.dangerButton,
                  opacity: isLoggingOut ? 0.6 : 1,
                }}
              >
                {isLoggingOut ? 'Logging out...' : 'Logout'}
              </button>
            </div>
          </div>
        )}
      </header>
    )
  }

  if (isAuthLoading) {
    return renderAuthLoadingScreen()
  }

  if (!session) {
    return renderLoginScreen()
  }

  return (
    <div className="rt-shell" style={styles.appShell}>
      {renderMobileHeader()}

      <aside className="rt-sidebar" style={styles.sidebar}>
        <p className="rt-brand" style={styles.brand}>Recharge Tracker</p>
        <nav className="rt-nav" style={styles.nav}>
          {pages.map((page) => (
            <button
              key={page.id}
              className="rt-nav-button"
              data-page-id={page.id}
              data-mobile-label={page.mobileLabel}
              type="button"
              aria-current={activePage === page.id ? 'page' : undefined}
              onClick={() => setActivePage(page.id)}
              style={{
                ...styles.navButton,
                ...(activePage === page.id ? styles.activeNavButton : {}),
              }}
            >
              {page.label}
            </button>
          ))}
        </nav>

        <div className="rt-sidebar-footer" style={styles.sidebarFooter}>
          <p style={styles.historyMeta}>{session.user?.email}</p>
          <button
            type="button"
            disabled={isLoggingOut}
            onClick={handleLogout}
            style={{
              ...styles.quietButton,
              opacity: isLoggingOut ? 0.6 : 1,
            }}
          >
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </aside>

      <main className="rt-content" style={styles.content}>
        <header className="rt-page-header" style={styles.pageHeader}>
          <div>
            <h1 style={styles.pageTitle}>{activePageLabel}</h1>
            <p style={styles.pageHint}>
              Manage customers, LBP balances, payments, services, and recharge records.
            </p>
          </div>
          <button
            className="rt-mobile-logout"
            type="button"
            disabled={isLoggingOut}
            onClick={handleLogout}
            style={{
              ...styles.quietButton,
              opacity: isLoggingOut ? 0.6 : 1,
            }}
          >
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </header>

        {renderActivePage()}
      </main>

      <button
        className="rt-mobile-fab"
        type="button"
        aria-current={activePage === 'addCustomer' ? 'page' : undefined}
        onClick={() => setActivePage('addCustomer')}
        style={styles.button}
      >
        + Customer
      </button>

      {renderCustomerDetailModal()}
      {renderQuickRechargeModal()}
    </div>
  )
}

export default App
