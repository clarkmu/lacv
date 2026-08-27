import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { ListTable } from '../components/ListTable'

export function MaterialsPage() {
  const query = useQuery({ queryKey: ['materials'], queryFn: api.listMaterials })
  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Materials</h1><p className="mt-1 text-sm text-slate-500">Physical materials and their lineage.</p></div>
        <Link to="/materials/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create new material</Link>
      </div>
      {query.isLoading ? <p>Loading materials…</p> : <ListTable
        rows={query.data ?? []}
        searchPlaceholder="Search materials by name, type, or status"
        getRowKey={material => material.material_id}
        emptyMessage="No materials match your search."
        columns={[
          { key: 'material_code', label: 'Material', value: material => material.material_code, render: material => <Link className="font-medium text-blue-700 hover:underline" to={`/material/${material.material_id}`}>{material.material_code}</Link> },
          { key: 'material_type', label: 'Type', value: material => material.material_type },
          { key: 'status', label: 'Status', value: material => material.status },
        ]}
      />}
    </section>
  )
}
