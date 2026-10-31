// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BatchPage } from './BatchPage'
import type { BatchDetail, BatchSampleRow } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.hasPointerCapture ??= () => false

const row = (sample_id: number, sample_code: string, fields: Partial<BatchSampleRow> = {}): BatchSampleRow => ({
  sample_id, sample_code, subject_code: 'DEV-H300', external_sample_id: null, sample_type_id: 3, sample_type: 'Serum', aliquot_number: null,
  collection_date: '2025-01-01T00:00:00', received_date: '2025-01-23T14:00:00', status: 'available', current_quantity: '1.000000', quantity_unit: 'mL',
  storage_location_id: null, storage_location_code: null, child_count: 0, ...fields,
})

const BATCH: BatchDetail = {
  batch_id: 3, batch_code: 'HOSP-2025-01', batch_name: 'Hospital CSF and serum', description: null, is_active: true,
  samples: [row(11, 'HOSP-2025-01-01', { child_count: 2 }), row(12, 'HOSP-2025-01-02'), row(13, 'HOSP-2025-01-03'), row(14, 'HOSP-2025-01-04', { subject_code: 'DEV-H301', sample_type_id: 4, sample_type: 'CSF' })],
}

let patches: { changes: Record<string, unknown>[] }[] = []
let respond: () => Response

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  if (init?.method === 'PATCH' && url.pathname === '/api/batches/3/samples') {
    patches.push(JSON.parse(String(init.body)))
    return Promise.resolve(respond())
  }
  if (url.pathname === '/api/batches/3') return Promise.resolve(Response.json(BATCH))
  if (url.pathname === '/api/sample-types') return Promise.resolve(Response.json([
    { sample_type_id: 3, type_code: 'serum', type_name: 'Serum' }, { sample_type_id: 4, type_code: 'csf', type_name: 'CSF' }, { sample_type_id: 5, type_code: 'whole_blood', type_name: 'Whole blood' },
  ]))
  if (url.pathname === '/api/storage-locations') return Promise.resolve(Response.json([
    { storage_location_id: 8, parent_location_id: null, location_code: 'BOX-148', location_type: 'box', location_name: null, is_active: true },
  ]))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  patches = []
  respond = () => Response.json(BATCH)
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/batch/3']}>
        <Routes><Route path="/batch/:id" element={<BatchPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
  await waitFor(() => container.querySelectorAll('select[aria-label="Material for selected"] option').length === 4)
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

const byLabel = <T extends HTMLElement = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === text)!

async function setValue(label: string, text: string) {
  const element = byLabel(label)
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

async function select(code: string) {
  await act(async () => byLabel<HTMLButtonElement>(`Select ${code}`).click())
}

test('every root sample is a row with its editable fields', () => {
  expect(container.querySelector('h1')!.textContent).toContain('HOSP-2025-01')
  expect(container.textContent).toContain('4 root samples from 2 subjects')
  expect(byLabel('Subject for HOSP-2025-01-01').value).toBe('DEV-H300')
  expect(byLabel<HTMLSelectElement>('Material for HOSP-2025-01-04').value).toBe('4')
  expect(byLabel('Received for HOSP-2025-01-01').value).toBe('2025-01-23')
  expect(byLabel('Unsaved changes').className).toContain('hidden')
})

test('row edits are saved together, only the changed fields', async () => {
  await setValue('Subject for HOSP-2025-01-02', 'DEV-H302')
  await setValue('Aliquot number for HOSP-2025-01-01', '1')
  await setValue('Received for HOSP-2025-01-01', '2025-01-24')

  expect(container.textContent).toContain('2 samples changed')
  await act(async () => button('Save changes').click())
  await waitFor(() => patches.length === 1)

  expect(patches[0].changes).toEqual([
    { sample_id: 11, aliquot_number: 1, received_date: '2025-01-24T14:00:00' },
    { sample_id: 12, subject_code: 'DEV-H302' },
  ])
})

test('Material is set on the selected rows only', async () => {
  await select('HOSP-2025-01-01')
  await select('HOSP-2025-01-03')
  await setValue('Material for selected', '5')
  await act(async () => byLabel<HTMLButtonElement>('Set material on selected samples').click())

  expect(byLabel<HTMLSelectElement>('Material for HOSP-2025-01-01').value).toBe('5')
  expect(byLabel<HTMLSelectElement>('Material for HOSP-2025-01-02').value).toBe('3')
  await act(async () => button('Save changes').click())
  await waitFor(() => patches.length === 1)
  expect(patches[0].changes).toEqual([{ sample_id: 11, sample_type_id: 5 }, { sample_id: 13, sample_type_id: 5 }])
})

test('aliquot numbers are given in order, never the same number to every row', async () => {
  await act(async () => byLabel<HTMLButtonElement>('Select all samples').click())
  await act(async () => button('Number in order').click())

  expect(['01', '02', '03', '04'].map(n => byLabel(`Aliquot number for HOSP-2025-01-${n}`).value)).toEqual(['1', '2', '3', '4'])
})

test('a refused save keeps the edits and marks the cell that was refused', async () => {
  respond = () => Response.json({ detail: [{ loc: ['body', 'changes', 1, 'aliquot_number'], msg: 'Aliquot 1 is also HOSP-2025-01-01: same subject and Material', type: 'value_error' }] }, { status: 422 })
  await setValue('Aliquot number for HOSP-2025-01-01', '1')
  await setValue('Aliquot number for HOSP-2025-01-02', '1')

  await act(async () => button('Save changes').click())
  await waitFor(() => container.querySelector('[role="alert"]') !== null)

  expect(byLabel('Aliquot number for HOSP-2025-01-02').getAttribute('aria-invalid')).toBe('true')
  expect(byLabel('Aliquot number for HOSP-2025-01-01').getAttribute('aria-invalid')).toBeNull()
  expect(container.textContent).toContain('HOSP-2025-01-02: Aliquot 1 is also HOSP-2025-01-01')
  expect(container.textContent).toContain('Nothing was saved')
  expect(byLabel('Aliquot number for HOSP-2025-01-02').value).toBe('1')
})
