import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import type { AssayBrief } from '../types'

export function AssaysPage() {
  const query = useQuery({ queryKey: ['assays'], queryFn: api.listAssays })

  return (
    <section>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">Assays</h1>
        <p className="mt-1 text-sm text-slate-500">Planned and completed assay records.</p>
      </div>
      {query.isLoading ? <p>Loading assays...</p> : <ListTable<AssayBrief>
        rows={query.data ?? []}
        searchPlaceholder="Search assays by name, code, type, target, material, status, or operator"
        getRowKey={assay => assay.assay_id}
        emptyMessage="No assays match your search."
        columns={[
          { key: 'assay_code', label: 'Assay', value: assay => assay.assay_code, render: assay => <Link className="font-medium text-blue-700 hover:underline" to={`/assay/${assay.assay_id}`}>{assay.assay_code}</Link> },
          { key: 'assay_name', label: 'Name', value: assay => assay.assay_name },
          { key: 'assay_type', label: 'Type', value: assay => assay.assay_type },
          { key: 'target', label: 'Target', value: assay => assay.target },
          { key: 'material', label: 'Material', value: assay => assay.material.material_code, render: assay => <Link className="font-medium text-blue-700 hover:underline" to={`/material/${assay.material.material_id}`}>{assay.material.material_code}</Link> },
          { key: 'operator_name', label: 'Operator', value: assay => assay.operator_name },
          { key: 'assay_date', label: 'Date', value: assay => assay.assay_date },
          { key: 'status', label: 'Status', value: assay => assay.status },
          { key: 'qc_status', label: 'QC', value: assay => assay.qc_status },
        ]}
      />}
      {query.error && <p className="mt-4 text-sm text-red-700">Could not load assays.</p>}
    </section>
  )
}
