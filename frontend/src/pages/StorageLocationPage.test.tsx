// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { StorageLocationPage } from './StorageLocationPage'
import type { StorageLocationDetail, StoredSample } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.hasPointerCapture ??= () => false
// Radix's Checkbox measures itself inside a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

const ref = (sample_id: number, sample_code: string) => ({ sample_id, sample_code, sample_type: 'Serum', status: 'available' })
const location = (id: number, code: string, type: string, parent: number | null = null) => ({ storage_location_id: id, parent_location_id: parent, location_code: code, location_type: type, location_name: null, is_active: true })

const stored = (sample_id: number, sample_code: string, fields: Partial<StoredSample> = {}): StoredSample => ({
  sample_id, sample_code, sample_type_id: 3, sample_type: 'Serum', status: 'available', subject_code: 'DEV-H300', aliquot_number: null, label: null,
  current_quantity: '100.000000', quantity_unit: 'uL', concentration: null, concentration_unit: null, received_date: null, legacy_codes: [],
  parent: null, root: null, storage_location_id: 3, storage_location_code: 'RACK-A6', ...fields,
})

const RACK: StorageLocationDetail = {
  ...location(3, 'RACK-A6', 'rack', 1), location_name: 'Rack A6', description: 'Serum and CSF',
  ancestors: [location(1, 'LAB-80-A', 'freezer')],
  sub_locations: [{ ...location(5, 'BOX-149', 'box', 3), sample_count: 2 }],
  contents: [
    stored(10, 'HOSP-01'),
    stored(11, 'HOSP-01-A01', { parent: ref(10, 'HOSP-01'), root: ref(10, 'HOSP-01'), storage_location_id: 5, storage_location_code: 'BOX-149' }),
    stored(12, 'HOSP-01-A02', { parent: ref(10, 'HOSP-01'), root: ref(10, 'HOSP-01'), storage_location_id: 5, storage_location_code: 'BOX-149', legacy_codes: ['MAT-0042'] }),
  ],
}
const EMPTY: StorageLocationDetail = { ...location(9, 'SHELF-9', 'shelf'), description: null, ancestors: [], sub_locations: [], contents: [] }

let patches: unknown[] = []

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  if (init?.method === 'PATCH') {
    patches.push(JSON.parse(String(init.body)))
    return Promise.resolve(Response.json(location(3, 'RACK-A6', 'rack', 1)))
  }
  if (url.pathname === '/api/storage-locations/3') return Promise.resolve(Response.json(RACK))
  if (url.pathname === '/api/storage-locations/9') return Promise.resolve(Response.json(EMPTY))
  if (url.pathname === '/api/storage-locations') return Promise.resolve(Response.json([location(1, 'LAB-80-A', 'freezer'), location(3, 'RACK-A6', 'rack', 1), location(5, 'BOX-149', 'box', 3)]))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

let container: HTMLDivElement
let root: Root

async function open(id: number) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/storage-location/${id}`]}>
        <Routes><Route path="/storage-location/:id" element={<StorageLocationPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
  await waitFor(() => container.querySelector('h1') !== null)
}

beforeEach(() => {
  patches = []
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
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

const contentRows = () => [...container.querySelectorAll('section[aria-label="Contents"] tbody tr')].map(row => row.querySelector('td')?.textContent)

test('the header names the location and its place in the hierarchy', async () => {
  await open(3)

  expect(container.querySelector('h1')!.textContent).toBe('RACK-A6 · Rack A6')
  expect(container.querySelector('nav a[href="/storage-location/1"]')?.textContent).toBe('LAB-80-A')
  expect(container.textContent).toContain('1 sample stored here, 2 more in sub-locations')
  expect(container.querySelector('section[aria-label="Location"]')!.textContent).toContain('Serum and CSF')
  expect(container.querySelector('form'), 'the page is not an edit form').toBeNull()
})

test('every tube is its own row, linked to its sample and the original sample', async () => {
  await open(3)

  expect(contentRows()).toEqual(['HOSP-01', 'HOSP-01-A01', 'HOSP-01-A02'])
  const aliquot = [...container.querySelectorAll('section[aria-label="Contents"] tbody tr')][1]
  expect(aliquot.querySelector('a[href="/sample/11"]')?.textContent).toBe('HOSP-01-A01')
  expect(aliquot.querySelector('a[href="/sample/10"]')?.textContent).toBe('HOSP-01')
  expect(aliquot.querySelector('a[href="/storage-location/5"]')?.textContent).toBe('BOX-149')
  expect(container.textContent).toContain('MAT-0042')
})

test('sub-location contents can be left out', async () => {
  await open(3)
  await act(async () => container.querySelector<HTMLButtonElement>('#include-sub-locations')!.click())

  expect(contentRows()).toEqual(['HOSP-01'])
})

test('editing opens in place and saves the location', async () => {
  await open(3)
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Edit')!.click())
  const name = container.querySelector<HTMLInputElement>('#location-name')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Rack A6, top')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save location'))!.click())
  await waitFor(() => patches.length === 1)

  expect(patches[0]).toEqual({ location_code: 'RACK-A6', location_type: 'rack', location_name: 'Rack A6, top', parent_location_id: 1, description: 'Serum and CSF', is_active: true })
})

test('an empty location says so instead of showing an empty table', async () => {
  await open(9)

  expect(container.textContent).toContain('No samples are currently stored in this location.')
  expect(container.querySelector('section[aria-label="Contents"] table')).toBeNull()
})
