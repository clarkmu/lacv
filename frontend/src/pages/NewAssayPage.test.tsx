// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NewAssayPage } from './NewAssayPage'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SAMPLE = {
  sample_id: 5, sample_code: 'S-005', sample_type: 'Mosquito pool', sample_type_id: 2, status: 'available', parent_sample_id: null,
  quantity_unit: 'uL', current_quantity: '100.000000', legacy_codes: [], parent: null, batch: null,
  availability: { state: 'tracked', unit: 'uL', dimension: 'volume', starting_quantity: '100.000000', available_quantity: '100.000000', removed_quantity: '0', added_quantity: '0', percent_remaining: 100, problems: [] },
}

const DEFINITIONS = [
  {
    assay_definition_id: 3, assay_code: 'LACV-RNASEP-DUPLEX', assay_name: 'LACV / RNase P duplex', assay_type: 'qPCR', target: 'LACV',
    kit: 'TaqPath', instrument: 'QuantStudio 5', typical_volume: '5.000000', typical_volume_unit: 'uL', is_active: true, execution_count: 4, sample_count: 4, last_performed: null,
    result_name: 'LACV CT', result_unit: 'cycles', result_value_type: 'either',
  },
  {
    assay_definition_id: 4, assay_code: 'RNA-QUBIT', assay_name: 'RNA quantification', assay_type: 'Quantification', target: 'RNA',
    kit: null, instrument: null, typical_volume: null, typical_volume_unit: null, is_active: true, execution_count: 0, sample_count: 0, last_performed: null,
    result_name: 'RNA concentration', result_unit: 'ng/uL', result_value_type: 'numeric',
  },
]

let posts: Record<string, unknown>[] = []
let posted: string[] = []
let respond: (body: Record<string, unknown>) => Promise<Response>

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://lacv.test')
  if (init?.method === 'POST' && /^\/api\/assay-definitions\/\d+\/executions$/.test(url.pathname)) {
    posted.push(url.pathname)
    const body = JSON.parse(String(init.body))
    posts.push(body)
    return respond(body)
  }
  if (url.pathname === '/api/samples/5') return Promise.resolve(Response.json(SAMPLE))
  if (url.pathname === '/api/assay-definitions' && url.searchParams.get('active_only') === 'true') return Promise.resolve(Response.json(DEFINITIONS))
  if (url.pathname === '/api/assay-executions/performed-by') return Promise.resolve(Response.json(['Michael Clark', 'M. Clark', 'Jane Doe']))
  return Promise.resolve(Response.json({ detail: 'Not found' }, { status: 404 }))
}

function Landing() {
  const location = useLocation()
  return <p data-testid="landed">{location.pathname + location.hash}</p>
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  posts = []
  posted = []
  respond = () => Promise.resolve(Response.json({ assay_execution_id: 77, assay_definition_id: 4 }, { status: 201 }))
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sample/5/assays/new']}>
        <Routes>
          <Route path="/sample/:id/assays/new" element={<NewAssayPage />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
  await waitFor(() => container.querySelectorAll('#assay-definition option').length === 3)
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

const field = (selector: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!

async function fill(selector: string, text: string) {
  const element = field(selector)
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    element.focus()
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submitButton = () => [...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find(button => /Record/.test(button.textContent ?? ''))!

async function choose(value: string) {
  const select = field('#assay-definition') as unknown as HTMLSelectElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const byLabel = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!

async function fillAssay(definition = '4') {
  await choose(definition)
  await fill('#assay-date', '2026-10-30')
  await fill('#assay-time', '14:05')
}

test('the page is about one Sample and shows how much of it is available', () => {
  const heading = container.querySelector('h1')!
  expect(heading.textContent).toBe('Record assay on S-005')
  expect(heading.querySelector('a[href="/sample/5"]')?.textContent).toBe('S-005')
  expect(container.textContent).toContain('100 uL available')
  expect(container.textContent).toContain('Mosquito pool')
  expect(container.textContent).not.toMatch(/Assay code|QC status/)
  expect(container.querySelector('#assay-type'), 'an assay is chosen, not typed in').toBeNull()
  expect(container.querySelector('a[href="/assays/new"]')?.textContent).toContain('Define a new assay')
})

test('choosing an assay names its one result and suggests its typical volume', async () => {
  await choose('3')

  expect(field('#volume-used').value).toBe('5')
  expect(container.textContent).toContain('Typical for this assay: 5 uL')
  expect(container.querySelector('label[for="assay-result"]')?.textContent).toContain('LACV CT')
  expect(container.textContent).toContain('cycles')
  expect(container.textContent).toContain('TaqPath')
})

test('recording sends the workflow values and lands on the new assay', async () => {
  await fillAssay()
  await fill('#performed-by', 'clark')
  await act(async () => field('#performed-by').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  await act(async () => field('#performed-by').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await fill('#volume-used', '20')
  await fill('#assay-notes', 'Plate 3')

  await act(async () => submitButton().click())
  await waitFor(() => container.querySelector('[data-testid="landed"]') !== null)

  expect(posted).toEqual(['/api/assay-definitions/4/executions'])
  expect(posts).toEqual([{
    assay_date: '2026-10-30T14:05', operator_name: 'Michael Clark', notes: 'Plate 3',
    samples: [{ sample_id: 5, result: null, volume_used: '20', volume_unit: 'uL' }],
  }])
  expect(container.textContent, 'the new execution, on its assay\'s page').toBe('/assays/4#execution-77')
})

test('the result is sent as typed with the sample; the backend decides number or text', async () => {
  await fillAssay('3')
  await fill('#assay-result', 'not detected')

  await act(async () => submitButton().click())
  await waitFor(() => posts.length === 1)

  expect(posts[0].samples).toEqual([{ sample_id: 5, result: 'not detected', volume_used: '5', volume_unit: 'uL' }])
})

test('a person not in the suggestions is submitted as typed', async () => {
  await fillAssay()
  await fill('#performed-by', 'Rosalind Franklin')

  await act(async () => submitButton().click())
  await waitFor(() => posts.length === 1)

  expect(posts[0].operator_name).toBe('Rosalind Franklin')
  expect((posts[0].samples as { volume_used: unknown }[])[0].volume_used).toBeNull()
})

test('a refused volume is explained next to the volume field and nothing navigates', async () => {
  respond = () => Promise.resolve(Response.json({ detail: [{ loc: ['body', 'samples', 0, 'volume_used'], msg: 'Cannot remove 150 uL from S-005: only 100 uL is recorded', type: 'value_error' }] }, { status: 422 }))
  await fillAssay()
  await fill('#volume-used', '150')

  await act(async () => submitButton().click())
  await waitFor(() => container.querySelector('[role="alert"]') !== null)

  const volumeField = field('#volume-used').closest('div.space-y-1')!
  expect(volumeField.querySelector('[role="alert"]')?.textContent).toContain('only 100 uL is recorded')
  expect(field('#volume-used').getAttribute('aria-invalid')).toBe('true')
  expect(container.querySelector('[data-testid="landed"]')).toBeNull()
})

test('the record button cannot send the assay twice', async () => {
  let release: () => void = () => {}
  respond = () => new Promise(resolve => { release = () => resolve(Response.json({ assay_execution_id: 77, assay_definition_id: 4 }, { status: 201 })) })
  await fillAssay()

  // Two clicks before React has re-rendered, as a fast double click would be.
  await act(async () => {
    submitButton().click()
    submitButton().click()
  })
  await waitFor(() => submitButton().disabled)
  expect(submitButton().textContent).toContain('Recording…')
  await act(async () => submitButton().click())
  await act(async () => release())

  expect(posts).toHaveLength(1)
})
