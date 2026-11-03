// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AssayDefinitionPage } from './AssayDefinitionPage'
import type { AssayDefinitionDetail, AssayExecution, ExecutionSample, SampleListItem } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ref = (sample_id: number, sample_code: string) => ({ sample_id, sample_code, sample_type: 'cDNA', status: 'available' })
const row = (id: number, sample_id: number, code: string, result_numeric: string | null, result_text: string | null = null): ExecutionSample => ({
  assay_execution_sample_id: id, sample: ref(sample_id, code), result_numeric, result_text, volume_used: '2.000000', volume_unit: 'uL',
})
const execution = (id: number, name: string, samples: ExecutionSample[], fields: Partial<AssayExecution> = {}): AssayExecution => ({
  assay_execution_id: id, execution_name: name, assay_definition_id: 1, operator_name: 'J. Chen', assay_date: '2026-10-07T10:00:00',
  status: 'completed', qc_status: 'not_reviewed', notes: null, samples, output_samples: [], data_files: [], ...fields,
})
const listed = (sample_id: number, sample_code: string): SampleListItem => ({
  ...ref(sample_id, sample_code), sample_type_id: 8, parent_sample_id: 1, batch_id: null, external_sample_id: null, subject_code: null, aliquot_number: null,
  label: null, received_date: null, current_quantity: '20.000000', quantity_unit: 'uL', storage_location_id: null, legacy_codes: [],
})

let definition: AssayDefinitionDetail
let requests: { method: string; path: string; body: unknown }[] = []

function summarize(current: AssayDefinitionDetail): AssayDefinitionDetail {
  const rows = current.executions.flatMap(item => item.samples)
  const numbers = rows.filter(item => item.result_numeric !== null).map(item => Number(item.result_numeric))
  const text = rows.filter(item => item.result_text !== null).length
  return {
    ...current,
    result_summary: {
      mean: numbers.length ? String(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null,
      numeric_count: numbers.length, text_count: text, empty_count: rows.length - numbers.length - text, unit: 'cycles', averageable: true,
    },
  }
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  if (method !== 'GET') requests.push({ method, path: url.pathname, body })
  const result = /^\/api\/assay-executions\/(\d+)\/samples\/(\d+)$/.exec(url.pathname)
  if (method === 'PATCH' && result) {
    const [executionId, sampleId] = [Number(result[1]), Number(result[2])]
    const value = body.result as string | null
    const numeric = value !== null && /^[\d.]+$/.test(value)
    definition = summarize({
      ...definition,
      executions: definition.executions.map(item => item.assay_execution_id !== executionId ? item : {
        ...item, samples: item.samples.map(sample => sample.sample.sample_id !== sampleId ? sample : { ...sample, result_numeric: numeric ? value : null, result_text: numeric ? null : value }),
      }),
    })
    return Promise.resolve(Response.json(definition.executions.find(item => item.assay_execution_id === executionId)))
  }
  if (method === 'POST' && url.pathname === '/api/assay-definitions/1/executions') {
    return Promise.resolve(Response.json(execution(13, body.execution_name, []), { status: 201 }))
  }
  if (url.pathname === '/api/assay-definitions/1') return Promise.resolve(Response.json(definition))
  if (url.pathname === '/api/samples') return Promise.resolve(Response.json([listed(31, 'S-1-cDNA'), listed(32, 'S-2-cDNA'), listed(33, 'S-3-cDNA')]))
  if (url.pathname === '/api/assay-executions/performed-by') return Promise.resolve(Response.json(['J. Chen']))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  requests = []
  definition = summarize({
    assay_definition_id: 1, assay_code: 'LACV-QPCR-SYBR', assay_name: 'LACV qPCR (SYBR Green)', assay_type: 'qPCR', target: 'LACV', kit: 'PowerUp SYBR', instrument: 'QuantStudio 5',
    typical_volume: '2.000000', typical_volume_unit: 'uL', result_name: 'LACV CT', result_unit: 'cycles', result_value_type: 'either', is_active: true,
    execution_count: 2, sample_count: 4, last_performed: '2026-10-08T10:00:00', description: null, created_at: '2026-01-01T00:00:00',
    next_execution_name: 'LACV-QPCR-SYBR-013',
    result_summary: { mean: null, numeric_count: 0, text_count: 0, empty_count: 0, unit: 'cycles', averageable: true },
    executions: [
      execution(12, 'LACV-QPCR-SYBR-012', [row(1, 21, 'P-01-cDNA', '30.00000000'), row(2, 22, 'P-02-cDNA', null, 'not detected'), row(3, 23, 'P-03-cDNA', null)]),
      execution(11, 'Plate 3 rerun', [row(4, 24, 'P-04-cDNA', '33.00000000')], { status: 'failed', notes: 'NTC amplified' }),
    ],
  })
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/assays/1']}>
        <Routes><Route path="/assays/:id" element={<AssayDefinitionPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
  await waitFor(() => container.querySelector('h1') !== null)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (condition()) return
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  throw new Error(`Timed out waiting. Page text: ${container.textContent}`)
}

const byLabel = <T extends HTMLElement = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === text)
const groupRows = (executionId: number) => [...byLabel<HTMLElement>(`Execution ${executionId}`).querySelectorAll('tr')].slice(1).map(tr => tr.querySelector('td')?.textContent)
const average = () => byLabel<HTMLElement>('Average result').textContent

async function type(element: HTMLInputElement, text: string) {
  await act(async () => {
    element.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function key(element: HTMLElement, name: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })))
}

test('rows are grouped under their execution ID, with the name in the group header and not as a column', () => {
  expect(groupRows(12)).toEqual(['P-01-cDNA', 'P-02-cDNA', 'P-03-cDNA'])
  expect(groupRows(11)).toEqual(['P-04-cDNA'])
  const header = byLabel<HTMLElement>('Execution 12').querySelector('th')!
  expect(header.textContent).toContain('#12')
  expect(header.querySelector('[data-testid="execution-name"]')?.textContent).toBe('LACV-QPCR-SYBR-012')
  const columns = [...container.querySelectorAll('table[aria-label="Executions and their samples"] thead th')].map(th => th.textContent)
  expect(columns).toEqual(['Sample', 'Type', 'LACV CT (cycles)', 'Volume used', 'Remove'])
  expect(byLabel<HTMLElement>('Execution 11').textContent).toContain('NTC amplified')
})

test('the assay is shown read-only: no Edit or Retire', () => {
  for (const label of ['Edit', 'Retire', 'Put back in use']) expect(button(label)).toBeUndefined()
  expect(container.querySelector('a[href$="/edit"]')).toBeNull()
  expect(byLabel<HTMLElement>('Procedure').textContent).toContain('PowerUp SYBR')
  expect(button('New execution')).toBeDefined()
})

test('the average uses numeric results only and says what it is based on', () => {
  expect(average()).toContain('31.5')
  expect(average()).toContain('Mean of 2 numeric results; 1 text not averaged; 1 not entered')
})

test('a result is entered later, inline, and the average follows', async () => {
  const cell = byLabel('Result for P-03-cDNA in execution 12')
  expect(cell.value).toBe('')

  await type(cell, '36')
  await key(cell, 'Enter')
  await waitFor(() => average()!.includes('Mean of 3 numeric results'))

  expect(requests).toEqual([{ method: 'PATCH', path: '/api/assay-executions/12/samples/23', body: { result: '36' } }])
  expect(average()).toContain('33')
  expect(byLabel('Result for P-03-cDNA in execution 12').value).toBe('36')
})

test('a result can be changed to text, and Escape puts the saved value back', async () => {
  const cell = byLabel('Result for P-01-cDNA in execution 12')
  await type(cell, '29.5')
  await key(cell, 'Escape')
  expect(cell.value).toBe('30')

  await type(cell, 'inconclusive')
  await act(async () => cell.blur())
  await waitFor(() => requests.length === 1)
  expect(requests[0].body).toEqual({ result: 'inconclusive' })
})

test('a new execution starts with a generated, editable name and takes several samples, each once', async () => {
  await act(async () => button('New execution')!.click())
  await waitFor(() => container.querySelector('form[aria-label="New execution"]') !== null)
  const name = byLabel('Execution name')
  expect(name.value).toBe('LACV-QPCR-SYBR-013')
  await type(name, 'Plate 13, Oct batch')

  const finder = byLabel('Find a sample to add')
  await waitFor(() => true)
  await type(finder, 'S-1-cDNA')
  await key(finder, 'Enter')
  await type(finder, 's-2')
  await key(finder, 'ArrowDown')
  await key(finder, 'Enter')
  await type(finder, 'S-1-cDNA')
  await key(finder, 'Enter')
  expect(container.textContent).toContain('S-1-cDNA is already in this execution.')
  await type(finder, 'S-3-cDNA')
  await key(finder, 'Enter')
  await act(async () => byLabel<HTMLButtonElement>('Remove S-3-cDNA').click())
  await type(byLabel('Result for S-2-cDNA'), '31.7')

  const rows = [...container.querySelectorAll('table[aria-label="Samples in the new execution"] tbody tr')].slice(0, -1).map(tr => tr.querySelectorAll('td')[1].textContent)
  expect(rows).toEqual(['S-1-cDNA', 'S-2-cDNA'])

  await act(async () => button('Save execution')!.click())
  await waitFor(() => requests.length === 1)
  expect(requests[0].path).toBe('/api/assay-definitions/1/executions')
  expect(requests[0].body).toMatchObject({
    execution_name: 'Plate 13, Oct batch',
    samples: [
      { sample_id: 31, result: null, volume_used: null, volume_unit: null },
      { sample_id: 32, result: '31.7', volume_used: null, volume_unit: null },
    ],
  })
})

test('creating from an .xlsx workbook is part of the new-execution workflow', async () => {
  expect(byLabel('Execution workbook'), 'not offered before starting an execution').toBeNull()

  await act(async () => button('New execution')!.click())

  expect(byLabel<HTMLInputElement>('Execution workbook').type).toBe('file')
  expect(button('Import from XLSX')).toBeDefined()
  expect(container.querySelector('a[href="/api/assay-definitions/1/executions/import-template"]')?.textContent).toContain('Template')
})
