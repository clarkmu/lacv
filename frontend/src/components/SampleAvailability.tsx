import { formatQuantity } from '../format'
import type { SampleAvailability as Availability } from '../types'

export function availabilityTitle(availability: Availability) {
  if (availability.dimension === 'volume') return 'Available volume'
  if (availability.dimension === 'mass') return 'Available mass'
  return 'Available quantity'
}

/** Renders the backend's availability summary. The arithmetic and its checks live in the backend (app/quantity.py). */
export function SampleAvailability({ availability }: { availability: Availability }) {
  const { state, unit, available_quantity: available, starting_quantity: starting, percent_remaining: percent } = availability
  const amount = (value: string | null) => formatQuantity(value, unit)

  if (state === 'not_recorded') return <p className="text-sm text-slate-500">No quantity recorded.</p>

  if (state !== 'tracked' || percent === null) {
    const reason = state === 'no_unit'
      ? 'No unit is recorded, so the amount used cannot be calculated.'
      : state === 'tracked' ? 'The starting quantity is zero, so no percentage is shown.' : null
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600"><span className="text-2xl font-semibold text-slate-900 tabular-nums">{amount(available)}</span> recorded</p>
        {reason && <p className="text-xs text-slate-500">{reason}</p>}
        {availability.problems.length > 0 && (
          <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">{state === 'unit_mismatch' ? 'Quantity history uses incompatible units' : 'Quantity history does not reconcile'}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{availability.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
            <p className="mt-1">No percentage is shown until the history is corrected.</p>
          </div>
        )}
      </div>
    )
  }

  const removed = Number(availability.removed_quantity ?? 0)
  const added = Number(availability.added_quantity ?? 0)
  const shown = Math.min(Math.max(percent, 0), 100)
  const depleted = Number(available) === 0
  const usage = depleted ? 'Depleted' : removed === 0 && added === 0 ? 'Unused' : `${amount(availability.removed_quantity)} used or removed`

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        <span className={`text-2xl font-semibold tabular-nums ${depleted ? 'text-slate-500' : 'text-slate-900'}`}>{amount(available)}</span>
        {' '}of {amount(starting)} remaining
      </p>
      <div className="flex items-center gap-3">
        <div
          role="meter"
          aria-label="Remaining"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown}
          aria-valuetext={`${percent}% remaining`}
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"
        >
          <div className={`h-full rounded-full ${shown <= 10 ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${shown}%` }} />
        </div>
        <span className="w-14 text-right text-sm font-semibold text-slate-900 tabular-nums">{percent}%</span>
      </div>
      <p className="text-xs text-slate-500">
        {usage}
        {added > 0 && <> · includes {amount(availability.added_quantity)} added by manual adjustment</>}
      </p>
    </div>
  )
}
