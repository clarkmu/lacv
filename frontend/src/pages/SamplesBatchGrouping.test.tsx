// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SamplesPage } from './SamplesPage'
import { batchFriendlyOrder, continuesBatch } from '../batchGrouping'
import type { SampleListItem } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PEDS = { batch_id: 8, batch_code: 'PEDS-2026-10', batch_name: 'Peds clinic, October 2026' }
const MOSQ = { batch_id: 5, batch_code: 'MOSQ-2026-W31', batch_name: 'Mosquito surveillance, week 31' }

function sample(sample_id: number, sample_code: string, batch: typeof PEDS | null, received_date: string | null, parent_sample_id: number | null = null): SampleListItem {
  return {
    sample_id, sample_code, sample_type: null, status: 'received', sample_type_id: null, parent_sample_id, batch_id: batch?.batch_id ?? null, batch,
    external_sample_id: null, subject_code: null, aliquot_number: null, label: null, received_date, current_quantity: null, quantity_unit: null,
    storage_location_id: null, legacy_codes: [],
  }
}

// In the API's order (newest first). Received dates interleave the two batches.
const SAMPLES = [
  sample(18, 'B-A1-RNA', null, null, 11),
  sample(17, 'LOOSE-2', null, '2026-10-09T00:00:00'),
  sample(16, 'LOOSE-1', null, '2026-10-08T00:00:00'),
  sample(15, 'B-B2', MOSQ, '2026-10-05T00:00:00'),
  sample(14, 'B-B1', MOSQ, '2026-10-02T00:00:00'),
  sample(13, 'B-A10', PEDS, '2026-10-04T00:00:00'),
  sample(12, 'B-A2', PEDS, '2026-10-03T00:00:00'),
  sample(11, 'B-A1', PEDS, '2026-10-01T00:00:00'),
]

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lacv.test')
    const rows = url.searchParams.get('root_only') === 'true' ? SAMPLES.filter(row => row.parent_sample_id === null) : SAMPLES
    return Promise.resolve(Response.json(rows))
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><SamplesPage /></MemoryRouter></QueryClientProvider>))
  await waitFor(() => rows().length > 0)
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

const headers = () => [...container.querySelectorAll('thead th')].map(cell => cell.textContent)
const rows = () => [...container.querySelectorAll('tbody tr')].filter(row => row.querySelectorAll('td').length > 1)

/** Each displayed row as [sample code, what its Batch cell shows]: the batch code, "" when visibly blank, or "no batch". */
function grouping() {
  const sampleColumn = headers().indexOf('Sample')
  return rows().map(row => {
    const cells = row.querySelectorAll('td')
    const batch = cells[0]
    const shown = batch.querySelector('a') ? batch.querySelector('a')!.textContent
      : batch.querySelector('[data-batch-continued]') ? ''
      : batch.querySelector('[title="No shipping batch"]') ? 'no batch'
      : `unexpected: ${batch.innerHTML}`
    return [cells[sampleColumn].textContent, shown]
  })
}

function header(label: string) {
  return [...container.querySelectorAll('th button')].find(button => button.textContent?.startsWith(label)) as HTMLButtonElement
}

async function typeSearch(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Filter"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('Batch is the first column; each batch is named on its first row and left blank while it continues', () => {
  expect(headers()[0]).toBe('Batch')
  expect(grouping()).toEqual([
    ['B-A1', 'PEDS-2026-10'], ['B-A2', ''], ['B-A10', ''],
    ['B-B1', 'MOSQ-2026-W31'], ['B-B2', ''],
    // Samples without a batch are not a group: each shows the muted dash, never a blank.
    ['LOOSE-2', 'no batch'], ['LOOSE-1', 'no batch'],
  ])
  const link = rows()[0].querySelector('td a')!
  expect(link.getAttribute('href')).toBe('/batch/8')
  expect(link.getAttribute('title')).toBe('Peds clinic, October 2026')
  // A blank cell still tells a screen reader which batch it is.
  expect(rows()[1].querySelector('td')!.textContent).toBe('PEDS-2026-10')
})

test('a sort that interleaves batches names the batch again at every new run, never leaving a misleading blank', async () => {
  await act(async () => header('Received').click())

  expect(grouping()).toEqual([
    ['B-A1', 'PEDS-2026-10'],
    ['B-B1', 'MOSQ-2026-W31'],
    ['B-A2', 'PEDS-2026-10'],
    ['B-A10', ''],
    ['B-B2', 'MOSQ-2026-W31'],
    ['LOOSE-1', 'no batch'],
    ['LOOSE-2', 'no batch'],
  ])

  // Sorting by Batch itself keeps each batch together again.
  await act(async () => header('Batch').click())
  expect(grouping().map(([, batch]) => batch)).toEqual(['no batch', 'no batch', 'MOSQ-2026-W31', '', 'PEDS-2026-10', '', ''])
})

test('filtering keeps the grouping truthful: the first visible row of a batch is named', async () => {
  await typeSearch('B-A2')
  expect(grouping()).toEqual([['B-A2', 'PEDS-2026-10']])

  await typeSearch('Mosquito surveillance')
  expect(grouping()).toEqual([['B-B1', 'MOSQ-2026-W31'], ['B-B2', '']])
})

test('with derived samples listed, Parent appears, Legacy codes stays absent, and derived samples have no batch', async () => {
  expect(headers()).not.toContain('Parent')
  const checkbox = container.querySelector<HTMLButtonElement>('#base-samples-only')!
  await act(async () => checkbox.click())
  await waitFor(() => rows().length === SAMPLES.length)

  expect(headers()[0]).toBe('Batch')
  expect(headers()).toContain('Parent')
  expect(headers().some(label => label?.toLowerCase().includes('legacy'))).toBe(false)
  expect(grouping().at(0)).toEqual(['B-A1', 'PEDS-2026-10'])
  expect(grouping().find(([code]) => code === 'B-A1-RNA')).toEqual(['B-A1-RNA', 'no batch'])
})

test('the default order keeps each batch together, newest batch first, codes in natural order', () => {
  expect(batchFriendlyOrder(SAMPLES).map(row => row.sample_code)).toEqual(['B-A1', 'B-A2', 'B-A10', 'B-B1', 'B-B2', 'B-A1-RNA', 'LOOSE-2', 'LOOSE-1'])
  expect(continuesBatch(SAMPLES[6], SAMPLES[7])).toBe(true)
  expect(continuesBatch(SAMPLES[3], SAMPLES[5])).toBe(false)
  expect(continuesBatch(SAMPLES[1], SAMPLES[2]), 'two unbatched samples are not a run').toBe(false)
  expect(continuesBatch(SAMPLES[7], undefined)).toBe(false)
})
