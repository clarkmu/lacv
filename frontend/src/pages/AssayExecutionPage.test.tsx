// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AssayExecutionPage } from './AssayExecutionPage'
import type { AssayExecutionDetail, AssayResult } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const result = (id: number, fields: Partial<AssayResult>): AssayResult => ({
  assay_result_id: id, analyte: null, result_name: 'CT', numeric_value: null, text_value: null, unit: 'cycles', interpretation: null, qc_status: 'not_reviewed', ...fields,
})

function execution(results: AssayResult[]): AssayExecutionDetail {
  return {
    execution_id: 9, execution_code: 'ASSAY-009', assay_definition_id: 3, assay_name: 'LACV / RNase P duplex', assay_type: 'qPCR', target: 'LACV, RNase P',
    sample: { sample_id: 5, sample_code: 'S-005-RNA', sample_type: 'RNA', status: 'available' }, operator_name: 'J. Chen', assay_date: '2026-10-03T10:00:00',
    status: 'completed', qc_status: 'not_reviewed', result_count: results.length, notes: null, volume_used: '5.000000', volume_unit: 'uL',
    definition: {
      assay_definition_id: 3, assay_code: 'LACV-RNASEP-DUPLEX', assay_name: 'LACV / RNase P duplex', assay_type: 'qPCR', target: 'LACV, RNase P', kit: 'TaqPath', instrument: null,
      typical_volume: '5.000000', typical_volume_unit: 'uL', is_active: true,
      expected_results: [{ analyte: 'LACV', result_name: 'CT', unit: 'cycles', value_type: 'either' }, { analyte: 'RNase P', result_name: 'CT', unit: 'cycles', value_type: 'numeric' }],
    },
    results, output_samples: [], data_files: [],
  }
}

let current: AssayExecutionDetail
let calls: { method: string; path: string; body: unknown }[] = []

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : null
  if (method !== 'GET') calls.push({ method, path: url.pathname, body })
  const base = '/api/assay-executions/9/results'
  if (method === 'POST' && url.pathname === base) {
    current = execution([...current.results, result(100 + current.results.length, body)])
  } else if (method === 'PATCH' && url.pathname.startsWith(`${base}/`)) {
    const id = Number(url.pathname.split('/').at(-1))
    current = execution(current.results.map(row => (row.assay_result_id === id ? { ...row, ...body } : row)))
  } else if (method === 'DELETE' && url.pathname.startsWith(`${base}/`)) {
    const id = Number(url.pathname.split('/').at(-1))
    current = execution(current.results.filter(row => row.assay_result_id !== id))
  }
  if (url.pathname.startsWith('/api/assay-executions/9')) return Promise.resolve(Response.json(current))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  calls = []
  current = execution([result(1, { analyte: 'LACV', text_value: 'not detected', interpretation: 'negative' }), result(2, { analyte: 'RNase P', numeric_value: '25.90000000', qc_status: 'accepted' })])
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/assay-executions/9']}>
        <Routes><Route path="/assay-executions/:id" element={<AssayExecutionPage />} /></Routes>
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
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  throw new Error(`Timed out waiting. Page text: ${container.textContent}`)
}

const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
const button = (text: string) => [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === text)!
const resultRows = () => [...container.querySelectorAll('section[aria-label^="Results"] tbody tr')].map(row => [...row.querySelectorAll('td')].slice(0, 3).map(cell => cell.textContent))

async function type(label: string, text: string) {
  const input = byLabel(label) as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('the page shows the procedure, the sample and the execution, with the results first', () => {
  expect(container.querySelector('h1')!.textContent).toBe('LACV / RNase P duplex on S-005-RNA')
  const steps = byLabel('Assay, sample and execution')
  expect(steps.querySelector('a[href="/assays/3"]')?.textContent).toBe('LACV / RNase P duplex')
  expect(steps.querySelector('a[href="/sample/5"]')?.textContent).toBe('S-005-RNA')
  expect(resultRows()).toEqual([['LACV', 'CT', 'not detected'], ['RNase P', 'CT', '25.9']])
})

test('a result is added, numbers are sent as numbers', async () => {
  await act(async () => button('Add result').click())
  await type('Result name', 'Melt temperature')
  await type('Value', '78.5')
  await type('Unit', '°C')
  await act(async () => button('Save').click())
  await waitFor(() => resultRows().length === 3)

  expect(calls).toEqual([{ method: 'POST', path: '/api/assay-executions/9/results', body: {
    analyte: null, result_name: 'Melt temperature', numeric_value: '78.5', text_value: null, unit: '°C', interpretation: null, qc_status: 'not_reviewed',
  } }])
  expect(resultRows()[2]).toEqual(['', 'Melt temperature', '78.5'])
})

test('a result is edited in place', async () => {
  await act(async () => byLabel('Edit LACV CT').click())
  await type('Value', '34.2')
  await type('Interpretation', 'positive')
  await act(async () => button('Save').click())
  await waitFor(() => resultRows()[0][2] === '34.2')

  expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/assay-executions/9/results/1', body: { numeric_value: '34.2', text_value: null, interpretation: 'positive' } })
})

test('removing asks first, and an accepted result cannot be removed', async () => {
  expect((byLabel('Remove RNase P CT') as HTMLButtonElement).disabled).toBe(true)

  await act(async () => byLabel('Remove LACV CT').click())
  expect(calls).toEqual([])
  await act(async () => button('Remove result').click())
  await waitFor(() => resultRows().length === 1)

  expect(calls).toEqual([{ method: 'DELETE', path: '/api/assay-executions/9/results/1', body: null }])
})

test('results the assay reports but are missing can be added in one click', async () => {
  await act(async () => byLabel('Remove LACV CT').click())
  await act(async () => button('Remove result').click())
  await waitFor(() => resultRows().length === 1)

  await act(async () => button('LACV CT').click())

  expect((byLabel('Analyte') as HTMLInputElement).value).toBe('LACV')
  expect((byLabel('Result name') as HTMLInputElement).value).toBe('CT')
  expect((byLabel('Unit') as HTMLInputElement).value).toBe('cycles')
})
