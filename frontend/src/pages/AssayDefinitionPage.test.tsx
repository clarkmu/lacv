// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AssayDefinitionPage } from './AssayDefinitionPage'
import type { AssayDefinitionDetail, AssayExecution, ExecutionResult, ExecutionSample, ResultField, SampleListItem } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LACV = 101
const RNASE = 102
const FIELDS: ResultField[] = [
  { assay_definition_result_id: LACV, analyte: 'LACV', result_name: 'CT', unit: 'cycles', value_type: 'either', label: 'LACV CT' },
  { assay_definition_result_id: RNASE, analyte: 'RNase P', result_name: 'CT', unit: 'cycles', value_type: 'numeric', label: 'RNase P CT' },
]

const ref = (sample_id: number, sample_code: string) => ({ sample_id, sample_code, sample_type: 'RNA', status: 'available' })
const value = (field: number, numeric: string | null, text: string | null = null, interpretation: string | null = null): ExecutionResult => ({
  assay_definition_result_id: field, numeric_value: numeric, text_value: text, interpretation, qc_status: 'not_reviewed',
})
const row = (id: number, sample_id: number, code: string, results: ExecutionResult[] = []): ExecutionSample => ({
  assay_execution_sample_id: id, sample: ref(sample_id, code), results, volume_used: '5.000000', volume_unit: 'uL',
})
const execution = (id: number, name: string, samples: ExecutionSample[], fields: Partial<AssayExecution> = {}): AssayExecution => ({
  assay_execution_id: id, execution_name: name, assay_definition_id: 1, operator_name: 'J. Chen', assay_date: '2026-10-07T10:00:00',
  status: 'completed', qc_status: 'not_reviewed', notes: null, samples, output_samples: [], data_files: [], ...fields,
})
const listed = (sample_id: number, sample_code: string): SampleListItem => ({
  ...ref(sample_id, sample_code), sample_type_id: 7, parent_sample_id: 1, batch_id: null, external_sample_id: null, subject_code: null, aliquot_number: null,
  label: null, received_date: null, current_quantity: '50.000000', quantity_unit: 'uL', storage_location_id: null, legacy_codes: [],
})

let definition: AssayDefinitionDetail
let requests: { method: string; path: string; body: unknown }[] = []

/** Per-field means as the backend reports them: numeric values only, blanks and text counted separately. */
function summarize(current: AssayDefinitionDetail): AssayDefinitionDetail {
  const rows = current.executions.flatMap(item => item.samples)
  return {
    ...current,
    result_summaries: FIELDS.map(field => {
      const values = rows.map(item => item.results.find(result => result.assay_definition_result_id === field.assay_definition_result_id)).filter(Boolean) as ExecutionResult[]
      const numbers = values.filter(item => item.numeric_value !== null).map(item => Number(item.numeric_value))
      const text = values.filter(item => item.text_value !== null).length
      return {
        assay_definition_result_id: field.assay_definition_result_id, label: field.label, unit: field.unit, averageable: true,
        mean: numbers.length ? String(numbers.reduce((sum, number) => sum + number, 0) / numbers.length) : null,
        numeric_count: numbers.length, text_count: text, empty_count: rows.length - numbers.length - text,
      }
    }),
  }
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  if (method !== 'GET') requests.push({ method, path: url.pathname, body })
  const result = /^\/api\/assay-executions\/(\d+)\/samples\/(\d+)\/results\/(\d+)$/.exec(url.pathname)
  if (method === 'PATCH' && result) {
    const [executionId, sampleId, fieldId] = result.slice(1).map(Number)
    definition = summarize({
      ...definition,
      executions: definition.executions.map(item => item.assay_execution_id !== executionId ? item : {
        ...item,
        samples: item.samples.map(sample => {
          if (sample.sample.sample_id !== sampleId) return sample
          const existing = sample.results.find(entry => entry.assay_definition_result_id === fieldId) ?? value(fieldId, null)
          const typed = 'value' in body ? body.value as string | null : null
          const next = 'value' in body
            ? { ...existing, numeric_value: typed !== null && /^[\d.]+$/.test(typed) ? typed : null, text_value: typed !== null && !/^[\d.]+$/.test(typed) ? typed : null }
            : { ...existing, ...body }
          return { ...sample, results: [...sample.results.filter(entry => entry.assay_definition_result_id !== fieldId), next] }
        }),
      }),
    })
    return Promise.resolve(Response.json(definition.executions.find(item => item.assay_execution_id === executionId)))
  }
  if (method === 'POST' && url.pathname === '/api/assay-definitions/1/executions') {
    return Promise.resolve(Response.json(execution(13, body.execution_name, []), { status: 201 }))
  }
  if (method === 'POST' && url.pathname === '/api/assay-definitions/1/executions/import/preview') {
    return Promise.resolve(Response.json({
      source: { file_name: 'plate.xlsx', sha256: 'ab'.repeat(32), sheets: ['Samples', 'Execution'] },
      execution: { execution_name: 'Plate from XLSX', assay_date: null, operator_name: null, notes: null },
      problems: [], can_import: true,
      rows: [
        { row_number: 2, sample_code: 'S-1-RNA', match: 'exact', sample: ref(31, 'S-1-RNA'), candidates: [], duplicate_of_row: null, volume_used: null, volume_unit: null, problems: [],
          results: [{ assay_definition_result_id: LACV, value: '29.9', interpretation: 'positive', qc_status: null }] },
        { row_number: 3, sample_code: 's 2 rna', match: 'close', sample: null, duplicate_of_row: null, volume_used: null, volume_unit: null, problems: [], results: [],
          candidates: [{ sample: ref(32, 'S-2-RNA'), reason: 'same code apart from case, spaces or punctuation' }] },
      ],
    }))
  }
  if (url.pathname === '/api/assay-definitions/1') return Promise.resolve(Response.json(definition))
  if (url.pathname === '/api/samples') return Promise.resolve(Response.json([listed(31, 'S-1-RNA'), listed(32, 'S-2-RNA'), listed(33, 'S-3-RNA')]))
  if (url.pathname === '/api/assay-executions/performed-by') return Promise.resolve(Response.json(['J. Chen']))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  requests = []
  definition = summarize({
    assay_definition_id: 1, assay_code: 'LACV-RNASEP-DUPLEX', assay_name: 'LACV / RNase P duplex RT-qPCR', assay_type: 'qPCR', target: 'LACV, RNase P', kit: 'TaqPath',
    instrument: 'QuantStudio 5', typical_volume: '5.000000', typical_volume_unit: 'uL', result_fields: FIELDS, is_active: true,
    execution_count: 2, sample_count: 4, last_performed: '2026-10-08T10:00:00', description: null, created_at: '2026-01-01T00:00:00',
    next_execution_name: 'LACV-RNASEP-DUPLEX-004', result_summaries: [],
    executions: [
      execution(12, 'LACV-RNASEP-DUPLEX-003', [
        row(1, 21, 'P-01-RNA', [value(LACV, '30.00000000', null, 'positive'), value(RNASE, '24.00000000')]),
        row(2, 22, 'P-02-RNA', [value(LACV, null, 'not detected', 'negative'), value(RNASE, '26.00000000')]),
        row(3, 23, 'P-03-RNA'),
      ]),
      execution(11, 'Plate 3 rerun', [row(4, 24, 'P-04-RNA', [value(LACV, '33.00000000')])], { status: 'failed', notes: 'NTC amplified' }),
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
const average = (label: string) => byLabel<HTMLElement>(`Average ${label}`).textContent
const cell = (field: string, code: string, executionId = 12) => byLabel(`${field} for ${code} in execution ${executionId}`)

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

test('the assay\'s result fields are the editable columns, grouped under each execution ID, with no name column', () => {
  const columns = [...container.querySelectorAll('table[aria-label="Executions and their samples"] thead th')].map(th => th.textContent)
  expect(columns).toEqual(['Sample', 'Type', 'LACV CT (cycles)', 'Interpretation', 'QC', 'RNase P CT (cycles)', 'Interpretation', 'QC', 'Volume used', 'Remove'])
  expect(groupRows(12)).toEqual(['P-01-RNA', 'P-02-RNA', 'P-03-RNA'])
  expect(groupRows(11)).toEqual(['P-04-RNA'])
  const header = byLabel<HTMLElement>('Execution 12').querySelector('th')!
  expect(header.textContent).toContain('#12')
  expect(header.querySelector('[data-testid="execution-name"]')?.textContent).toBe('LACV-RNASEP-DUPLEX-003')
  expect(cell('LACV CT', 'P-01-RNA').value).toBe('30')
  expect(cell('LACV CT interpretation', 'P-01-RNA').value).toBe('positive')
  expect(cell('RNase P CT', 'P-02-RNA').value).toBe('26')
  expect(byLabel<HTMLSelectElement>('LACV CT QC for P-01-RNA in execution 12').value).toBe('not_reviewed')
})

test('a sample with no results yet shows every field blank', () => {
  expect(cell('LACV CT', 'P-03-RNA').value).toBe('')
  expect(cell('LACV CT interpretation', 'P-03-RNA').value).toBe('')
  expect(cell('RNase P CT', 'P-03-RNA').value).toBe('')
  expect(byLabel('LACV CT QC for P-03-RNA in execution 12'), 'no QC until something is entered').toBeNull()
})

test('the assay is shown read-only: no Edit or Retire', () => {
  for (const label of ['Edit', 'Retire', 'Put back in use']) expect(button(label)).toBeUndefined()
  expect(container.querySelector('a[href$="/edit"]')).toBeNull()
  expect(byLabel<HTMLElement>('Procedure').textContent).toContain('LACV CT (cycles) · number or text')
  expect(button('New execution')).toBeDefined()
})

test('each numeric field has its own average, without blanks or text', () => {
  expect(average('LACV CT')).toContain('31.5')
  expect(average('LACV CT')).toContain('mean of 2; 1 text not averaged; 1 not entered')
  expect(average('RNase P CT')).toContain('25')
  expect(average('RNase P CT')).toContain('mean of 2; 2 not entered')
})

test('a field entered later changes only that sample, and its average follows', async () => {
  const target = cell('LACV CT', 'P-03-RNA')
  await type(target, '36')
  await key(target, 'Enter')
  await waitFor(() => average('LACV CT')!.includes('mean of 3'))

  expect(requests).toEqual([{ method: 'PATCH', path: `/api/assay-executions/12/samples/23/results/${LACV}`, body: { value: '36' } }])
  expect(average('LACV CT')).toContain('33')
  expect(cell('LACV CT', 'P-03-RNA').value).toBe('36')
  expect(cell('LACV CT', 'P-01-RNA').value, 'Sample A is untouched').toBe('30')
  expect(cell('RNase P CT', 'P-03-RNA').value, 'the other field stays blank').toBe('')
})

test('interpretation and QC are edited on their own, and Escape puts the saved value back', async () => {
  const interpretation = cell('LACV CT interpretation', 'P-02-RNA')
  await type(interpretation, 'equivocal')
  await key(interpretation, 'Escape')
  expect(interpretation.value).toBe('negative')

  await type(interpretation, 'inconclusive')
  await act(async () => interpretation.blur())
  await waitFor(() => requests.length === 1)
  expect(requests[0]).toEqual({ method: 'PATCH', path: `/api/assay-executions/12/samples/22/results/${LACV}`, body: { interpretation: 'inconclusive' } })

  const qc = byLabel<HTMLSelectElement>('LACV CT QC for P-02-RNA in execution 12')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(qc, 'accepted')
    qc.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await waitFor(() => requests.length === 2)
  expect(requests[1].body).toEqual({ qc_status: 'accepted' })
})

test('a new execution takes several samples, each once, with every result column optional', async () => {
  await act(async () => button('New execution')!.click())
  await waitFor(() => container.querySelector('form[aria-label="New execution"]') !== null)
  const name = byLabel('Execution name')
  expect(name.value).toBe('LACV-RNASEP-DUPLEX-004')
  await type(name, 'Plate 4, Nov batch')
  const heads = [...container.querySelectorAll('table[aria-label="Samples in the new execution"] thead th')].map(th => th.textContent)
  expect(heads).toEqual(['#', 'Sample', 'Type', 'LACV CT (cycles)', 'LACV CT interpretation', 'RNase P CT (cycles)', 'RNase P CT interpretation', 'Volume used · typical 5 uL', 'Remove'])

  const finder = byLabel('Find a sample to add')
  await type(finder, 'S-1-RNA')
  await key(finder, 'Enter')
  await type(finder, 's-2')
  await key(finder, 'ArrowDown')
  await key(finder, 'Enter')
  await type(finder, 'S-1-RNA')
  await key(finder, 'Enter')
  expect(container.textContent).toContain('S-1-RNA is already in this execution.')
  await type(finder, 'S-3-RNA')
  await key(finder, 'Enter')
  await act(async () => byLabel<HTMLButtonElement>('Remove S-3-RNA').click())
  await type(byLabel('RNase P CT for S-2-RNA'), '25.1')

  await act(async () => button('Save execution')!.click())
  await waitFor(() => requests.length === 1)
  expect(requests[0].path).toBe('/api/assay-definitions/1/executions')
  expect(requests[0].body).toMatchObject({
    execution_name: 'Plate 4, Nov batch',
    samples: [
      { sample_id: 31, results: [], volume_used: null, volume_unit: null },
      { sample_id: 32, results: [{ assay_definition_result_id: RNASE, value: '25.1', interpretation: null, qc_status: null }] },
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

test('an uploaded workbook opens a review dialog, and its confirmed rows join the new execution', async () => {
  await act(async () => button('New execution')!.click())
  const input = byLabel<HTMLInputElement>('Execution workbook')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'plate.xlsx')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await waitFor(() => document.querySelector('[role="dialog"]') !== null)

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect([...dialog.querySelectorAll('section')].map(section => section.getAttribute('aria-label'))).toEqual(['Possible match', 'Matched'])
  const add = () => [...dialog.querySelectorAll('button')].find(element => element.textContent?.startsWith('Add '))!
  expect(add().disabled).toBe(true)
  await act(async () => [...dialog.querySelectorAll('button')].find(element => element.textContent?.startsWith('Use S-2-RNA'))!.click())
  await act(async () => add().click())

  expect(document.querySelector('[role="dialog"]')).toBeNull()
  const rows = [...container.querySelectorAll('table[aria-label="Samples in the new execution"] tbody tr')].slice(0, -1).map(tr => tr.querySelectorAll('td')[1].textContent)
  expect(rows).toEqual(['S-1-RNA', 'S-2-RNA'])
  expect(byLabel('LACV CT for S-1-RNA').value).toBe('29.9')
  expect(byLabel('LACV CT interpretation for S-1-RNA').value).toBe('positive')
  expect(byLabel('Execution name').value).toBe('Plate from XLSX')
})
