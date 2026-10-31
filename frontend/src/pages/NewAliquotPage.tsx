import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { formatQuantity } from '../format'
import { SampleLink } from '../components/common'

const inputClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm'

export function NewAliquotPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const parent = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const sampleTypes = useQuery({ queryKey: ['sample-types'], queryFn: api.listSampleTypes })
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const [values, setValues] = useState<Record<string, string>>({ aliquot_count: '3' })
  const set = (key: string) => (event: { target: { value: string } }) => setValues(current => ({ ...current, [key]: event.target.value }))

  const mutation = useMutation({
    mutationFn: () => api.createAliquots(Number(id), {
      process_code: values.process_code,
      aliquot_count: Number(values.aliquot_count),
      sample_code_prefix: values.sample_code_prefix,
      sample_type_id: values.sample_type_id ? Number(values.sample_type_id) : null,
      quantity_per_aliquot: values.quantity_per_aliquot ? Number(values.quantity_per_aliquot) : null,
      quantity_unit: values.quantity_unit || null,
      storage_location_id: values.storage_location_id ? Number(values.storage_location_id) : null,
      operator_name: values.operator_name || null,
      notes: values.notes || null,
    }),
    onSuccess: sample => { client.setQueryData(['sample', id], sample); client.invalidateQueries({ queryKey: ['sample-lineage', id] }); navigate(`/sample/${id}`) },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  if (parent.isLoading) return <p>Loading sample…</p>
  if (!parent.data) return <p>Sample not found.</p>
  const prefix = values.sample_code_prefix || parent.data.sample_code

  return (
    <form onSubmit={submit} className="max-w-3xl rounded border border-slate-200 bg-white p-4">
      <p className="mb-1 text-sm text-slate-500">Parent <SampleLink sample={parent.data} /> · available {formatQuantity(parent.data.current_quantity, parent.data.quantity_unit) || 'unknown'}</p>
      <h1 className="text-xl font-semibold">Aliquot</h1>
      <p className="mt-1 text-sm text-slate-500">Records an aliquoting process and creates one derived sample per aliquot, coded {prefix}-01, {prefix}-02, …</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">Process code<input required autoFocus value={values.process_code ?? ''} onChange={set('process_code')} className={inputClass} /></label>
        <label className="text-sm font-medium">Number of aliquots<input required type="number" min="1" max="500" value={values.aliquot_count ?? ''} onChange={set('aliquot_count')} className={inputClass} /></label>
        <label className="text-sm font-medium">Sample code prefix<input required value={values.sample_code_prefix ?? ''} onChange={set('sample_code_prefix')} placeholder={parent.data.sample_code} className={inputClass} /></label>
        <label className="text-sm font-medium">Aliquot sample type
          <select value={values.sample_type_id ?? ''} onChange={set('sample_type_id')} className={inputClass}>
            <option value="">No type</option>
            {(sampleTypes.data ?? []).map(type => <option key={type.sample_type_id} value={type.sample_type_id}>{type.type_name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Quantity per aliquot<input type="number" step="any" value={values.quantity_per_aliquot ?? ''} onChange={set('quantity_per_aliquot')} className={inputClass} /></label>
        <label className="text-sm font-medium">Unit<input value={values.quantity_unit ?? ''} onChange={set('quantity_unit')} className={inputClass} /></label>
        <label className="text-sm font-medium">Storage location
          <select value={values.storage_location_id ?? ''} onChange={set('storage_location_id')} className={inputClass}>
            <option value="">No location</option>
            {(locations.data ?? []).map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code} · {location.location_name || location.location_type}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Operator<input value={values.operator_name ?? ''} onChange={set('operator_name')} className={inputClass} /></label>
        <label className="text-sm font-medium sm:col-span-3">Notes<textarea value={values.notes ?? ''} onChange={set('notes')} className={`${inputClass} min-h-16`} /></label>
      </div>
      {mutation.error && <p role="alert" className="mt-3 text-sm text-red-700">{mutation.error.message}</p>}
      <button disabled={mutation.isPending} className="mt-4 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400">{mutation.isPending ? 'Saving…' : 'Create aliquots'}</button>
    </form>
  )
}
