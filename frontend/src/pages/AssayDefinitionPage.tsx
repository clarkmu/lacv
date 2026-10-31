import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, FileSpreadsheet, Pencil } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { errorClass, Panel, QuantityValue, SampleLink, SampleTypeLabel, SecondaryCode, StatusBadge } from '../components/common'
import { formatDateTime } from '../format'
import type { AssayDefinitionDetail, AssayExecution } from '../types'

/** One reusable assay: what the procedure is, what it reports, and every execution of it across Samples. */
export function AssayDefinitionPage() {
  const { id = '' } = useParams()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['assay-definition', id], queryFn: () => api.getAssayDefinition(id) })
  const toggle = useMutation({
    mutationFn: (isActive: boolean) => api.updateAssayDefinition(Number(id), { is_active: isActive }),
    onSuccess: definition => {
      client.setQueryData(['assay-definition', id], definition)
      client.invalidateQueries({ queryKey: ['assay-definitions'] })
    },
  })

  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading assay…</p>
  if (!query.data) return <p className="py-6 text-sm text-muted-foreground">Assay not found.</p>
  const definition = query.data

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/assays">Assays</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{definition.assay_name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{definition.assay_name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <SecondaryCode>{definition.assay_code}</SecondaryCode>
              <span>{definition.assay_type}{definition.target ? ` · ${definition.target}` : ''}</span>
              {!definition.is_active && <StatusBadge status="retired" />}
              <span className="tabular-nums">{definition.execution_count} {definition.execution_count === 1 ? 'execution' : 'executions'} on {definition.sample_count} {definition.sample_count === 1 ? 'sample' : 'samples'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(!definition.is_active)}>
              {definition.is_active ? <><Archive aria-hidden="true" />Retire</> : <><ArchiveRestore aria-hidden="true" />Put back in use</>}
            </Button>
            <Button asChild variant="outline" size="sm"><Link to={`/assays/${definition.assay_definition_id}/edit`}><Pencil aria-hidden="true" />Edit</Link></Button>
          </div>
        </div>
        {!definition.is_active && <p className="text-xs text-muted-foreground">Retired: kept with its executions, but no longer offered when recording an assay.</p>}
        {toggle.error && <p role="alert" className={errorClass}>{toggle.error.message}</p>}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Procedure">
          <dl className="grid gap-x-6 text-[13px] sm:grid-cols-2">
            <Detail label="Type">{definition.assay_type}</Detail>
            <Detail label="Target">{definition.target}</Detail>
            <Detail label="Kit">{definition.kit}</Detail>
            <Detail label="Instrument">{definition.instrument}</Detail>
            <Detail label="Typical volume"><QuantityValue value={definition.typical_volume} unit={definition.typical_volume_unit} /></Detail>
            <Detail label="Last performed"><span className="tabular-nums">{formatDateTime(definition.last_performed)}</span></Detail>
            <Detail label="Procedure notes" wide>{definition.description && <span className="whitespace-pre-wrap">{definition.description}</span>}</Detail>
            {definition.source_file_name && (
              <Detail label="Imported from" wide>
                <span className="inline-flex flex-wrap items-center gap-x-2"><FileSpreadsheet aria-hidden="true" className="size-3.5 text-muted-foreground" />{definition.source_file_name}
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(definition.imported_at)}</span>
                  <span title={`SHA-256 of the uploaded workbook: ${definition.source_sha256}`}><SecondaryCode>sha256 {definition.source_sha256?.slice(0, 12)}…</SecondaryCode></span>
                </span>
              </Detail>
            )}
          </dl>
        </Panel>
        <Panel title="Results reported" bodyClassName="p-0">
          {definition.expected_results.length ? (
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-muted-foreground"><tr>{['Analyte', 'Result', 'Unit', 'Value'].map(label => <th key={label} className="border-b px-3 py-1.5 font-medium">{label}</th>)}</tr></thead>
              <tbody>
                {definition.expected_results.map((result, index) => (
                  <tr key={index}>
                    <td className="border-b px-3 py-1.5">{result.analyte}</td>
                    <td className="border-b px-3 py-1.5 font-medium">{result.result_name}</td>
                    <td className="border-b px-3 py-1.5 text-muted-foreground">{result.unit}</td>
                    <td className="border-b px-3 py-1.5 text-muted-foreground">{VALUE_TYPES[result.value_type]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-3 py-3 text-sm text-muted-foreground">No results listed. Executions can still record any result.</p>}
        </Panel>
      </div>

      <section aria-label="Executions" className="space-y-2">
        <h2 className="text-[13px] font-semibold tracking-tight">Executions <span className="font-normal text-muted-foreground">· this assay performed on Samples</span></h2>
        <ExecutionsTable definition={definition} />
      </section>
    </div>
  )
}

const VALUE_TYPES = { either: 'number or text', numeric: 'number', text: 'text' }

function ExecutionsTable({ definition }: { definition: AssayDefinitionDetail }) {
  return (
    <ListTable<AssayExecution>
      rows={definition.executions}
      searchPlaceholder="Filter by execution, sample, performed by, status, or QC"
      getRowKey={execution => execution.execution_id}
      emptyMessage="No executions yet. Record this assay from a Sample's page."
      columns={[
        { key: 'execution_code', label: 'Execution', value: execution => execution.execution_code, render: execution => <Link className="font-mono text-[13px] font-semibold text-foreground hover:text-primary hover:underline" to={`/assay-executions/${execution.execution_id}`}>{execution.execution_code}</Link> },
        { key: 'sample', label: 'Sample', value: execution => execution.sample.sample_code, render: execution => <SampleLink sample={execution.sample} /> },
        { key: 'sample_type', label: 'Sample type', value: execution => execution.sample.sample_type, render: execution => <SampleTypeLabel typeId={null} name={execution.sample.sample_type} /> },
        { key: 'assay_date', label: 'Date', value: execution => execution.assay_date, render: execution => <span className="text-muted-foreground tabular-nums">{formatDateTime(execution.assay_date)}</span> },
        { key: 'operator_name', label: 'Performed by', value: execution => execution.operator_name },
        { key: 'status', label: 'Status', value: execution => execution.status, render: execution => <StatusBadge status={execution.status} /> },
        { key: 'qc_status', label: 'QC', value: execution => execution.qc_status, render: execution => <StatusBadge status={execution.qc_status} /> },
        { key: 'result_count', label: 'Results', numeric: true, value: execution => execution.result_count },
      ]}
    />
  )
}

function Detail({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-[7.5rem_1fr] items-baseline gap-2 border-b py-1.5 last:border-b-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children || <span className="text-muted-foreground/60">—</span>}</dd>
    </div>
  )
}
