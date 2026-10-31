import type { ReactNode } from 'react'
import { CornerUpLeft, Refrigerator, Sprout } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { QuantityValue, SampleLink } from '../common'
import { availabilityTitle, SampleAvailability } from './SampleAvailability'
import type { SampleDetail } from '../../types'

/** The physical state of the specimen at a glance: how much remains, its concentration, where it is, and where it came from. */
export function SpecimenState({ sample }: { sample: SampleDetail }) {
  const producedBy = sample.process_events.find(event => event.role === 'output')
  const producedByAssay = sample.generated_by_assays[0]

  return (
    <section aria-label="Specimen state" className="grid overflow-hidden rounded-md border bg-card shadow-xs sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
      <Cell label={availabilityTitle(sample.availability)} className="sm:col-span-2 xl:col-span-1">
        <SampleAvailability availability={sample.availability} />
      </Cell>
      <Cell label="Concentration">
        {sample.concentration !== null
          ? <QuantityValue value={sample.concentration} unit={sample.concentration_unit} className="text-base" />
          : <Empty>Not recorded</Empty>}
      </Cell>
      <Cell label="Location">
        {sample.storage_location ? (
          <div className="flex items-start gap-2">
            <Refrigerator aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <Link className="font-mono text-[13px] font-medium text-primary hover:underline" to={`/storage-location/${sample.storage_location.storage_location_id}`}>{sample.storage_location.location_code}</Link>
              <p className="truncate text-xs text-muted-foreground">{sample.storage_location.location_name || sample.storage_location.location_type}</p>
            </div>
          </div>
        ) : <Empty>Not stored</Empty>}
      </Cell>
      <Cell label="Origin">
        {sample.parent ? (
          <div className="flex items-start gap-2">
            <CornerUpLeft aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <SampleLink sample={sample.parent} className="text-[13px]" />
              <p className="text-xs text-muted-foreground">
                {producedBy ? <>via {producedBy.process_type} <span className="font-mono">{producedBy.process_code}</span></>
                  : producedByAssay ? <>via assay <Link className="font-mono hover:underline" to={`/assay/${producedByAssay.assay_id}`}>{producedByAssay.assay_code}</Link></>
                  : 'Parent sample'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <Sprout aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-[13px] font-medium">Root sample</p>
              <p className="text-xs text-muted-foreground">{sample.batch ? <>Batch <Link className="font-mono hover:underline" to={`/batch/${sample.batch.batch_id}`}>{sample.batch.batch_code}</Link></> : 'No shipping batch'}</p>
            </div>
          </div>
        )}
      </Cell>
    </section>
  )
}

function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 border-b px-4 py-3 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0', className)}>
      <h2 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</h2>
      {children}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>
}
