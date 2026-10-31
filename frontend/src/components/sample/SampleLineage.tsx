import type { ReactNode } from 'react'
import { GitBranchPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Panel, SampleLink } from '../common'
import type { SampleLineage as Lineage, SampleLineageNode, SampleRef } from '../../types'

// Tree connectors: each descendant draws an elbow to its parent's rail, and keeps the rail going for later siblings.
const branchClass = cn(
  'relative pl-4',
  'before:absolute before:top-0 before:left-0 before:h-3.5 before:w-3 before:rounded-bl-[3px] before:border-b before:border-l before:border-muted-foreground/35',
  'not-last:after:absolute not-last:after:top-0 not-last:after:bottom-0 not-last:after:left-0 not-last:after:border-l not-last:after:border-muted-foreground/35',
)

/** Ancestors, this Sample, then its descendants. Lineage comes from the backend; nothing is computed here. */
export function SampleLineage({ sample, lineage }: { sample: SampleRef; lineage: Lineage | undefined }) {
  const descendantCount = lineage ? countNodes(lineage.descendants) : 0
  return (
    <Panel
      title="Lineage"
      action={
        <div className="flex items-center gap-2">
          {lineage && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {lineage.descendants.length} {lineage.descendants.length === 1 ? 'child' : 'children'}
              {descendantCount > lineage.descendants.length && ` · ${descendantCount} descendants`}
            </span>
          )}
          <Button asChild variant="ghost" size="sm" className="h-7 text-primary hover:text-primary"><Link to={`/sample/${sample.sample_id}/children/new`}><GitBranchPlus aria-hidden="true" />Add child</Link></Button>
        </div>
      }
    >
      {!lineage ? <p className="text-sm text-muted-foreground">Loading lineage…</p> : (
        <ol aria-label="Lineage" className="text-[13px]">
          {lineage.ancestors.map((ancestor, index) => (
            <ChainItem key={ancestor.sample_id} marker="ancestor">
              <SampleLink sample={ancestor} className="text-xs" />
              <span className="text-xs text-muted-foreground">{index === lineage.ancestors.length - 1 ? 'parent' : 'ancestor'}</span>
            </ChainItem>
          ))}
          <ChainItem marker="current" last={lineage.descendants.length === 0}>
            <span aria-current="true" className="font-mono font-semibold">{sample.sample_code}</span>
            <span className="text-xs text-muted-foreground">this sample</span>
          </ChainItem>
          {lineage.descendants.length ? (
            <li><ul aria-label="Derived samples" className="ml-[4px]">{lineage.descendants.map(node => <Descendant key={node.sample_id} node={node} />)}</ul></li>
          ) : <li className="pl-5 text-xs text-muted-foreground">No derived samples.</li>}
        </ol>
      )}
    </Panel>
  )
}

function ChainItem({ marker, last = false, children }: { marker: 'ancestor' | 'current'; last?: boolean; children: ReactNode }) {
  return (
    <li className={cn('relative flex min-h-7 items-center gap-x-2 pl-5', !last && 'before:absolute before:top-[14px] before:-bottom-[14px] before:left-[4px] before:border-l before:border-muted-foreground/35')}>
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-[9.5px] left-0 size-[9px] rounded-full border',
          marker === 'current' ? 'border-primary bg-primary ring-3 ring-primary/15' : 'border-muted-foreground/50 bg-card',
        )}
      />
      {children}
    </li>
  )
}

function Descendant({ node }: { node: SampleLineageNode }) {
  return (
    <li className={branchClass}>
      <div className="flex min-h-7 flex-wrap items-center gap-x-2">
        <SampleLink sample={node} />
        <span className="text-xs text-muted-foreground">{node.sample_type || 'No type'}</span>
        <span className="text-xs text-muted-foreground">{node.status}</span>
        {node.generated_by && <span className="text-xs text-muted-foreground/80">via {node.generated_by.type} <span className="font-mono">{node.generated_by.code}</span></span>}
      </div>
      {node.children.length > 0 && <ul>{node.children.map(child => <Descendant key={child.sample_id} node={child} />)}</ul>}
    </li>
  )
}

function countNodes(nodes: SampleLineageNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
}
