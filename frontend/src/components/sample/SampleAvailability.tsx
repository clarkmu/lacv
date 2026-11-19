import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatQuantity } from '../../format'
import type { SampleAvailability as Availability } from '../../types'

export function availabilityTitle(availability: Availability) {
  if (availability.dimension === 'volume') return 'Available volume'
  if (availability.dimension === 'mass') return 'Available mass'
  return 'Available quantity'
}

/** Renders the backend's availability summary. The arithmetic and its checks live in the backend (app/quantity.py). */
export function SampleAvailability({ availability }: { availability: Availability }) {
  const { state, unit, available_quantity: available, starting_quantity: starting, percent_remaining: percent } = availability
  const amount = (value: string | null) => formatQuantity(value, unit)

  if (state === 'not_recorded') return <p className="text-sm text-muted-foreground">No quantity recorded.</p>

  if (state !== 'tracked' || percent === null) {
    const reason = state === 'no_unit'
      ? 'No unit is recorded, so the amount used cannot be calculated.'
      : state === 'tracked' ? 'The starting quantity is zero, so no percentage is shown.' : null
    return (
      <div className="space-y-1.5">
        <p className="text-[13px] text-muted-foreground"><span className="text-xl font-semibold text-foreground tabular-nums">{amount(available)}</span> recorded</p>
        {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
        {availability.problems.length > 0 && (
          <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert aria-hidden="true" className="size-3.5" />{state === 'unit_mismatch' ? 'Quantity history uses incompatible units' : 'Quantity history does not reconcile'}</p>
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
    <div className="space-y-1.5">
      <p className="text-[13px] text-muted-foreground">
        <span className={cn('text-xl font-semibold tabular-nums', depleted ? 'text-muted-foreground' : 'text-foreground')}>{amount(available)}</span>
        {' '}of {amount(starting)} remaining
      </p>
      <div className="flex items-center gap-2.5">
        <div
          role="meter"
          aria-label="Remaining"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown}
          aria-valuetext={`${percent}% remaining`}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary ring-1 ring-border ring-inset"
        >
          <div className={cn('h-full rounded-full', shown <= 10 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${shown}%` }} />
        </div>
        <span className="w-12 text-right text-[13px] font-semibold tabular-nums">{percent}%</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {usage}
        {added > 0 && <> · includes {amount(availability.added_quantity)} added by manual adjustment</>}
      </p>
    </div>
  )
}

/**
 * One line of the same summary, for lists such as the lineage tree: remaining of starting quantity with a small bar.
 * A bar appears only when the backend gives a percentage; otherwise the reason is said in words.
 */
export function CompactAvailability({ availability, sampleCode }: { availability: Availability; sampleCode: string }) {
  const { state, unit, available_quantity: available, starting_quantity: starting, percent_remaining: percent } = availability
  const number = (value: string | null) => formatQuantity(value, null)

  if (state === 'not_recorded') return <span className="text-xs text-muted-foreground/80">no quantity recorded</span>
  if (state === 'no_unit') return <span className="text-xs text-muted-foreground" title="No unit is recorded, so no percentage is shown">{number(available)} <span className="italic">no unit</span></span>
  if (state === 'unit_mismatch' || state === 'inconsistent') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-800" title={availability.problems.join(' ')}>
        <TriangleAlert aria-hidden="true" className="size-3" />
        {formatQuantity(available, unit)} <span className="sr-only">:</span><span>history does not reconcile</span>
      </span>
    )
  }
  if (percent === null) return <span className="text-xs text-muted-foreground tabular-nums">{formatQuantity(available, unit)}</span>

  const shown = Math.min(Math.max(percent, 0), 100)
  const depleted = Number(available) === 0
  return (
    <span className="inline-flex items-center gap-2 text-xs tabular-nums">
      <span
        role="meter"
        aria-label={`Remaining in ${sampleCode}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-valuetext={`${formatQuantity(available, unit)} of ${formatQuantity(starting, unit)} remaining (${percent}%)`}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary ring-1 ring-border ring-inset"
      >
        <span className={cn('block h-full rounded-full', shown <= 10 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${shown}%` }} />
      </span>
      <span className={cn(depleted ? 'text-muted-foreground' : 'text-foreground')}>
        <span className="font-medium">{number(available)}</span><span className="text-muted-foreground"> / {number(starting)} {unit}</span>
      </span>
      <span className={cn('w-9 text-right', depleted ? 'font-medium text-muted-foreground' : 'text-muted-foreground')}>{depleted ? 'used' : `${percent}%`}</span>
    </span>
  )
}
