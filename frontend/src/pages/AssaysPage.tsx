import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { errorClass, PageHeader, QuantityValue, SecondaryCode, StatusBadge } from '../components/common'
import { formatDateTime } from '../format'
import type { AssayDefinitionListItem } from '../types'

/**
 * The assays the lab performs: reusable procedures, each run on many Samples. ?type=qPCR narrows the list to assays whose
 * type contains that text (any case): the Results menu's shortcut to where those results are entered and read.
 */
export function AssaysPage() {
  const [showRetired, setShowRetired] = useState(false)
  const [params] = useSearchParams()
  const type = params.get('type')?.trim() ?? ''
  const { data = [], isLoading, error } = useQuery({ queryKey: ['assay-definitions'], queryFn: () => api.listAssayDefinitions() })
  const ofType = type ? data.filter(definition => definition.assay_type.toLowerCase().includes(type.toLowerCase())) : data
  const rows = showRetired ? ofType : ofType.filter(definition => definition.is_active)

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading assays…</p>
  if (error) return <p role="alert" className={errorClass}>Could not load assays.</p>

  return (
    <section>
      <PageHeader
        title={type ? `${type} results` : 'Assays'}
        description={type
          ? `Assays of type ${type}. Open one to see its executions and every sample's results.`
          : 'Procedures the lab performs. Open an assay to run it on one or more samples and enter their results.'}
        actions={<>
          <Button asChild size="sm"><Link to="/assays/new"><Plus aria-hidden="true" />New assay</Link></Button>
        </>}
      />
      <ListTable<AssayDefinitionListItem>
        rows={rows}
        searchPlaceholder="Filter by name, code, type, target, kit, or instrument"
        getRowKey={definition => definition.assay_definition_id}
        emptyMessage={type && ofType.length === 0
          ? `No ${type} assays yet. Results are recorded on an assay's page: create an assay of type ${type} to record them.`
          : 'No assays match your filter.'}
        filters={
          <div className="flex items-center gap-2">
            {type && (
              <span className="inline-flex h-7 items-center gap-1 rounded-md border bg-secondary pr-1 pl-2 text-xs">
                Type: <span className="font-medium">{type}</span>
                <Link to="/assays" aria-label={`Show all assay types, not only ${type}`} className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"><X aria-hidden="true" className="size-3" /></Link>
              </span>
            )}
            <Checkbox id="show-retired" checked={showRetired} onCheckedChange={checked => setShowRetired(checked === true)} />
            <label htmlFor="show-retired" className="cursor-pointer text-[13px] select-none">Show retired</label>
          </div>
        }
        columns={[
          {
            key: 'assay_name', label: 'Assay', value: definition => definition.assay_name,
            render: definition => <Link className="font-semibold text-foreground decoration-primary/40 underline-offset-2 hover:text-primary hover:underline" to={`/assays/${definition.assay_definition_id}`}>{definition.assay_name}</Link>,
          },
          { key: 'assay_code', label: 'Code', value: definition => definition.assay_code, render: definition => <SecondaryCode>{definition.assay_code}</SecondaryCode> },
          { key: 'assay_type', label: 'Type', value: definition => definition.assay_type },
          { key: 'target', label: 'Target', value: definition => definition.target },
          {
            key: 'results', label: 'Results', value: definition => definition.result_fields.map(field => field.label).join(', '),
            render: definition => <span className="text-muted-foreground">{definition.result_fields.map(field => `${field.label}${field.unit ? ` (${field.unit})` : ''}`).join(', ')}</span>,
          },
          { key: 'kit', label: 'Kit', value: definition => definition.kit },
          { key: 'instrument', label: 'Instrument', value: definition => definition.instrument },
          {
            key: 'typical_volume', label: 'Typical volume', numeric: true, value: definition => (definition.typical_volume === null ? null : Number(definition.typical_volume)),
            render: definition => <QuantityValue value={definition.typical_volume} unit={definition.typical_volume_unit} />,
          },
          { key: 'execution_count', label: 'Executions', numeric: true, value: definition => definition.execution_count },
          { key: 'sample_count', label: 'Samples', numeric: true, value: definition => definition.sample_count },
          { key: 'last_performed', label: 'Last performed', value: definition => definition.last_performed, render: definition => <span className="text-muted-foreground tabular-nums">{formatDateTime(definition.last_performed)}</span> },
          { key: 'is_active', label: 'State', value: definition => (definition.is_active ? 'in use' : 'retired'), render: definition => (definition.is_active ? '' : <StatusBadge status="retired" />) },
        ]}
      />
    </section>
  )
}
