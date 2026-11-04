// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { ImportReview, type ReviewedRow } from './ImportReview'
import type { AssayDefinitionDetail, ExecutionImportPreview, ExecutionImportRow, SampleListItem, SampleRef } from '../../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ref = (sample_id: number, sample_code: string): SampleRef => ({ sample_id, sample_code, sample_type: 'RNA', status: 'available' })
const listed = (sample: SampleRef): SampleListItem => ({
  ...sample, sample_type_id: 7, parent_sample_id: null, batch_id: null, external_sample_id: null, subject_code: null, aliquot_number: null,
  label: null, received_date: null, current_quantity: null, quantity_unit: null, storage_location_id: null, legacy_codes: [],
})
const A = ref(1, 'PEDS-01-RNA')
const B = ref(2, 'PEDS-02-RNA')
const C = ref(3, 'PEDS-03-RNA')
const D = ref(4, 'PEDS-04-RNA')

const row = (row_number: number, sample_code: string, fields: Partial<ExecutionImportRow>): ExecutionImportRow => ({
  row_number, sample_code, match: 'none', sample: null, candidates: [], duplicate_of_row: null, results: [], volume_used: null, volume_unit: null, problems: [], ...fields,
})

const PREVIEW: ExecutionImportPreview = {
  source: { file_name: 'plate.xlsx', sha256: 'ab'.repeat(32), sheets: ['Samples'] },
  execution: null,
  problems: [],
  can_import: true,
  rows: [
    row(2, 'PEDS-01-RNA', { match: 'exact', sample: A, results: [{ assay_definition_result_id: 101, value: '31.2', interpretation: 'positive', qc_status: null }] }),
    row(3, 'peds 02 rna', { match: 'close', candidates: [{ sample: B, reason: 'same code apart from case, spaces or punctuation' }, { sample: C, reason: 'similar code' }] }),
    row(4, 'NOPE-9', { match: 'none' }),
    row(5, 'PEDS-01-RNA', { match: 'exact', sample: A, duplicate_of_row: 2 }),
  ],
}

const DEFINITION = {
  assay_definition_id: 1, result_fields: [{ assay_definition_result_id: 101, analyte: 'LACV', result_name: 'CT', unit: 'cycles', value_type: 'either', label: 'LACV CT' }],
} as unknown as AssayDefinitionDetail

let container: HTMLDivElement
let root: Root
let confirmed: ReviewedRow[] | null

async function open(preview: ExecutionImportPreview, alreadyAdded: SampleRef[] = []) {
  confirmed = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(
    <MemoryRouter>
      <ImportReview preview={preview} definition={DEFINITION} samples={[A, B, C, D].map(listed)} alreadyAdded={alreadyAdded} onConfirm={rows => { confirmed = rows }} onClose={vi.fn()} />
    </MemoryRouter>,
  ))
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

// The dialog renders in a portal on document.body.
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => dialog().querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...dialog().querySelectorAll('button')].find(element => element.textContent?.trim().startsWith(text))
const addButton = () => button('Add ')!

async function type(element: HTMLInputElement, text: string) {
  await act(async () => {
    element.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function enter(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

test('rows are grouped: no match first, then possible matches, then exact matches', async () => {
  await open(PREVIEW)

  expect(dialog()).toBeTruthy()
  expect([...dialog().querySelectorAll('section')].map(section => section.getAttribute('aria-label'))).toEqual(['No match', 'Possible match', 'Matched'])
  const rowsIn = (group: string) => [...byLabel(group).querySelectorAll('tr')].map(tr => tr.getAttribute('aria-label'))
  expect(rowsIn('No match')).toEqual(['Row 4'])
  expect(rowsIn('Possible match')).toEqual(['Row 3'])
  expect(rowsIn('Matched')).toEqual(['Row 2', 'Row 5'])
  expect(byLabel('Row 2').textContent).toContain('LACV CT 31.2 (positive)')
})

test('nothing is chosen for the user: close and missing rows block adding until resolved', async () => {
  await open(PREVIEW)

  expect(addButton().disabled).toBe(true)
  expect(dialog().textContent).toContain('2 rows still need a sample')
  expect(byLabel('Suggestions for row 3').textContent).toContain('Use PEDS-02-RNA')
  expect(byLabel('Suggestions for row 3').textContent).toContain('same code apart from case, spaces or punctuation')
  expect(byLabel('Row 5').textContent).toContain('PEDS-01-RNA is also on row 2; a sample appears once in an execution.')
})

test('each row is fixed in place, and the confirmed rows keep their workbook values', async () => {
  await open(PREVIEW)

  await act(async () => button('Use PEDS-02-RNA')!.click())
  const finder = byLabel<HTMLInputElement>('Find the sample for row 4')
  await type(finder, 'PEDS-04-RNA')
  await enter(finder)
  await act(async () => byLabel<HTMLButtonElement>('Remove row 5').click())

  expect(addButton().disabled).toBe(false)
  expect(addButton().textContent).toBe('Add 3 samples to execution')
  await act(async () => addButton().click())
  expect(confirmed!.map(item => [item.row.row_number, item.sample.sample_code])).toEqual([[2, 'PEDS-01-RNA'], [3, 'PEDS-02-RNA'], [4, 'PEDS-04-RNA']])
  expect(confirmed![0].row.results[0].value).toBe('31.2')
})

test('the first suggestions can be taken for all possible matches at once', async () => {
  await open({ ...PREVIEW, rows: PREVIEW.rows.slice(0, 2) })

  await act(async () => button('Use first suggestion for all 1')!.click())

  expect(byLabel('Row 3').textContent).toContain('PEDS-02-RNA')
  expect(addButton().disabled).toBe(false)
})

test('a sample already in the execution, or chosen twice, is refused', async () => {
  await open({ ...PREVIEW, rows: [PREVIEW.rows[0], PREVIEW.rows[2]] }, [D])

  const finder = byLabel<HTMLInputElement>('Find the sample for row 4')
  await type(finder, 'PEDS-04-RNA')
  await enter(finder)

  expect(byLabel('Row 4').textContent).toContain('PEDS-04-RNA is already in this execution.')
  expect(addButton().disabled).toBe(true)
})

test('a workbook with problems of its own lists them and can only be closed', async () => {
  await open({ ...PREVIEW, rows: [], can_import: false, problems: ['Samples sheet, cell B2: contains a formula; enter the value itself'] })

  expect(byLabel('Workbook problems').textContent).toContain('contains a formula')
  expect(button('Add ')).toBeUndefined()
  expect(button('Close')).toBeDefined()
})
