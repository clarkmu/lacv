// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { readError } from '../api'
import { EmptyValue, hasPositiveResult, Panel, ResultBadge, ResultValue, resultTone } from './common'
import { ListTable } from './ListTable'
import { ResultSet } from './assay/ResultSet'
import type { ReactNode } from 'react'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function mount(node: ReactNode) {
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => root.render(node))
  const html = container.firstElementChild
  act(() => root.unmount())
  return html
}

const rendered = (interpretation: string | null) => mount(<ResultBadge interpretation={interpretation} />)

test('interpretations are recognised in any case or spelling, without changing what is stored', () => {
  for (const value of ['positive', 'Positive', 'POSITIVE', ' pos ', 'Detected', 'reactive', '+']) expect(resultTone(value), value).toBe('positive')
  for (const value of ['negative', 'Negative', 'NEG', 'not detected', 'Not Detected', 'not-detected', 'not_detected', 'Non-reactive', 'undetected', '-']) expect(resultTone(value), value).toBe('negative')
  for (const value of ['inconclusive', 'Equivocal', 'indeterminate']) expect(resultTone(value), value).toBe('indeterminate')
  for (const value of ['<10', '31.2', 'CPE observed', '', null]) expect(resultTone(value), String(value)).toBeNull()
})

test('positive and negative badges differ by symbol and tone, and keep the text as stored', () => {
  const positive = rendered('Detected')!
  const negative = rendered('NEG')!

  expect(positive.getAttribute('data-tone')).toBe('positive')
  expect(negative.getAttribute('data-tone')).toBe('negative')
  // Meaning is not colour alone: a symbol and the stored word are both visible.
  expect(positive.textContent).toBe('+Detected')
  expect(negative.textContent).toBe('−NEG')
  expect(positive.className).not.toBe(negative.className)
  // Unrecognised wording is shown plainly, never coloured as if it were a result.
  const plain = rendered('<10')!
  expect(plain.getAttribute('data-tone')).toBeNull()
  expect(plain.textContent).toBe('<10')
  expect(rendered(null)).toBeNull()
})

test('API errors read as sentences: located problems are named, internals and HTML pages are not shown', async () => {
  const validation = await readError(Response.json({ detail: [
    { loc: ['body', 'samples', 2, 'collection_date'], msg: '"13/05/2026" is not a date LACV can read', type: 'value_error' },
    { loc: ['body', 'batch_name'], msg: 'is required', type: 'string_type' },
  ] }, { status: 422 }))
  expect(validation.message).toBe('Samples, row 3, collection date: "13/05/2026" is not a date LACV can read; Batch name: is required')
  expect(validation.fieldErrors['samples.2.collection_date']).toBe('"13/05/2026" is not a date LACV can read')
  expect(validation.problems[0].path).toEqual(['samples', 2, 'collection_date'])

  const crash = await readError(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }))
  expect(crash.message).toBe('The server could not complete the request (500 Internal Server Error). Nothing was saved; try again, and if it keeps happening tell the LACV administrator.')
  const proxy = await readError(new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, statusText: 'Bad Gateway' }))
  expect(proxy.message).not.toContain('<')
  const sentence = await readError(Response.json({ detail: 'Sample code already exists: S-1' }, { status: 400 }))
  expect(sentence.message).toBe('Sample code already exists: S-1')
})

test('panel headers are a tinted band; only primary sections get the left accent', () => {
  const primary = mount(<Panel primary title="Lineage">body</Panel>)!
  const secondary = mount(<Panel title="Files">body</Panel>)!
  const band = (section: Element) => section.querySelector('h2')!.parentElement!

  for (const section of [primary, secondary]) {
    expect(band(section).className).toContain('bg-muted/55')
    expect(band(section).className).toContain('border-b')
    expect(band(section).className, 'compact: no extra height or padding').toContain('min-h-9')
  }
  expect(primary.getAttribute('data-primary')).toBe('true')
  expect(band(primary).className).toContain('before:bg-primary')
  expect(secondary.getAttribute('data-primary')).toBeNull()
  expect(band(secondary).className).not.toContain('before:bg-primary')

  // A list table with a title gets the same band.
  const table = mount(<ListTable title="Contents" primary rows={[]} columns={[{ key: 'a', label: 'A', value: () => '' }]} searchPlaceholder="Filter" getRowKey={() => 1} emptyMessage="None" />)!
  expect(table.querySelector('h2')!.parentElement!.className).toContain('before:bg-primary')
})

test('result values are bold with a muted unit; only absent values become the muted dash', () => {
  const value = mount(<ResultValue value="31.2" unit="cycles" />)!
  expect(value.textContent).toBe('31.2 cycles')
  expect(value.className).toContain('font-semibold')
  expect(value.querySelector('span')!.textContent).toBe(' cycles')
  expect(value.querySelector('span')!.className).toContain('text-muted-foreground')
  expect(value.querySelector('span')!.className).toContain('font-normal')

  // Zero, and text results, are values.
  for (const shown of ['0', '0.0', 'not detected', 'negative']) expect(mount(<ResultValue value={shown} />)!.textContent, shown).toBe(shown)
  expect(mount(<ResultValue value={0} />)!.textContent).toBe('0')
  for (const absent of [null, undefined, '', '  ']) {
    const dash = mount(<ResultValue value={absent} unit="cycles" />)!
    expect(dash.textContent, String(absent)).toBe('—')
    expect(dash.className).toContain('text-muted-foreground')
  }
  expect(mount(<EmptyValue />)!.outerHTML).toBe(mount(<ResultValue value={null} />)!.outerHTML)
})

test('a positive row is found with the same rules as the badge', () => {
  expect(hasPositiveResult([null, 'Detected'])).toBe(true)
  expect(hasPositiveResult(['POS'])).toBe(true)
  for (const values of [['negative'], ['not detected', null], ['inconclusive'], [], [null]]) expect(hasPositiveResult(values), String(values)).toBe(false)
})

test('a result set shows zero as a value and an interpretation without a value as the dash', () => {
  const set = mount(<ResultSet results={[
    { label: 'LACV CT', unit: 'cycles', numeric_value: '0E-8', text_value: null, interpretation: 'negative' },
    { label: 'RNase P CT', unit: 'cycles', numeric_value: null, text_value: null, interpretation: 'detected' },
    { label: 'CPE', unit: null, numeric_value: null, text_value: 'not observed', interpretation: null },
  ]} />)!
  const parts = [...set.children].map(part => part.textContent)
  expect(parts).toEqual(['LACV CT0 cycles−negative', 'RNase P CT—+detected', 'CPEnot observed'])
  expect(set.querySelector('[data-result-value]')!.className).toContain('font-semibold')
  // A text value has no unit appended.
  expect(set.children[2].querySelector('[data-result-value]')!.textContent).toBe('not observed')
})
