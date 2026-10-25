import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConnectBackendStep from '../ConnectBackendStep'
import { useConnector } from '../useConnector'
import { CONNECTOR_LOCALSTORAGE_KEY } from '@/lib/connector/shared'

const KEY_ID = 'ck_0123456789abcdef'
const SECRET = 'S'.repeat(43)
const INFO = { host: 'backend.example.com', keyId: KEY_ID, version: '1', capabilities: ['documents', 'search'], answer: false }

type Reply = { status: number; body: unknown }
type Handler = (url: string, init?: RequestInit) => Reply

const fetchMock = global.fetch as jest.Mock

function useRoutes(handler: Handler) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  })
}

function Harness() {
  const connector = useConnector(true, true)
  return <ConnectBackendStep connector={connector} />
}

function documentsCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/connector/documents')).length
}

async function connectAndShowPending() {
  render(<Harness />)
  const input = await screen.findByLabelText('Backend base URL')
  fireEvent.change(input, { target: { value: 'https://backend.example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check backend' }))
  await screen.findByText('Your backend answered. Add this key to it.')
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('ConnectBackendStep focus (E6)', () => {
  beforeEach(() => {
    useRoutes(url => {
      if (url === '/api/connector/connect') return { status: 200, body: { status: 'pending', token: 'sbc1_new', secret: SECRET, ...INFO } }
      if (url === '/api/connector/documents') return { status: 200, body: { documents: [] } }
      return { status: 500, body: null }
    })
  })

  it('returns focus to the URL input after Cancel', async () => {
    await connectAndShowPending()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Backend base URL')))
  })

  it('returns focus to the URL input after Disconnect', async () => {
    await connectAndShowPending()
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }))
    await screen.findByText('Using your backend')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect this browser' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Backend base URL')))
  })
})

describe('ConnectBackendStep documents list (C4)', () => {
  it('shows the not-yet-configured hint after confirm, then loads the list once the test passes', async () => {
    let keyConfigured = false
    useRoutes(url => {
      if (url === '/api/connector/connect') return { status: 200, body: { status: 'pending', token: 'sbc1_new', secret: SECRET, ...INFO } }
      if (url === '/api/connector/documents') {
        return keyConfigured
          ? { status: 200, body: { documents: [{ id: 'd1', filename: 'faq.md', passageCount: 3, createdAt: '2026-01-01T00:00:00Z' }] } }
          : { status: 422, body: { code: 'connector_auth_rejected' } }
      }
      if (url === '/api/connector/test') return { status: 200, body: { ok: true, token: 'sbc1_tested', passagesReturned: 2, ...INFO } }
      return { status: 500, body: null }
    })

    await connectAndShowPending()
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }))
    await screen.findByText(/doesn't accept this key yet/)
    expect(screen.queryByText('Loading the list…')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    keyConfigured = true
    const callsBefore = documentsCalls()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    })
    await screen.findByText('faq.md')
    expect(documentsCalls()).toBe(callsBefore + 1)
    expect(screen.getByText('Documents on your backend (1)')).toBeInTheDocument()
    expect(screen.queryByText('Loading the list…')).not.toBeInTheDocument()

    const stored = window.localStorage.getItem(CONNECTOR_LOCALSTORAGE_KEY) ?? ''
    expect(stored).not.toContain(SECRET)
    expect(stored).toContain('sbc1_tested')
  })

  it('shows a failed state, not "Loading", when the list cannot be read, and recovers on Refresh', async () => {
    window.localStorage.setItem(CONNECTOR_LOCALSTORAGE_KEY, JSON.stringify({ token: 'sbc1_stored', ...INFO }))
    let fail = true
    useRoutes(url => {
      if (url === '/api/connector/documents') {
        return fail ? { status: 502, body: { code: 'connector_http_error' } } : { status: 200, body: { documents: [] } }
      }
      return { status: 500, body: null }
    })

    render(<Harness />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load the list. Your backend returned an error.")
    expect(screen.queryByText('Loading the list…')).not.toBeInTheDocument()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    await screen.findByText(/No documents yet/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
