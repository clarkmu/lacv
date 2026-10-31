// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SamplesPage } from './SamplesPage'
import type { SampleListItem } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function sample(sample_id: number, sample_code: string, fields: Partial<SampleListItem> = {}): SampleListItem {
  return {
    sample_id, sample_code, sample_type: null, status: 'available', sample_type_id: null, parent_sample_id: null, batch_id: null,
    external_sample_id: null, subject_code: null, aliquot_number: null, label: null, received_date: null, current_quantity: null, quantity_unit: null, storage_location_id: null,
    legacy_codes: [], ...fields,
  }
}

// The fake API applies root_only the way the backend does, so the page must ask for it rather than hide rows itself.
const SAMPLES = [
  sample(1, 'MOSQ-001', { label: 'Field pool', current_quantity: '200.000000', quantity_unit: 'uL', legacy_codes: ['MAT-0001'] }),
  sample(2, 'MOSQ-001-RNA', { parent_sample_id: 1, label: 'Field pool RNA', legacy_codes: ['MAT-0002'] }),
  sample(3, 'TICK-001', { label: 'Tick tube' }),
]
const requestedPaths: string[] = []

function fakeFetch(input: RequestInfo | URL) {
  const url = new URL(String(input), 'http://lacv.test')
  requestedPaths.push(url.pathname + url.search)
  if (url.pathname === '/api/samples') {
    const rows = url.searchParams.get('root_only') === 'true' ? SAMPLES.filter(row => row.parent_sample_id === null) : SAMPLES
    return Promise.resolve(Response.json(rows))
  }
  if (url.pathname === '/api/samples/lookup') {
    const code = url.searchParams.get('code')
    const match = SAMPLES.find(row => row.sample_code === code || row.legacy_codes.includes(code ?? ''))
    return Promise.resolve(match ? Response.json(match) : Response.json({ detail: `No sample matches ${code}` }, { status: 404 }))
  }
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

function OpenedSample() {
  return <p>Opened sample {useParams().id}</p>
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  requestedPaths.length = 0
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/samples']}>
        <Routes>
          <Route path="/samples" element={<SamplesPage />} />
          <Route path="/sample/:id" element={<OpenedSample />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
  await waitFor(() => listedCodes().length > 0)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  throw new Error(`Timed out waiting. Page text: ${container.textContent}`)
}

function listedCodes() {
  return [...container.querySelectorAll('tbody tr')].map(row => row.querySelector('td')?.textContent ?? '').filter(code => code && !code.startsWith('No samples'))
}

// The control is found through its visible label, as a user (or screen reader) would.
function baseSamplesOnly() {
  const label = [...container.querySelectorAll('label')].find(label => label.textContent === 'Base samples only')
  const checkbox = label && container.querySelector<HTMLButtonElement>(`#${label.htmlFor}[role="checkbox"]`)
  if (!checkbox) throw new Error('Base samples only checkbox not found')
  return { checked: checkbox.getAttribute('aria-checked') === 'true', click: () => checkbox.click() }
}

async function setBaseSamplesOnly(checked: boolean) {
  if (baseSamplesOnly().checked !== checked) await act(async () => baseSamplesOnly().click())
}

async function typeInto(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const searchField = () => container.querySelector<HTMLInputElement>('input[aria-label="Filter"]')!
const openField = () => container.querySelector<HTMLInputElement>('form[aria-label="Open by code"] input')!

test('lists only base samples by default, asking the API for roots', () => {
  expect(baseSamplesOnly().checked).toBe(true)
  expect(listedCodes()).toEqual(['MOSQ-001', 'TICK-001'])
  expect(requestedPaths).toContain('/api/samples?root_only=true')
})

test('turning the filter off lists root and derived samples', async () => {
  await setBaseSamplesOnly(false)
  await waitFor(() => listedCodes().length === 3)

  expect(listedCodes()).toEqual(['MOSQ-001', 'MOSQ-001-RNA', 'TICK-001'])
  expect(requestedPaths).toContain('/api/samples')
  const derivedRow = [...container.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('MOSQ-001-RNA'))!
  expect(derivedRow.querySelector('a[href="/sample/1"]')?.textContent).toBe('MOSQ-001')
})

test('search with the filter on matches roots only', async () => {
  await typeInto(searchField(), 'field pool')
  expect(listedCodes()).toEqual(['MOSQ-001'])

  await typeInto(searchField(), 'MAT-0002')
  expect(listedCodes()).toEqual([])
  expect(container.textContent).toContain('No samples match your filter.')
})

test('the same search finds the derived sample once the filter is off', async () => {
  await typeInto(searchField(), 'MAT-0002')
  await setBaseSamplesOnly(false)
  await waitFor(() => listedCodes().length > 0)

  expect(searchField().value).toBe('MAT-0002')
  expect(listedCodes()).toEqual(['MOSQ-001-RNA'])
})

test('scanning a derived sample code still opens it while the filter is on', async () => {
  expect(baseSamplesOnly().checked).toBe(true)
  await typeInto(openField(), 'MOSQ-001-RNA')
  await act(async () => container.querySelector<HTMLButtonElement>('form[aria-label="Open by code"] button')!.click())
  await waitFor(() => container.textContent?.includes('Opened sample') ?? false)

  expect(container.textContent).toBe('Opened sample 2')
})

test('existing list features still work: links, quantity, legacy codes, sorting, create action', async () => {
  expect(container.querySelector('a[href="/sample/1"]')?.textContent).toBe('MOSQ-001')
  expect(container.textContent).toContain('200 uL')
  expect(container.textContent).toContain('MAT-0001')
  expect(container.querySelector('a[href="/samples/new"]')?.textContent).toBe('Create root sample')

  const sampleHeader = [...container.querySelectorAll('th button')].find(button => button.textContent?.startsWith('Sample'))!
  await act(async () => (sampleHeader as HTMLButtonElement).click())
  await act(async () => (sampleHeader as HTMLButtonElement).click())
  expect(listedCodes()).toEqual(['TICK-001', 'MOSQ-001'])
})
