// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DEFINITIONS = [{
  assay_definition_id: 1, assay_code: 'LACV-QPCR-SYBR', assay_name: 'LACV qPCR (SYBR Green)', assay_type: 'qPCR', target: 'LACV', kit: null, instrument: null,
  typical_volume: null, typical_volume_unit: null, is_active: true,
  result_fields: [{ assay_definition_result_id: 1, analyte: 'LACV', result_name: 'CT', unit: 'cycles', value_type: 'either', label: 'LACV CT' }],
  execution_count: 12, sample_count: 57, last_performed: null,
}]

let container: HTMLDivElement
let root: Root
let path = ''

function Where() {
  path = useLocation().pathname
  return null
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lacv.test')
    if (url.pathname === '/api/assay-definitions') return Promise.resolve(Response.json(DEFINITIONS))
    if (url.pathname === '/api/batches') return Promise.resolve(Response.json([]))
    return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
  }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function open(entry: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}><App /><Where /></MemoryRouter>
    </QueryClientProvider>,
  ))
  await act(() => new Promise(resolve => setTimeout(resolve, 20)))
}

test('there is no standalone execution page: executions live on their assay', async () => {
  for (const entry of ['/assay-executions/9', '/assay/9']) {
    await open(entry)
    expect(path, entry).toBe('/batches')
    act(() => root.unmount())
    container.remove()
  }
  await open('/assays/1')
  expect(path).toBe('/assays/1')
})

test('the Assays list offers New assay but no XLSX import of assays', async () => {
  await open('/assays')

  const actions = [...container.querySelectorAll('a, button')].map(element => element.textContent?.trim())
  expect(actions).toContain('New assay')
  expect(actions).not.toContain('Import from XLSX')
  expect(container.querySelector('a[href="/assays/import"]')).toBeNull()
  expect(container.textContent).toContain('LACV CT (cycles)')
})
