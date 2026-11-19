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

// Radix menus measure the page; jsdom does not.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false

const DEFINITION = {
  assay_definition_id: 1, assay_code: 'LACV-QPCR-SYBR', assay_name: 'LACV qPCR (SYBR Green)', assay_type: 'qPCR', target: 'LACV', kit: null, instrument: null,
  typical_volume: null, typical_volume_unit: null, is_active: true,
  result_fields: [{ assay_definition_result_id: 1, analyte: 'LACV', result_name: 'CT', unit: 'cycles', value_type: 'either', label: 'LACV CT' }],
  execution_count: 12, sample_count: 57, last_performed: null,
}
const DEFINITIONS = [
  DEFINITION,
  { ...DEFINITION, assay_definition_id: 2, assay_code: 'LACV-RT-QPCR', assay_name: 'LACV RT-qPCR', assay_type: 'RT-qPCR' },
  { ...DEFINITION, assay_definition_id: 3, assay_code: 'LACV-PRNT50', assay_name: 'LACV PRNT50', assay_type: 'Serology' },
]

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

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  throw new Error(`Timed out waiting. Page text: ${document.body.textContent}`)
}

const listed = () => [...container.querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent)

test('the Results menu opens from the keyboard and links to the assays holding those results', async () => {
  await open('/samples/new')
  const trigger = [...container.querySelectorAll('nav[aria-label="Modules"] button')].find(button => button.textContent?.includes('Results'))! as HTMLButtonElement
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu')

  await act(async () => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await waitFor(() => document.body.querySelector('[role="menu"]') !== null)
  const items = [...document.body.querySelectorAll('[role="menu"] [role="menuitem"]')]
  expect(items.map(item => [item.textContent, item.getAttribute('href')])).toEqual([
    ['qPCR results', '/assays?type=qPCR'],
    ['Sequencing results', '/assays?type=Sequencing'],
    ['All assays', '/assays'],
  ])
  // Arrow keys move through the items.
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  await waitFor(() => document.activeElement?.textContent === 'Sequencing results')

  await act(async () => (items[0] as HTMLAnchorElement).click())
  await waitFor(() => path === '/assays')
  await waitFor(() => listed().length > 0)
  expect(container.querySelector('h1')?.textContent).toBe('qPCR results')
  expect(listed()).toEqual(['LACV qPCR (SYBR Green)', 'LACV RT-qPCR'])
  const results = [...container.querySelectorAll('nav[aria-label="Modules"] button')].find(button => button.textContent?.includes('Results'))!
  expect(results.className).toContain('text-white')
  expect(container.querySelector('nav[aria-label="Modules"] a[href="/assays"]')?.getAttribute('aria-current')).toBeNull()
})

test('a results link with no matching assays explains where such results come from', async () => {
  await open('/assays?type=Sequencing')
  await waitFor(() => (container.textContent ?? '').includes('No Sequencing assays yet'))

  expect(container.querySelector('h1')?.textContent).toBe('Sequencing results')
  expect(container.textContent).toContain("No Sequencing assays yet. Results are recorded on an assay's page: create an assay of type Sequencing to record them.")
  expect(container.querySelector('a[aria-label="Show all assay types, not only Sequencing"]')?.getAttribute('href')).toBe('/assays')
})
