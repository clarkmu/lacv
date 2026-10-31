import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { errorClass, PageHeader, QuantityValue, SecondaryCode, StatusBadge } from '../components/common'
import { formatDateTime } from '../format'
import { resultLabel } from '../assayResults'
import type { AssayDefinitionListItem } from '../types'

/** The assays the lab performs: reusable procedures, each run on many Samples. */
export function AssaysPage() {
  const [showRetired, setShowRetired] = useState(false)
  const { data = [], isLoading, error } = useQuery({ queryKey: ['assay-definitions'], queryFn: () => api.listAssayDefinitions() })
  const rows = showRetired ? data : data.filter(definition => definition.is_active)

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading assays…</p>
  if (error) return <p role="alert" className={errorClass}>Could not load assays.</p>

  return (
    <section>
      <PageHeader
        title="Assays"
        description="Procedures the lab performs. Define an assay once, then record it on any Sample from that Sample's page."
        actions={<>
          <Button asChild variant="outline" size="sm"><Link to="/assays/import"><FileSpreadsheet aria-hidden="true" />Import from XLSX</Link></Button>
          <Button asChild size="sm"><Link to="/assays/new"><Plus aria-hidden="true" />New assay</Link></Button>
        </>}
      />
      <ListTable<AssayDefinitionListItem>
        rows={rows}
        searchPlaceholder="Filter by name, code, type, target, kit, or instrument"
        getRowKey={definition => definition.assay_definition_id}
        emptyMessage="No assays match your filter."
        filters={
          <div className="flex items-center gap-2">
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
            key: 'results', label: 'Reports', value: definition => definition.expected_results.map(resultLabel).join(', '),
            render: definition => <span className="text-muted-foreground">{definition.expected_results.map(resultLabel).join(', ')}</span>,
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
