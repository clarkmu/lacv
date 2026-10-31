// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { availabilityTitle, SampleAvailability } from './SampleAvailability'
import type { SampleAvailability as Availability } from '../../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function tracked(starting: string, available: string, removed: string, percent: number | null, fields: Partial<Availability> = {}): Availability {
  return {
    state: 'tracked', unit: 'uL', dimension: 'volume', starting_quantity: starting, available_quantity: available,
    removed_quantity: removed, added_quantity: '0', percent_remaining: percent, problems: [], ...fields,
  }
}

async function show(availability: Availability) {
  await act(async () => root.render(<SampleAvailability availability={availability} />))
  return {
    text: container.textContent ?? '',
    meter: container.querySelector('[role="meter"]'),
  }
}

test('an untouched sample shows its full amount as unused', async () => {
  const { text, meter } = await show(tracked('100.000000', '100.000000', '0', 100))

  expect(text).toContain('100 uL of 100 uL remaining')
  expect(text).toContain('100%')
  expect(text).toContain('Unused')
  expect(meter?.getAttribute('aria-valuenow')).toBe('100')
  expect(meter?.getAttribute('aria-valuetext')).toBe('100% remaining')
})

test('a partly used sample shows remaining, original, percentage and amount removed', async () => {
  const { text, meter } = await show(tracked('100.000000', '65.000000', '35.000000', 65))

  expect(text).toContain('65 uL of 100 uL remaining')
  expect(text).toContain('65%')
  expect(text).toContain('35 uL used or removed')
  expect(meter?.getAttribute('aria-valuenow')).toBe('65')
})

test('a depleted sample says so in words, not only with an empty bar', async () => {
  const { text, meter } = await show(tracked('50.000000', '0.000000', '50.000000', 0))

  expect(text).toContain('0 uL of 50 uL remaining')
  expect(text).toContain('0%')
  expect(text).toContain('Depleted')
  expect(meter?.getAttribute('aria-valuenow')).toBe('0')
})

test('an unknown quantity or unit shows no percentage', async () => {
  const notRecorded = await show({ ...tracked('0', '0', '0', null), state: 'not_recorded', starting_quantity: null, available_quantity: null, removed_quantity: null })
  expect(notRecorded.text).toContain('No quantity recorded')
  expect(notRecorded.meter).toBeNull()

  const noUnit = await show({ ...tracked('12', '12', '0', null), state: 'no_unit', unit: null, dimension: null })
  expect(noUnit.text).toContain('12 recorded')
  expect(noUnit.text).toContain('No unit is recorded')
  expect(noUnit.text).not.toContain('%')
  expect(noUnit.meter).toBeNull()
})

test('history that does not reconcile is shown as a warning with no percentage', async () => {
  const { text, meter } = await show({
    ...tracked('100', '60', '20', null), state: 'inconsistent',
    problems: ['The recorded quantity (60 uL) does not match its history (80 uL).'],
  })

  expect(text).toContain('60 uL recorded')
  expect(text).toContain('Quantity history does not reconcile')
  expect(text).toContain('does not match its history')
  expect(text).not.toMatch(/\d%/)
  expect(meter).toBeNull()
})

test('incompatible units are reported and mass quantities get their own title', async () => {
  const mismatch = await show({ ...tracked('100', '80', '20', null), state: 'unit_mismatch', problems: ['History recorded in ng cannot be compared with uL.'] })
  expect(mismatch.text).toContain('incompatible units')
  expect(mismatch.meter).toBeNull()

  expect(availabilityTitle(tracked('500', '380', '120', 76, { unit: 'ng', dimension: 'mass' }))).toBe('Available mass')
  expect(availabilityTitle(tracked('5', '5', '0', 100, { unit: 'tubes', dimension: null }))).toBe('Available quantity')
  expect(availabilityTitle(tracked('5', '5', '0', 100))).toBe('Available volume')
})
