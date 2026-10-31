import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { History } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SuggestInputProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  placeholder?: string
  /** Shown above the suggestions, e.g. "Previously recorded". */
  suggestionsLabel?: string
  invalid?: boolean
  describedBy?: string
  className?: string
}

/**
 * A free-text field with suggestions (an ARIA combobox). Typing filters the suggestions; arrow keys move
 * through them; Enter or a click picks one. Any other text is kept as typed, so new values never need
 * to exist first.
 */
export function SuggestInput({ id, value, onChange, suggestions, placeholder, suggestionsLabel = 'Suggestions', invalid, describedBy, className }: SuggestInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-suggestions`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const term = value.trim().toLowerCase()
  const matches = suggestions.filter(suggestion => suggestion.toLowerCase().includes(term) && suggestion !== value).slice(0, 8)
  const showList = open && matches.length > 0

  function choose(suggestion: string) {
    onChange(suggestion)
    setOpen(false)
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
    } else if (event.key === 'Enter' && showList && active >= 0) {
      // Enter picks the highlighted suggestion; with nothing highlighted it submits the form as usual.
      event.preventDefault()
      choose(matches[active])
    } else if (event.key === 'Escape' && showList) {
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1) }}
        onKeyDown={onKeyDown}
        className="h-8 text-[13px]"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={suggestionsLabel}
        hidden={!showList}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-[13px] shadow-md"
      >
        <li role="presentation" className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">
          <History aria-hidden="true" className="size-3" />{suggestionsLabel} · or keep typing a new one
        </li>
        {matches.map((suggestion, index) => (
          <li
            key={suggestion}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown, not click, so the choice lands before the input's blur closes the list.
            onMouseDown={event => { event.preventDefault(); choose(suggestion) }}
            onMouseEnter={() => setActive(index)}
            className={cn('cursor-pointer rounded-sm px-2 py-1', index === active && 'bg-accent text-accent-foreground')}
          >
            {suggestion}
          </li>
        ))}
      </ul>
    </div>
  )
}
