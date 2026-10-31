// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AssayImportPage } from './AssayImportPage'
import type { AssayImportPreview } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const GOOD: AssayImportPreview = {
  source: { file_name: 'hrtv.xlsx', sha256: 'ab'.repeat(32), sheets: ['Assay', 'Results'] },
  definition: {
    assay_code: null, assay_name: 'HRTV qPCR v2', assay_type: 'qPCR', target: 'HRTV', kit: 'PowerUp SYBR', instrument: null,
    typical_volume: '2', typical_volume_unit: 'uL', description: null, expected_results: [{ analyte: 'HRTV', result_name: 'CT', unit: 'cycles', value_type: 'either' }],
  },
  problems: [],
  can_import: true,
}
const BAD: AssayImportPreview = { ...GOOD, definition: null, problems: ['Assay sheet, assay_type: is required'], can_import: false }

let preview: AssayImportPreview
let requests: { path: string; fileName: string }[] = []

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  const file = (init?.body as FormData | undefined)?.get('file') as File | null
  if (file) requests.push({ path: url.pathname, fileName: file.name })
  if (url.pathname === '/api/assay-definitions/import/preview') return Promise.resolve(Response.json(preview))
  if (url.pathname === '/api/assay-definitions/import') return Promise.resolve(Response.json({ assay_definition_id: 42 }, { status: 201 }))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

function Landing() {
  return <p data-testid="landed">{useLocation().pathname}</p>
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  requests = []
  preview = GOOD
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/assays/import']}>
        <Routes>
          <Route path="/assays/import" element={<AssayImportPage />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
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

const createButton = () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Create assay'))!

async function chooseFile(name: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], name)] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await waitFor(() => container.querySelector('section[aria-label="Preview"]') !== null)
}

test('a workbook is previewed before anything is created, then confirmed', async () => {
  expect(createButton()).toBeUndefined()
  await chooseFile('hrtv.xlsx')

  const shown = container.querySelector('section[aria-label="Preview"]')!.textContent
  expect(shown).toContain('This workbook will create')
  expect(shown).toContain('HRTV qPCR v2')
  expect(shown).toContain('generated from the name')
  expect(requests).toEqual([{ path: '/api/assay-definitions/import/preview', fileName: 'hrtv.xlsx' }])

  await act(async () => createButton().click())
  await waitFor(() => container.querySelector('[data-testid="landed"]') !== null)
  expect(requests.at(-1)).toEqual({ path: '/api/assay-definitions/import', fileName: 'hrtv.xlsx' })
  expect(container.textContent).toBe('/assays/42')
})

test('problems are listed and the import cannot be confirmed', async () => {
  preview = BAD
  await chooseFile('broken.xlsx')

  expect(container.querySelector('[aria-label="Problems"]')!.textContent).toContain('Assay sheet, assay_type: is required')
  expect(container.textContent).toContain('This workbook cannot be imported')
  expect(createButton().disabled).toBe(true)
  expect(requests.map(request => request.path)).toEqual(['/api/assay-definitions/import/preview'])
})
