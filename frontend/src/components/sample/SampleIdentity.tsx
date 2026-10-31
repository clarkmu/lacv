import { ChevronDown, FlaskConical, GitBranchPlus, MoreHorizontal, Split, Trash2, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SampleTypeLabel, SecondaryCode, StatusBadge } from '../common'
import { formatDateTime } from '../../format'
import type { SampleDetail, SampleRef } from '../../types'

export const PROCESS_ACTIONS = ['Homogenization', 'RNA extraction', 'Reverse transcription', 'Library preparation']

/** Who this Sample is: lineage path, canonical code, type, status, label, then quieter secondary identifiers. */
export function SampleIdentity({ sample, ancestors, onDelete, isDeleting }: { sample: SampleDetail; ancestors: SampleRef[]; onDelete: () => void; isDeleting: boolean }) {
  const meta = [
    sample.batch && <>Batch <Link className="font-mono text-primary hover:underline" to={`/batch/${sample.batch.batch_id}`}>{sample.batch.batch_code}</Link></>,
    sample.received_date && <>Received <span className="tabular-nums">{formatDateTime(sample.received_date)}</span></>,
    sample.collection_date && <>Collected <span className="tabular-nums">{formatDateTime(sample.collection_date)}</span></>,
    sample.external_sample_id && <>External ID <SecondaryCode className="text-foreground/80">{sample.external_sample_id}</SecondaryCode></>,
    sample.legacy_codes.length > 0 && <span title="Legacy material codes that now refer to this sample">Legacy <SecondaryCode>{sample.legacy_codes.join(', ')}</SecondaryCode></span>,
  ].filter(Boolean)

  return (
    <header className="space-y-2">
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/samples">Samples</Link></BreadcrumbLink></BreadcrumbItem>
          {ancestors.map(ancestor => (
            <span key={ancestor.sample_id} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbLink asChild><Link className="font-mono" to={`/sample/${ancestor.sample_id}`}>{ancestor.sample_code}</Link></BreadcrumbLink></BreadcrumbItem>
            </span>
          ))}
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage className="font-mono">{sample.sample_code}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-mono text-[22px] leading-tight font-semibold tracking-tight">{sample.sample_code}</h1>
            <SampleTypeLabel typeId={sample.sample_type_id} name={sample.sample_type} className="text-[13px] font-medium text-foreground/80" />
            <StatusBadge status={sample.status} />
            {(sample.is_consumed || sample.is_disposed) && <StatusBadge status={sample.is_disposed ? 'disposed' : 'consumed'} />}
          </div>
          {sample.label && <p className="text-[15px] text-foreground/85">{sample.label}</p>}
          {meta.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {meta.map((item, index) => <span key={index} className="inline-flex items-center gap-1.5">{index > 0 && <span aria-hidden="true">·</span>}{item}</span>)}
            </p>
          )}
        </div>
        <SampleActions sample={sample} onDelete={onDelete} isDeleting={isDeleting} />
      </div>
    </header>
  )
}

function SampleActions({ sample, onDelete, isDeleting }: { sample: SampleDetail; onDelete: () => void; isDeleting: boolean }) {
  const base = `/sample/${sample.sample_id}`
  return (
    <nav aria-label="Sample actions" className="flex flex-wrap items-center gap-1.5">
      <Button asChild variant="outline" size="sm"><Link to={`${base}/children/new`}><GitBranchPlus aria-hidden="true" />Add child</Link></Button>
      <Button asChild variant="outline" size="sm"><Link to={`${base}/aliquots/new`}><Split aria-hidden="true" />Aliquot</Link></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><Workflow aria-hidden="true" />Record process<ChevronDown aria-hidden="true" className="opacity-60" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Process on {sample.sample_code}</DropdownMenuLabel>
          {PROCESS_ACTIONS.map(action => (
            <DropdownMenuItem key={action} asChild><Link to={`${base}/process/new?action=${encodeURIComponent(action)}`}>{action}</Link></DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link to={`${base}/process/new`}>Other process…</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button asChild size="sm"><Link to={`${base}/assays/new`}><FlaskConical aria-hidden="true" />Record assay</Link></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions"><MoreHorizontal aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" disabled={isDeleting} onSelect={onDelete}><Trash2 aria-hidden="true" />Delete sample…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
