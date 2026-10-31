import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, FlaskConical, MapPin, Pipette, Workflow, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { SampleLink, StatusBadge } from '../common'
import { formatDateTime, formatQuantity } from '../../format'
import type { SampleDetail, SampleRef } from '../../types'

export type ActivityKind = 'process' | 'assay' | 'storage' | 'quantity'

export type ActivityItem = {
  key: string
  kind: ActivityKind
  date: string | null
  title: ReactNode
  detail?: ReactNode
}

const KINDS: { kind: ActivityKind; label: string; icon: LucideIcon }[] = [
  { kind: 'process', label: 'Processes', icon: Workflow },
  { kind: 'assay', label: 'Assays', icon: FlaskConical },
  { kind: 'storage', label: 'Storage', icon: MapPin },
  { kind: 'quantity', label: 'Quantity', icon: Pipette },
]

/** Everything recorded against this Sample, newest first; undated records go last. Presentation only: no values are derived. */
export function buildActivity(sample: SampleDetail): ActivityItem[] {
  const items: ActivityItem[] = [
    ...sample.process_events.map(event => ({
      key: `process-${event.process_event_id}`,
      kind: 'process' as const,
      date: event.started_at ?? event.completed_at,
      title: <>{event.process_type} <span className="font-mono text-xs text-muted-foreground">{event.process_code}</span></>,
      detail: (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-muted-foreground">{event.role === 'output' ? 'Produced this sample' : 'Used this sample'}</span>
          <SampleList samples={event.inputs} />
          <ArrowRight aria-label="to" className="size-3 text-muted-foreground" />
          <SampleList samples={event.outputs} />
          {event.operator_name && <span className="text-muted-foreground">· {event.operator_name}</span>}
        </span>
      ),
    })),
    ...sample.assays.map(assay => ({
      key: `assay-${assay.execution_id}`,
      kind: 'assay' as const,
      date: assay.assay_date,
      title: <><Link className="text-primary hover:underline" to={`/assay-executions/${assay.execution_id}`}>{assay.execution_code}</Link> <span className="text-muted-foreground">{assay.assay_name}</span></>,
      detail: <span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={assay.status} />QC <StatusBadge status={assay.qc_status} /><span className="text-muted-foreground">{assay.result_count} {assay.result_count === 1 ? 'result' : 'results'}</span></span>,
    })),
    ...sample.storage_events.map(event => ({
      key: `storage-${event.storage_event_id}`,
      kind: 'storage' as const,
      date: event.event_date,
      title: storageTitle(event.event_type, event.from_location_code, event.to_location_code),
      detail: [event.operator_name, event.notes].filter(Boolean).join(' · ') || undefined,
    })),
    ...sample.quantity_events.map(event => ({
      key: `quantity-${event.quantity_event_id}`,
      kind: 'quantity' as const,
      date: event.event_date,
      title: <><span className="capitalize">{event.event_type}</span> <span className="font-mono tabular-nums">{signed(event.quantity_change, event.quantity_unit)}</span></>,
      detail: (
        <span className="text-muted-foreground tabular-nums">
          {formatQuantity(event.quantity_before, null) || '—'} → {formatQuantity(event.quantity_after, null) || '—'} {event.quantity_unit}
          {event.operator_name && ` · ${event.operator_name}`}{event.notes && ` · ${event.notes}`}
        </span>
      ),
    })),
  ]
  const time = (item: ActivityItem) => (item.date ? Date.parse(item.date) : Number.NaN)
  return items.sort((left, right) => {
    const [a, b] = [time(left), time(right)]
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : -1
    return b - a
  })
}

export function SampleActivity({ sample }: { sample: SampleDetail }) {
  const items = buildActivity(sample)
  const [kind, setKind] = useState<ActivityKind | 'all'>('all')
  const shown = kind === 'all' ? items : items.filter(item => item.kind === kind)
  const filterClass = 'rounded-sm px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground'

  return (
    <section aria-label="Activity" className="rounded-md border bg-card shadow-xs">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
        <h2 className="text-[13px] font-semibold tracking-tight">Activity</h2>
        <div role="group" aria-label="Show activity" className="flex flex-wrap gap-0.5">
          <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')} className={filterClass}>All <span className="tabular-nums opacity-70">{items.length}</span></button>
          {KINDS.map(option => (
            <button key={option.kind} type="button" aria-pressed={kind === option.kind} onClick={() => setKind(option.kind)} className={filterClass}>
              {option.label} <span className="tabular-nums opacity-70">{items.filter(item => item.kind === option.kind).length}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ol className="px-3 py-2">
          {shown.map((item, index) => {
            const Icon = KINDS.find(option => option.kind === item.kind)!.icon
            return (
              <li key={item.key} data-kind={item.kind} className="grid grid-cols-[7.5rem_1.5rem_minmax(0,1fr)] gap-x-2 text-[13px]">
                <time className="pt-1.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{formatDateTime(item.date) || 'No date'}</time>
                <div className="relative flex justify-center">
                  <span aria-hidden="true" className={cn('absolute top-0 bottom-0 w-px bg-border', index === 0 && 'top-3', index === shown.length - 1 && 'bottom-auto h-3')} />
                  <span className="relative mt-1 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground">
                    <Icon aria-label={item.kind} className="size-3" />
                  </span>
                </div>
                <div className="min-w-0 pt-1 pb-2.5">
                  <div className="font-medium">{item.title}</div>
                  {item.detail && <div className="mt-0.5 text-xs">{item.detail}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      ) : <p className="px-3 py-4 text-sm text-muted-foreground">Nothing recorded for this sample yet.</p>}
    </section>
  )
}

function SampleList({ samples }: { samples: SampleRef[] }) {
  return <span className="inline-flex flex-wrap gap-x-1.5">{samples.map(sample => <SampleLink key={sample.sample_id} sample={sample} className="text-xs" />)}</span>
}

function storageTitle(eventType: string, from: string | null, to: string | null) {
  if (eventType === 'stored') return <>Stored in <span className="font-mono">{to}</span></>
  if (eventType === 'removed') return <>Removed from <span className="font-mono">{from}</span></>
  if (eventType === 'moved') return <>Moved <span className="font-mono">{from}</span> → <span className="font-mono">{to}</span></>
  return <span className="capitalize">{eventType}</span>
}

function signed(change: string, unit: string) {
  const amount = formatQuantity(change, unit)
  return Number(change) > 0 ? `+${amount}` : amount.replace('-', '−')
}
