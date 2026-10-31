// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ListTable } from './ListTable'
import { StatusBadge } from './ui'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Row = { id: number; code: string; quantity: number; status: string }
const ROWS: Row[] = [
  { id: 1, code: 'S-2', quantity: 10, status: 'available' },
  { id: 2, code: 'S-10', quantity: 2, status: 'Mystery state' },
  { id: 3, code: 'S-1', quantity: 300, status: 'consumed' },
]

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(
    <ListTable<Row>
      rows={ROWS}
      searchPlaceholder="Filter"
      getRowKey={row => row.id}
      emptyMessage="Nothing matches."
      columns={[
        { key: 'code', label: 'Code', value: row => row.code },
        { key: 'quantity', label: 'Quantity', numeric: true, value: row => row.quantity },
        { key: 'status', label: 'Status', value: row => row.status, render: row => <StatusBadge status={row.status} /> },
      ]}
    />,
  ))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const header = (label: string) => [...container.querySelectorAll('th')].find(th => th.textContent === label)!
const column = (index: number) => [...container.querySelectorAll('tbody tr')].map(row => row.querySelectorAll('td')[index]?.textContent)
const search = () => container.querySelector<HTMLInputElement>('input[aria-label="Filter"]')!

async function typeSearch(text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(search(), text)
    search().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('sorting cycles ascending, descending, unsorted and exposes the state through aria-sort', async () => {
  const quantity = header('Quantity')
  expect(quantity.getAttribute('aria-sort')).toBe('none')
  expect(quantity.textContent).not.toMatch(/asc|desc/)

  await act(async () => quantity.querySelector('button')!.click())
  expect(quantity.getAttribute('aria-sort')).toBe('ascending')
  expect(column(1)).toEqual(['2', '10', '300'])

  await act(async () => quantity.querySelector('button')!.click())
  expect(quantity.getAttribute('aria-sort')).toBe('descending')
  expect(column(1)).toEqual(['300', '10', '2'])

  await act(async () => quantity.querySelector('button')!.click())
  expect(quantity.getAttribute('aria-sort')).toBe('none')
  expect(column(0)).toEqual(['S-2', 'S-10', 'S-1'])
})

test('shows how many rows match and lets an empty search be cleared', async () => {
  expect(container.textContent).toContain('3 rows')

  await typeSearch('S-1')
  expect(container.textContent).toContain('2 of 3 rows')

  await typeSearch('no such sample')
  expect(container.textContent).toContain('Nothing matches.')
  const clear = [...container.querySelectorAll('button')].find(button => button.textContent === 'Clear search')!
  await act(async () => clear.click())
  expect(search().value).toBe('')
  expect(column(0)).toEqual(['S-2', 'S-10', 'S-1'])
})

test('status badges keep the original status text, including unknown statuses', () => {
  expect(column(2)).toEqual(['available', 'Mystery state', 'consumed'])
})
