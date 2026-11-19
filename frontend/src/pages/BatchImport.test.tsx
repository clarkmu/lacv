// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { BatchesPage } from './BatchesPage'
import { BatchImportConfirmPage } from './BatchImportConfirmPage'
import type { BatchSampleImportPreview, TemplateDoc } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DOC: TemplateDoc = {
  title: 'Sample batch template', file_name: 'sample-batch-template.xlsx', notes: ['Columns marked * are required. The * may be kept or removed; LACV reads the column either way.'],
  sheets: [{ name: 'Samples', description: 'Row 1 holds the column names.', columns: [
    { name: 'sample_code', header: 'sample_code *', required: true, description: "The Sample's own code.", format: 'Text, up to 100 characters', example: 'LACV-2026-0042', in_template: true },
    { name: 'collection_date', header: 'collection_date', required: false, description: 'When the Sample was collected.', format: 'Date as YYYY-MM-DD', example: '2026-05-13', in_template: true },
  ] }],
}

const blankRow = { subject_code: null, external_sample_id: null, aliquot_number: null, sample_type: null, source_type: null, source_description: null, collection_date: null, received_date: null, status: null, latitude: null, longitude: null, notes: null }

const PREVIEW: BatchSampleImportPreview = {
  file_name: 'shipment.xlsx', problems: [], can_import: true,
  warnings: ['Samples sheet: 1 column not in the template will be ignored: Freezer.'],
  samples: [
    { ...blankRow, row_number: 2, sample_code: 'SHIP-1', collection_date: '2026-05-13', problems: [] },
    { ...blankRow, row_number: 5, sample_code: 'SHIP-2', collection_date: '13/05/2026', problems: [{ column: 'collection_date', value: '13/05/2026', message: '"13/05/2026" is not a date LACV can read; use YYYY-MM-DD (e.g. 2026-05-13)' }] },
  ],
}

let container: HTMLDivElement
let root: Root
const requests: { path: string; body?: unknown }[] = []

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

async function render(entry: { pathname: string; state?: unknown }, respond: (path: string, init?: RequestInit) => Response) {
  requests.length = 0
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://lacv.test').pathname
    requests.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    return Promise.resolve(respond(path, init))
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/batches/import/confirm" element={<BatchImportConfirmPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  throw new Error(`Timed out waiting. Page text: ${document.body.textContent}`)
}

async function type(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

test('the template download first explains every column, then downloads the real template', async () => {
  await render({ pathname: '/batches' }, path => (path === '/api/batches/sample-template/columns' ? Response.json(DOC) : Response.json([])))
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('Sample batch template'))!

  await act(async () => button.click())
  await waitFor(() => (document.body.textContent ?? '').includes('LACV-2026-0042'))

  const dialog = document.body.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('Columns marked * are required')
  const rows = [...dialog.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))
  expect(rows).toEqual([
    ['sample_code *', 'Required', "The Sample's own code.", 'Text, up to 100 characters', 'LACV-2026-0042'],
    ['collection_date', 'Optional', 'When the Sample was collected.', 'Date as YYYY-MM-DD', '2026-05-13'],
  ])
  const download = [...dialog.querySelectorAll('a')].find(link => link.textContent?.includes('Download template'))!
  expect(download.getAttribute('href')).toBe('/api/batches/sample-template')
  expect(download.getAttribute('download')).toBe('sample-batch-template.xlsx')
})

test('a workbook that cannot be used stays on the Batches page with its problems', async () => {
  const refused: BatchSampleImportPreview = { file_name: 'notes.xlsx', samples: [], warnings: [], can_import: false, problems: ['Samples sheet, row 1: there is no sample_code column (columns found: "code").'] }
  await render({ pathname: '/batches' }, path => (path === '/api/batches/sample-import/preview' ? Response.json(refused) : Response.json([])))
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'notes.xlsx')] })

  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await waitFor(() => (container.textContent ?? '').includes('cannot be imported'))

  expect(container.querySelector('[role="alert"]')!.textContent).toContain('notes.xlsx cannot be imported. Nothing was saved.')
  expect(container.textContent).toContain('there is no sample_code column (columns found: "code").')
  expect(container.querySelector('[data-testid="where"]')).toBeNull()
})

test('row problems sit on their cells with the workbook row number, and editing clears them', async () => {
  await render({ pathname: '/batches/import/confirm', state: { preview: PREVIEW } }, () => Response.json({}))

  expect(container.textContent).toContain('Freezer.')
  const alert = container.querySelector('[role="alert"]')!
  expect(alert.textContent).toContain('1 row needs fixing before the batch can be saved')
  expect(alert.textContent).toContain('Row 5, collection_date: "13/05/2026" is not a date LACV can read')
  const cell = container.querySelector<HTMLInputElement>('input[aria-label="Collection date, row 5"]')!
  expect(cell.getAttribute('aria-invalid')).toBe('true')
  expect(container.querySelector('tr[aria-label="Row 5"] td')!.textContent).toBe('5')

  await type(cell, '2026-05-13')
  expect(cell.getAttribute('aria-invalid')).toBeNull()
  expect(container.textContent).not.toContain('row needs fixing')
})

test('problems found on saving are shown on their cells too, and nothing is lost', async () => {
  await render({ pathname: '/batches/import/confirm', state: { preview: PREVIEW } }, path => (path === '/api/batches/sample-import'
    ? Response.json({ detail: [{ loc: ['body', 'samples', 1, 'collection_date'], msg: '"13/05/2026" is not a date LACV can read', type: 'value_error' }] }, { status: 422 })
    : Response.json({})))
  await type(container.querySelector<HTMLInputElement>('input[aria-label="Collection date, row 5"]')!, '13/05/2026')
  await type(container.querySelector<HTMLInputElement>('input.block')!, 'June shipment')

  const save = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save batch of 2'))!
  await act(async () => save.click())
  await waitFor(() => (container.textContent ?? '').includes('row needs fixing'))

  expect(requests.find(request => request.path === '/api/batches/sample-import')!.body).toMatchObject({ batch_name: 'June shipment', samples: [{ sample_code: 'SHIP-1' }, { sample_code: 'SHIP-2', collection_date: '13/05/2026' }] })
  expect(container.querySelector('input[aria-label="Collection date, row 5"]')!.getAttribute('aria-invalid')).toBe('true')
  expect(container.textContent).toContain('Row 5, collection_date: "13/05/2026" is not a date LACV can read')
  expect(container.textContent).not.toContain('samples.1')
})
