import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inputClass } from '../common'
import type { SampleListItem } from '../../types'

type SampleFinderProps = {
  samples: SampleListItem[]
  /** Samples already chosen; they are not offered again. */
  chosenIds: number[]
  onPick: (sample: SampleListItem) => void
  /** Called with the typed text when it matches a sample that is already chosen. */
  onDuplicate?: (sample: SampleListItem) => void
  label?: string
  autoFocus?: boolean
}

/**
 * Find a sample by code, legacy code, label or external ID and pick it (an ARIA combobox). Arrow keys move,
 * Enter picks the highlighted match or an exact code match; a scanner's code followed by Enter works too.
 */
export function SampleFinder({ samples, chosenIds, onPick, onDuplicate, label = 'Find a sample to add', autoFocus = false }: SampleFinderProps) {
  const listId = useId()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const query = term.trim().toLowerCase()
  const matches = query
    ? samples.filter(sample => !chosenIds.includes(sample.sample_id) && searchText(sample).includes(query)).slice(0, 8)
    : []
  const showList = open && query.length > 0

  function pick(sample: SampleListItem) {
    onPick(sample)
    setTerm('')
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive(current => Math.min(current + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(current => Math.max(current - 1, -1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const exact = samples.find(sample => sample.sample_code.toLowerCase() === query || sample.legacy_codes.some(code => code.toLowerCase() === query))
      if (exact && chosenIds.includes(exact.sample_id)) {
        onDuplicate?.(exact)
        setTerm('')
        return
      }
      const chosen = active >= 0 ? matches[active] : exact ?? (matches.length === 1 ? matches[0] : undefined)
      if (chosen) pick(chosen)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="relative w-full max-w-md">
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={term}
        placeholder="Scan or type a sample code, label or legacy code"
        onChange={event => { setTerm(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cn(inputClass, 'w-full pl-7 font-mono text-[13px] placeholder:font-sans')}
      />
      <ul id={listId} role="listbox" aria-label="Matching samples" hidden={!showList} className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border bg-popover p-1 text-[13px] shadow-md">
        {matches.map((sample, index) => (
          <li
            key={sample.sample_id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown, not click, so the choice lands before the input's blur closes the list.
            onMouseDown={event => { event.preventDefault(); pick(sample) }}
            onMouseEnter={() => setActive(index)}
            className={cn('flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1', index === active && 'bg-accent text-accent-foreground')}
          >
            <span className="font-mono font-medium">{sample.sample_code}</span>
            <span className="truncate text-xs text-muted-foreground">{[sample.sample_type, sample.label, sample.legacy_codes.join(' ')].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
        {matches.length === 0 && <li role="presentation" className="px-2 py-1 text-xs text-muted-foreground">No sample matches “{term.trim()}”{chosenIds.length > 0 && ' (or it is already added)'}.</li>}
      </ul>
    </div>
  )
}

function searchText(sample: SampleListItem) {
  return [sample.sample_code, sample.label, sample.external_sample_id, sample.subject_code, ...sample.legacy_codes].filter(Boolean).join(' ').toLowerCase()
}
