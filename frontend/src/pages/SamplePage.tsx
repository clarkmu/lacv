import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import type { MaterialLineageNode, SampleDetail } from '../types'

const editableFields: { key: keyof SampleDetail; label: string }[] = [
  { key: 'sample_type', label: 'Sample type' },
  { key: 'external_sample_id', label: 'External sample ID' },
  { key: 'source_type', label: 'Source type' },
  { key: 'source_description', label: 'Source description' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes' },
]

export function SamplePage() {
  const { id = '' } = useParams()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const lineageQuery = useQuery({ queryKey: ['sample-lineage', id], queryFn: () => api.getSampleLineage(id) })
  const [draft, setDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!query.data) return
    const next: Record<string, string> = {}
    for (const f of editableFields) next[f.key] = String(query.data[f.key] ?? '')
    setDraft(next)
  }, [query.data])

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.updateSample(Number(id), patch),
    onSuccess: data => client.setQueryData(['sample', id], data),
  })

  if (query.isLoading) return <p>Loading sample…</p>
  if (!query.data) return <p>Sample not found.</p>
  const sample = query.data

  const saveField = (key: string) => mutation.mutate({ [key]: draft[key] === '' ? null : draft[key] })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-sm text-slate-500">Sample</div><h1 className="text-3xl font-semibold">{sample.sample_code}</h1>{sample.batch && <Link className="mt-1 inline-block text-sm text-blue-700 hover:underline" to={`/batch/${sample.batch.batch_id}`}>Batch: {sample.batch.batch_code}</Link>}</div>
        <Link to={`/sample/${sample.sample_id}/offspring/new`} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create offspring</Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Material lineage workspace</h2>
          <Link to="/materials/new" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Create material</Link>
        </div>
        {lineageQuery.isLoading ? <p className="text-sm text-slate-500">Loading lineage...</p> : lineageQuery.data?.materials.length ? (
          <div className="space-y-2">
            {lineageQuery.data.materials.map(material => <LineageNode key={material.material_id} material={material} isRoot />)}
          </div>
        ) : <p className="text-sm text-slate-500">No material lineage for this sample.</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Editable fields</h2><p className="text-sm text-slate-500">Edit a value and save that row.</p></div>
        <div className="divide-y divide-slate-100">
          {editableFields.map(field => (
            <div className="grid grid-cols-[180px_1fr_80px] items-center gap-3 px-5 py-3" key={field.key}>
              <label className="text-sm font-medium text-slate-600">{field.label}</label>
              <input value={draft[field.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))} className="rounded-md border border-transparent bg-slate-50 px-3 py-2 text-sm focus:border-blue-400 focus:bg-white" />
              <button onClick={() => saveField(field.key)} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Save</button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">Lineage</h2>
          <div className="mb-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Parent</div>{sample.parent ? <Link className="mt-1 inline-block text-blue-700 hover:underline" to={`/sample/${sample.parent.sample_id}`}>{sample.parent.sample_code}</Link> : <span className="mt-1 block text-sm text-slate-500">No parent</span>}</div>
          <div><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Offspring</div>{sample.offspring.length ? <div className="mt-2 space-y-2">{sample.offspring.map(child => <Link className="block text-blue-700 hover:underline" key={child.sample_id} to={`/sample/${child.sample_id}`}>{child.sample_code} <span className="text-slate-400">· {child.sample_type || 'No type'}</span></Link>)}</div> : <span className="mt-1 block text-sm text-slate-500">No offspring</span>}</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">Materials</h2>
          {sample.materials.length ? <div className="space-y-2">{sample.materials.map(material => <Link to={`/material/${material.material_id}`} className="block rounded-lg bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100" key={material.material_id}><span className="font-medium">{material.material_code}</span><span className="ml-2 text-slate-500">{material.material_type}</span></Link>)}</div> : <p className="text-sm text-slate-500">No materials linked to this sample.</p>}
        </div>
      </section>
    </div>
  )
}

function LineageNode({ material, isRoot = false }: { material: MaterialLineageNode; isRoot?: boolean }) {
  return (
    <div className="border-l border-slate-200 pl-4">
      {!isRoot && material.generated_by_process && (
        <div className="mb-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="font-medium text-slate-700">{material.generated_by_process.process_type}</span>
          <span className="ml-2 text-slate-500">{material.generated_by_process.process_code} - {material.generated_by_process.status}</span>
          {material.generated_by_process.operator_name && <span className="ml-2 text-slate-400">{material.generated_by_process.operator_name}</span>}
        </div>
      )}
      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        <Link className="font-medium text-blue-700 hover:underline" to={`/material/${material.material_id}`}>{material.material_code}</Link>
        <span className="ml-2 text-slate-500">{material.material_type} - {material.status}</span>
      </div>
      {material.assays.length > 0 && <div className="ml-4 mt-2 space-y-1">
        {material.assays.map(assay => <Link className="block rounded-md border-l border-slate-200 bg-white px-3 py-2 text-sm text-blue-700 hover:underline" key={assay.assay_id} to={`/assay/${assay.assay_id}`}>{assay.assay_code} <span className="text-slate-500">- {assay.assay_type}{assay.target ? ` ${assay.target}` : ''} - {assay.qc_status}</span></Link>)}
      </div>}
      {material.children.length > 0 && <div className="ml-4 mt-2 space-y-2">
        {material.children.map(child => <LineageNode key={child.material_id} material={child} />)}
      </div>}
    </div>
  )
}
