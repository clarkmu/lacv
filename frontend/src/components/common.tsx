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

/** A titled work area: a header strip with an optional action, then content. */
export function Panel({ title, action, children, className, bodyClassName }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-md border bg-card shadow-xs', className)} aria-label={typeof title === 'string' ? title : undefined}>
      <div className="flex min-h-9 items-center justify-between gap-2 border-b px-3 py-1.5">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className={cn('p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

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
