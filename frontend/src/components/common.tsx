import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { formatQuantity } from '../format'
import type { SampleRef } from '../types'

// LACV building blocks on top of shadcn/ui. Class strings work on <button>, <a>, and router <Link> alike.

export const buttonClass = {
  primary: buttonVariants({ size: 'sm' }),
  secondary: buttonVariants({ variant: 'outline', size: 'sm' }),
  quiet: cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-primary hover:text-primary'),
  danger: cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive'),
}

export const inputClass = 'h-8 rounded-md border border-input bg-card px-2.5 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none'

export const linkClass = 'text-primary underline-offset-2 hover:underline'

export const errorClass = 'rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive'

// Heading levels inside a page. Keep them a step above the 13px working text so sections are easy to find.
/** The title of a section, panel, or form section: Properties, Procedure, Executions, Activity, ... */
export const sectionTitleClass = 'text-sm font-semibold tracking-tight'
/** A small uppercase label that groups fields or facts within a section: Inventory, Storage, ... */
export const subsectionLabelClass = 'text-xs font-semibold tracking-wider text-muted-foreground uppercase'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-lg leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * A section's header band: lightly tinted so sections separate at a glance. A primary section (the page's main data:
 * lineage, results, activity, contents) also gets a thin accent on its left edge. Shared by Panel and by sections that
 * draw their own header (e.g. Activity).
 */
export function panelHeaderClass(primary = false) {
  return cn(
    'relative flex min-h-9 items-center justify-between gap-2 rounded-t-md border-b bg-muted/55 px-3 py-1.5',
    primary && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-tl-md before:bg-primary',
  )
}

/** A titled work area: a header band with an optional action, then content. primary marks the page's main data sections. */
export function Panel({ title, label, action, children, className, bodyClassName, primary = false }: {
  title: ReactNode; label?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; primary?: boolean
}) {
  return (
    <section className={cn('rounded-md border bg-card shadow-xs', className)} aria-label={label ?? (typeof title === 'string' ? title : undefined)} data-primary={primary || undefined}>
      <div className={panelHeaderClass(primary)}>
        <h2 className={sectionTitleClass}>{title}</h2>
        {action}
      </div>
      <div className={cn('p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

/** The one way an absent value is shown: a muted em dash. Only for nothing recorded; 0, "negative" or "not detected" are values. */
export function EmptyValue({ className }: { className?: string }) {
  return <span className={cn('text-muted-foreground/60', className)} aria-label="none" data-empty="">—</span>
}

/** True when there is nothing to show: null, undefined or blank text. Zero is a value. */
export function isAbsent(value: string | number | null | undefined) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/** A result value: bold, with its unit secondary. Absent values show as the muted em dash. */
export function ResultValue({ value, unit, className }: { value: string | number | null | undefined; unit?: string | null; className?: string }) {
  if (isAbsent(value)) return <EmptyValue className={className} />
  return (
    <span className={cn('font-semibold text-foreground tabular-nums', className)} data-result-value="">
      {value}{unit && <span className="font-normal text-muted-foreground"> {unit}</span>}
    </span>
  )
}

/** Whether any of these interpretations is a positive result, by the same rules as ResultBadge. */
export function hasPositiveResult(interpretations: (string | null | undefined)[]) {
  return interpretations.some(interpretation => resultTone(interpretation) === 'positive')
}

/**
 * For the first cell of a table row holding a positive result: a thin rose flag on the row's left edge, as clinical
 * systems mark abnormal rows, to find positives while scanning. It supplements the row's result badge, whose "+" and
 * word carry the meaning without colour; the row also gets data-positive and a "Positive result" hover title.
 */
export const positiveRowCellClass = 'shadow-[inset_3px_0_0_0_oklch(0.645_0.246_16.439)]'

type Tone = 'positive' | 'pending' | 'negative' | 'retired' | 'neutral'

// Muted tones for statuses the app uses today. Anything else renders in the neutral tone, text unchanged.
const STATUS_TONES: Record<string, Tone> = {
  available: 'positive', active: 'positive', completed: 'positive', accepted: 'positive', passed: 'positive', received: 'positive', stored: 'positive',
  expected: 'pending', planned: 'pending', pending: 'pending', in_progress: 'pending', not_reviewed: 'pending', running: 'pending',
  rejected: 'negative', failed: 'negative', cancelled: 'negative', canceled: 'negative',
  consumed: 'retired', disposed: 'retired', inactive: 'retired', depleted: 'retired', archived: 'retired',
}

const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  positive: { badge: 'border-emerald-600/20 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  pending: { badge: 'border-amber-600/25 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  negative: { badge: 'border-red-600/20 bg-red-50 text-red-800', dot: 'bg-red-500' },
  retired: { badge: 'border-slate-400/30 bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  neutral: { badge: 'border-slate-400/30 bg-white text-slate-700', dot: 'bg-slate-400' },
}

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null
  const tone = TONE_CLASSES[STATUS_TONES[status.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral']
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', tone.badge, className)}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone.dot)} />
      {status}
    </Badge>
  )
}

export type ResultTone = 'positive' | 'negative' | 'indeterminate' | 'invalid'

// Interpretations as labs write them, in any case or spacing. Unknown wording gets no tone and shows as plain text.
const RESULT_TONES: Record<string, ResultTone> = {
  positive: 'positive', pos: 'positive', detected: 'positive', reactive: 'positive', '+': 'positive',
  negative: 'negative', neg: 'negative', not_detected: 'negative', undetected: 'negative', nondetected: 'negative', non_detected: 'negative',
  non_reactive: 'negative', nonreactive: 'negative', '-': 'negative', '−': 'negative',
  inconclusive: 'indeterminate', indeterminate: 'indeterminate', equivocal: 'indeterminate', borderline: 'indeterminate',
  invalid: 'invalid', failed: 'invalid',
}

/** The tone of an interpretation such as "Positive", "NEG" or "not detected"; null when it is not one LACV recognises. */
export function resultTone(interpretation: string | null | undefined): ResultTone | null {
  const raw = (interpretation ?? '').trim().toLowerCase()
  const key = raw.replace(/[\s-]+/g, '_')
  return RESULT_TONES[raw] ?? RESULT_TONES[key] ?? RESULT_TONES[key.replace(/_/g, '')] ?? null
}

// Blue and red rather than green and red, so the pair stays distinct with red-green colour blindness; each also has its own symbol.
export const RESULT_TONE_CLASSES: Record<ResultTone, { badge: string; symbol: string; label: string }> = {
  positive: { badge: 'border-rose-600/30 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200', symbol: '+', label: 'positive' },
  negative: { badge: 'border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200', symbol: '−', label: 'negative' },
  indeterminate: { badge: 'border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200', symbol: '?', label: 'inconclusive' },
  invalid: { badge: 'border-slate-400/40 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200', symbol: '!', label: 'invalid' },
}

/**
 * An assay interpretation as a badge: positive and negative differ in colour and in symbol (+ / −), and the stored text is
 * always shown as written, so "detected" is never relabelled "positive". Unrecognised text renders plainly.
 */
export function ResultBadge({ interpretation, className }: { interpretation: string | null | undefined; className?: string }) {
  if (!interpretation) return null
  const tone = resultTone(interpretation)
  if (!tone) return <span className={cn('text-foreground/85', className)}>{interpretation}</span>
  const style = RESULT_TONE_CLASSES[tone]
  return (
    <Badge variant="outline" data-tone={tone} className={cn('gap-1 font-semibold', style.badge, className)}>
      <span aria-hidden="true" className="font-mono leading-none">{style.symbol}</span>
      {interpretation}
    </Badge>
  )
}

// A fixed set of muted hues so the same Sample type is recognisable from row to row. The type name is always shown too.
const TYPE_HUES = ['bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-400', 'bg-lime-600', 'bg-indigo-400', 'bg-orange-400']

export function SampleTypeLabel({ typeId, name, className }: { typeId: number | null | undefined; name: string | null | undefined; className?: string }) {
  if (!name) return <span className={cn('text-muted-foreground', className)}>No type</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[2px]', typeId ? TYPE_HUES[typeId % TYPE_HUES.length] : 'bg-slate-300')} />
      {name}
    </span>
  )
}

/** A small mono identifier, e.g. a legacy MAT code or external ID: present but quieter than the Sample code. */
export function SecondaryCode({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs text-muted-foreground', className)}>{children}</span>
}

/** A quantity with tabular figures and a quieter unit. */
export function QuantityValue({ value, unit, className }: { value: string | null | undefined; unit: string | null | undefined; className?: string }) {
  const amount = formatQuantity(value, null)
  if (!amount) return null
  return <span className={cn('font-medium text-foreground tabular-nums', className)}>{amount}{unit && <> <span className="font-normal text-muted-foreground">{unit}</span></>}</span>
}

/** A navigable Sample code. */
export function SampleLink({ sample, className }: { sample: SampleRef; className?: string }) {
  return <Link className={cn('font-mono font-medium text-primary underline-offset-2 hover:underline', className)} to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link>
}

/** A record page whose record did not load: "not found" only when the server says so; otherwise the reason, so a network or server failure is not mistaken for a missing record. */
export function NotLoaded({ error, what }: { error: Error | null; what: string }) {
  const status = (error as { status?: number } | null)?.status
  if (!error || status === 404) return <p className="py-6 text-sm text-muted-foreground">{what} not found.</p>
  return <p role="alert" className={cn(errorClass, 'my-4')}>Could not load the {what.toLowerCase()}. {error.message}</p>
}
