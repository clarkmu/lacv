import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import type { SampleBrief } from '../types'

export function SamplesPage() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['samples'], queryFn: api.listSamples })

  if (isLoading) return <p>Loading samples…</p>
  if (error) return <p className="text-red-700">Could not load samples.</p>

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Samples</h1><p className="mt-1 text-sm text-slate-500">Spreadsheet-style access to sample records.</p></div>
        <Link to="/samples/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create new sample</Link>
      </div>
      <ListTable<SampleBrief>
        rows={data}
        searchPlaceholder="Search samples by name, type, status, or ID"
        getRowKey={sample => sample.sample_id}
        emptyMessage="No samples match your search."
        columns={[
          { key: 'sample_code', label: 'Sample', value: sample => sample.sample_code, render: sample => <Link className="font-medium text-blue-700 hover:underline" to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link> },
          { key: 'sample_type', label: 'Type', value: sample => sample.sample_type },
          { key: 'status', label: 'Status', value: sample => sample.status },
          { key: 'sample_id', label: 'ID', value: sample => sample.sample_id },
        ]}
      />
    </section>
  )
}
