import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { SampleLink } from './SamplePage'

const inputClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm'

/** A transformation of one input sample into one derived output sample. */
export function NewProcessPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const input = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const sampleTypes = useQuery({ queryKey: ['sample-types'], queryFn: api.listSampleTypes })
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const [values, setValues] = useState<Record<string, string>>({ process_type: params.get('action') || '' })
  const set = (key: string) => (event: { target: { value: string } }) => setValues(current => ({ ...current, [key]: event.target.value }))
  const number = (key: string) => (values[key] ? Number(values[key]) : null)

  const mutation = useMutation({
    mutationFn: () => api.createProcessEvent({
      process_code: values.process_code,
      process_type: values.process_type,
      input_sample_ids: [Number(id)],
      quantity_used: number('quantity_used'),
      quantity_unit: values.quantity_unit || null,
      operator_name: values.operator_name || null,
      completed_at: new Date().toISOString(),
      status: 'completed',
      notes: values.notes || null,
      output_samples: [{
        sample_code: values.output_code,
        sample_type_id: number('output_type_id'),
        current_quantity: number('output_quantity'),
        quantity_unit: values.output_unit || null,
        quantity_generated: number('output_quantity'),
        storage_location_id: number('storage_location_id'),
        status: 'available',
      }],
    }),
    onSuccess: process => {
      client.invalidateQueries({ queryKey: ['sample'] })
      client.invalidateQueries({ queryKey: ['sample-lineage'] })
      navigate(`/sample/${process.outputs[0]?.sample_id ?? id}`)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  if (input.isLoading) return <p>Loading sample…</p>
  if (!input.data) return <p>Sample not found.</p>

  return (
    <form onSubmit={submit} className="max-w-3xl rounded border border-slate-200 bg-white p-4">
      <p className="mb-1 text-sm text-slate-500">Input <SampleLink sample={input.data} /></p>
      <h1 className="text-xl font-semibold">Record process</h1>
      <p className="mt-1 text-sm text-slate-500">The output becomes a derived sample of the input. Its values are entered here, not copied.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">Process code<input required autoFocus value={values.process_code ?? ''} onChange={set('process_code')} className={inputClass} /></label>
        <label className="text-sm font-medium">Process type<input required value={values.process_type ?? ''} onChange={set('process_type')} className={inputClass} /></label>
        <label className="text-sm font-medium">Operator<input value={values.operator_name ?? ''} onChange={set('operator_name')} className={inputClass} /></label>
        <label className="text-sm font-medium">Input quantity used<input type="number" step="any" value={values.quantity_used ?? ''} onChange={set('quantity_used')} className={inputClass} /></label>
        <label className="text-sm font-medium">Input unit<input value={values.quantity_unit ?? ''} onChange={set('quantity_unit')} placeholder={input.data.quantity_unit ?? ''} className={inputClass} /></label>
        <div />
        <label className="text-sm font-medium">Output sample code<input required value={values.output_code ?? ''} onChange={set('output_code')} className={inputClass} /></label>
        <label className="text-sm font-medium">Output sample type
          <select value={values.output_type_id ?? ''} onChange={set('output_type_id')} className={inputClass}>
            <option value="">No type</option>
            {(sampleTypes.data ?? []).map(type => <option key={type.sample_type_id} value={type.sample_type_id}>{type.type_name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Output storage location
          <select value={values.storage_location_id ?? ''} onChange={set('storage_location_id')} className={inputClass}>
            <option value="">No location</option>
            {(locations.data ?? []).map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code} · {location.location_name || location.location_type}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Output quantity<input type="number" step="any" value={values.output_quantity ?? ''} onChange={set('output_quantity')} className={inputClass} /></label>
        <label className="text-sm font-medium">Output unit<input value={values.output_unit ?? ''} onChange={set('output_unit')} className={inputClass} /></label>
        <div />
        <label className="text-sm font-medium sm:col-span-3">Notes<textarea value={values.notes ?? ''} onChange={set('notes')} className={`${inputClass} min-h-16`} /></label>
      </div>
      {mutation.error && <p role="alert" className="mt-3 text-sm text-red-700">{mutation.error.message}</p>}
      <button disabled={mutation.isPending} className="mt-4 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400">{mutation.isPending ? 'Saving…' : 'Save process'}</button>
    </form>
  )
}
