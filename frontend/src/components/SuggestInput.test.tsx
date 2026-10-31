// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { SuggestInput } from './SuggestInput'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let current = ''

function Harness() {
  const [value, setValue] = useState('')
  current = value
  return <SuggestInput id="who" value={value} onChange={setValue} suggestions={['Michael Clark', 'M. Clark', 'Jane Doe']} suggestionsLabel="Previously recorded" />
}

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const input = () => container.querySelector<HTMLInputElement>('#who')!
const options = () => [...container.querySelectorAll<HTMLLIElement>('[role="option"]')].filter(option => !option.closest('[hidden]')).map(option => option.textContent)
const key = (name: string) => act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })))

async function type(text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('focusing shows every suggestion as an editable combobox', async () => {
  await act(async () => input().focus())

  expect(input().getAttribute('role')).toBe('combobox')
  expect(input().getAttribute('aria-expanded')).toBe('true')
  expect(options()).toEqual(['Michael Clark', 'M. Clark', 'Jane Doe'])
  expect(container.textContent).toContain('or keep typing a new one')
})

test('typing filters, arrows move, and Enter picks a suggestion', async () => {
  await act(async () => input().focus())
  await type('clark')
  expect(options()).toEqual(['Michael Clark', 'M. Clark'])

  await key('ArrowDown')
  await key('ArrowDown')
  expect(input().getAttribute('aria-activedescendant')).toBe('who-suggestions-1')
  await key('Enter')

  expect(current).toBe('M. Clark')
  expect(input().getAttribute('aria-expanded')).toBe('false')
})

test('a new name is kept exactly as typed', async () => {
  await act(async () => input().focus())
  await type('Rosalind Franklin')

  expect(options()).toEqual([])
  await key('Enter')
  expect(current).toBe('Rosalind Franklin')
})

test('a suggestion can be picked with the mouse and Escape closes the list', async () => {
  await act(async () => input().focus())
  const jane = [...container.querySelectorAll('[role="option"]')].find(option => option.textContent === 'Jane Doe')!
  await act(async () => jane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(current).toBe('Jane Doe')

  await type('M')
  expect(input().getAttribute('aria-expanded')).toBe('true')
  await key('Escape')
  expect(input().getAttribute('aria-expanded')).toBe('false')
})
