// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { buildActivity } from '../components/sample/SampleActivity'
import { SamplePage } from './SamplePage'
import type { SampleAvailability, SampleDetail, SampleLineage } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Radix menus measure the page; jsdom does not.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false

const ref = (sample_id: number, sample_code: string) => ({ sample_id, sample_code, sample_type: 'RNA', status: 'available' })

const SAMPLE: SampleDetail = {
  ...ref(2, 'S-001-RNA'), sample_type_id: 3, parent_sample_id: 1, batch_id: null, external_sample_id: 'EXT-9', subject_code: null, aliquot_number: null, label: 'Extracted RNA',
  received_date: null, current_quantity: '15.000000', quantity_unit: 'uL', storage_location_id: 7, legacy_codes: ['MAT-0002'],
  subtype: null, source_type: null, source_description: null, collection_date: null, concentration: '12.500000', concentration_unit: 'ng/uL',
  is_consumed: false, is_disposed: false, expiration_date: null, notes: null, latitude: '35.595100', longitude: null, batch: null,
  parent: ref(1, 'S-001'), children: [ref(3, 'S-001-RNA-A')],
  storage_location: { storage_location_id: 7, parent_location_id: null, location_code: 'BOX-7', location_type: 'box', location_name: 'Freezer box 7', is_active: true },
  legacy_identifiers: [], generated_by_assays: [],
  process_events: [
    { process_event_id: 10, process_code: 'EXT-1', process_type: 'RNA extraction', status: 'completed', operator_name: 'Ana', started_at: '2026-10-01T09:00:00', completed_at: null, role: 'output', inputs: [ref(1, 'S-001')], outputs: [ref(2, 'S-001-RNA')] },
  ],
  assays: [
    { assay_execution_id: 20, execution_name: 'QPCR-1', assay_definition_id: 4, assay_name: 'qPCR', assay_type: 'qPCR', target: 'Gene X', status: 'completed', qc_status: 'accepted', assay_date: '2026-10-03T10:00:00', sample_count: 3, results: [{ label: 'LACV CT', unit: 'cycles', numeric_value: '31.20000000', text_value: null, interpretation: 'positive', qc_status: 'not_reviewed' }] },
  ],
  storage_events: [
    { storage_event_id: 30, event_type: 'stored', event_date: '2026-10-01T09:30:00', from_location_id: null, to_location_id: 7, from_location_code: null, to_location_code: 'BOX-7', operator_name: null, notes: null },
  ],
  quantity_events: [
    { quantity_event_id: 40, event_type: 'consumed', quantity_change: '-5.000000', quantity_unit: 'uL', quantity_before: '20.000000', quantity_after: '15.000000', related_process_event_id: null, related_assay_execution_id: null, event_date: '2026-10-02T12:00:00', operator_name: null, notes: null },
  ],
  data_files: [],
  availability: { state: 'tracked', unit: 'uL', dimension: 'volume', starting_quantity: '20.000000', available_quantity: '15.000000', removed_quantity: '5.000000', added_quantity: '0', percent_remaining: 75, problems: [] },
}

const LINEAGE: SampleLineage = {
  sample: ref(2, 'S-001-RNA'),
  ancestors: [ref(1, 'S-001')],
  descendants: [
    { ...ref(3, 'S-001-RNA-A'), generated_by: { kind: 'process', code: 'ALQ-1', type: 'Aliquoting' }, children: [], availability: availability({ starting_quantity: '10.000000', available_quantity: '7.500000', removed_quantity: '2.500000', percent_remaining: 75 }) },
    { ...ref(4, 'S-001-RNA-B'), generated_by: null, children: [], availability: availability({ unit: 'mL', starting_quantity: '5.000000', available_quantity: '0.000000', removed_quantity: '5.000000', percent_remaining: 0 }) },
    { ...ref(5, 'S-001-RNA-C'), generated_by: null, children: [], availability: availability({ state: 'not_recorded', unit: null, available_quantity: null }) },
    { ...ref(6, 'S-001-RNA-D'), generated_by: null, children: [], availability: availability({ state: 'inconsistent', available_quantity: '4.000000', percent_remaining: null, problems: ['History jumps from 6 to 4 uL'] }) },
    { ...ref(7, 'S-001-RNA-E'), generated_by: null, children: [], availability: availability({ state: 'no_unit', unit: null, available_quantity: '3.000000', percent_remaining: null }) },
  ],
}

function availability(fields: Partial<SampleAvailability>): SampleAvailability {
  return { state: 'tracked', unit: 'uL', dimension: 'volume', starting_quantity: null, available_quantity: null, removed_quantity: null, added_quantity: '0', percent_remaining: null, problems: [], ...fields }
}

const requests: { method: string; path: string; body?: unknown }[] = []

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  const method = init?.method ?? 'GET'
  requests.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined })
  if (url.pathname === '/api/samples/2' && method === 'PATCH') return Promise.resolve(Response.json({ ...SAMPLE, ...JSON.parse(String(init!.body)) }))
  if (url.pathname === '/api/samples/2') return Promise.resolve(Response.json(SAMPLE))
  if (url.pathname === '/api/samples/2/lineage') return Promise.resolve(Response.json(LINEAGE))
  if (url.pathname === '/api/sample-types' || url.pathname === '/api/storage-locations') return Promise.resolve(Response.json([]))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

function CurrentPath() {
  const location = useLocation()
  return <p data-testid="path">{location.pathname + location.search}</p>
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  requests.length = 0
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/sample/2']}>
          <Routes>
            <Route path="/sample/:id" element={<SamplePage />} />
            <Route path="*" element={<CurrentPath />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  ))
  await waitFor(() => container.textContent?.includes('this sample') ?? false)
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
  throw new Error(`Timed out waiting. Page text: ${document.body.textContent}`)
}

test('the header and state strip answer what, how much, where, and from what', () => {
  const identity = container.querySelector('h1')!
  expect(identity.textContent).toBe('S-001-RNA')
  const state = container.querySelector('[aria-label="Specimen state"]')!.textContent
  expect(state).toContain('15 uL of 20 uL remaining')
  expect(state).toContain('12.5 ng/uL')
  expect(state).toContain('BOX-7')
  expect(state).toContain('via RNA extraction EXT-1')
  expect(container.textContent).toContain('MAT-0002')
})

test('lineage shows the parent, this sample, and navigable children', () => {
  const lineage = container.querySelector('ol[aria-label="Lineage"]')!
  expect(lineage.querySelector('a[href="/sample/1"]')?.textContent).toBe('S-001')
  expect(lineage.querySelector('[aria-current="true"]')?.textContent).toBe('S-001-RNA')
  expect(lineage.querySelector('a[href="/sample/3"]')?.textContent).toBe('S-001-RNA-A')
  expect(lineage.textContent).toContain('via Aliquoting ALQ-1')
})

test('activity merges processes, assays, storage, and quantity newest first', () => {
  expect(buildActivity(SAMPLE).map(item => item.key)).toEqual(['assay-20', 'quantity-40', 'storage-30', 'process-10'])
  const kinds = [...container.querySelectorAll('section[aria-label="Activity"] li')].map(item => item.getAttribute('data-kind'))
  expect(kinds).toEqual(['assay', 'quantity', 'storage', 'process'])
})

test('Record process offers the same process routes as before', async () => {
  const trigger = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Record process'))!
  await act(async () => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  await waitFor(() => document.body.querySelector('[role="menu"]') !== null)
  const links = [...document.body.querySelectorAll('[role="menu"] a')].map(link => [link.textContent, link.getAttribute('href')])
  expect(links).toEqual([
    ['Homogenization', '/sample/2/process/new?action=Homogenization'],
    ['RNA extraction', '/sample/2/process/new?action=RNA%20extraction'],
    ['Reverse transcription', '/sample/2/process/new?action=Reverse%20transcription'],
    ['Library preparation', '/sample/2/process/new?action=Library%20preparation'],
    ['Other process…', '/sample/2/process/new'],
  ])
  const visible = [...container.querySelectorAll('nav[aria-label="Sample actions"] a')].map(link => link.getAttribute('href'))
  expect(visible).toEqual(['/sample/2/children/new', '/sample/2/aliquots/new', '/sample/2/assays/new'])
})

test('editing a property in place saves just that field', async () => {
  const label = container.querySelector<HTMLInputElement>('#field-label')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(label, 'RNA eluate')
    label.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await waitFor(() => requests.some(request => request.method === 'PATCH'))
  expect(requests.find(request => request.method === 'PATCH')).toEqual({ method: 'PATCH', path: '/api/samples/2', body: { label: 'RNA eluate' } })
})

test('each derived sample in the lineage shows what remains of it, from the backend summary', () => {
  const row = (code: string) => [...container.querySelectorAll('[data-testid="lineage-availability"]')].find(cell => cell.parentElement?.textContent?.includes(code))!
  const partly = row('S-001-RNA-A').querySelector('[role="meter"]')!
  expect(partly.getAttribute('aria-valuenow')).toBe('75')
  expect(partly.getAttribute('aria-label')).toBe('Remaining in S-001-RNA-A')
  expect(row('S-001-RNA-A').textContent).toBe('7.5 / 10 uL75%')
  // Fully used, in its own unit.
  expect(row('S-001-RNA-B').querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('0')
  expect(row('S-001-RNA-B').textContent).toBe('0 / 5 mLused')
  // No quantity, a history that does not add up, or no unit: words, and no bar or percentage.
  expect(row('S-001-RNA-C').textContent).toBe('no quantity recorded')
  expect(row('S-001-RNA-D').textContent).toContain('history does not reconcile')
  expect(row('S-001-RNA-E').textContent).toBe('3 no unit')
  for (const code of ['S-001-RNA-C', 'S-001-RNA-D', 'S-001-RNA-E']) {
    expect(row(code).querySelector('[role="meter"]'), code).toBeNull()
    expect(row(code).textContent, code).not.toContain('%')
  }
})

test('assay interpretations show as badges with their text and a symbol', () => {
  const assays = container.querySelector('section[aria-label="Assays"]')!
  const badge = assays.querySelector('[data-tone="positive"]')!
  expect(badge.textContent).toBe('+positive')
  expect(assays.textContent).toContain('LACV CT')
  expect(assays.textContent).toContain('31.2')
})

test('latitude and longitude are edited in place and a missing one is pointed out', async () => {
  expect(container.querySelector<HTMLInputElement>('#field-latitude')!.value).toBe('35.5951')
  expect(container.querySelector<HTMLInputElement>('#field-longitude')!.value).toBe('')
  expect(container.textContent).toContain('Enter the longitude too; the map shows samples with both.')
  const longitude = container.querySelector<HTMLInputElement>('#field-longitude')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(longitude, '-82.5515')
    longitude.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => longitude.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await waitFor(() => requests.some(request => request.method === 'PATCH'))
  expect(requests.find(request => request.method === 'PATCH')!.body).toEqual({ longitude: -82.5515 })
})

test('the positive assay row is flagged at its left edge, beside its badge', () => {
  const row = container.querySelector('section[aria-label="Assays"] tbody tr')!
  expect(row.getAttribute('data-positive')).toBe('true')
  expect(row.querySelector('td')!.className).toContain('shadow-[inset_3px_0_0_0')
  expect(row.querySelector('[data-tone="positive"]')!.textContent).toBe('+positive')
  expect(row.querySelector('[data-result-value]')!.textContent).toBe('31.2 cycles')
})
