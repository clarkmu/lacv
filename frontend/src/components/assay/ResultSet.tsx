import { cn } from '@/lib/utils'
import { valueText } from '../../assayResults'
import { ResultBadge, ResultValue } from '../common'

type Result = { label: string; unit: string | null; numeric_value: string | null; text_value: string | null; interpretation: string | null }

/** A Sample's result set in one line: each field's value (bold, unit muted), then its interpretation as a badge. */
export function ResultSet({ results, className }: { results: Result[]; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {results.map(result => {
        const value = valueText(result)
        return (
          <span key={result.label} className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">{result.label}</span>
            {/* Bold value, muted unit (numbers only); an interpretation without a value shows the muted dash. */}
            <ResultValue value={value} unit={result.numeric_value !== null ? result.unit : null} />
            <ResultBadge interpretation={result.interpretation} />
          </span>
        )
      })}
    </span>
  )
}
