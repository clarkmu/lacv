import { FormEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export type SampleFormPayload = {
  sample_code: string
  sample_type_id: number | null
  label: string | null
  external_sample_id: string | null
  current_quantity: number | null
  quantity_unit: string | null
  concentration: number | null
  concentration_unit: string | null
  storage_location_id: number | null
  status: string
  notes: string | null
  batch_id?: number | null
}

type SampleFormProps = {
  title: string
  submitLabel: string
  defaultStatus: string
  isPending: boolean
  error: Error | null
  intro?: ReactNode
  description?: string
  allowBatch?: boolean
  onSubmit: (payload: SampleFormPayload) => void
}

const inputClass = 'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm'

/** Values for one new Sample. Nothing is pre-filled from a parent. */
export function SampleForm({ title, submitLabel, defaultStatus, isPending, error, intro, description, allowBatch = false, onSubmit }: SampleFormProps) {
  const sampleTypes = useQuery({ queryKey: ['sample-types'], queryFn: api.listSampleTypes })
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const batches = useQuery({ queryKey: ['batches'], queryFn: api.listBatches, enabled: allowBatch })
  const [values, setValues] = useState<Record<string, string>>({ status: defaultStatus })
  const set = (key: string) => (event: { target: { value: string } }) => setValues(current => ({ ...current, [key]: event.target.value }))
  const text = (key: string) => values[key]?.trim() || null
  const number = (key: string) => (values[key] ? Number(values[key]) : null)

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      sample_code: values.sample_code?.trim() ?? '',
      sample_type_id: number('sample_type_id'),
      label: text('label'),
      external_sample_id: text('external_sample_id'),
      current_quantity: number('current_quantity'),
      quantity_unit: text('quantity_unit'),
      concentration: number('concentration'),
      concentration_unit: text('concentration_unit'),
      storage_location_id: number('storage_location_id'),
      status: values.status || defaultStatus,
      notes: text('notes'),
      ...(allowBatch ? { batch_id: number('batch_id') } : {}),
    })
  }

  return (
    <form onSubmit={submit} className="max-w-3xl rounded border border-slate-200 bg-white p-4">
      {intro}
      <h1 className="text-xl font-semibold">{title}</h1>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">Sample code<input required autoFocus value={values.sample_code ?? ''} onChange={set('sample_code')} className={inputClass} /></label>
        <label className="text-sm font-medium">Sample type
          <select value={values.sample_type_id ?? ''} onChange={set('sample_type_id')} className={inputClass}>
            <option value="">No type</option>
            {(sampleTypes.data ?? []).map(type => <option key={type.sample_type_id} value={type.sample_type_id}>{type.type_name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Status<input required value={values.status ?? ''} onChange={set('status')} className={inputClass} /></label>
        <label className="text-sm font-medium">Label<input value={values.label ?? ''} onChange={set('label')} className={inputClass} /></label>
        <label className="text-sm font-medium">External ID<input value={values.external_sample_id ?? ''} onChange={set('external_sample_id')} className={inputClass} /></label>
        <label className="text-sm font-medium">Storage location
          <select value={values.storage_location_id ?? ''} onChange={set('storage_location_id')} className={inputClass}>
            <option value="">No location</option>
            {(locations.data ?? []).map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code} · {location.location_name || location.location_type}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Quantity<input type="number" step="any" value={values.current_quantity ?? ''} onChange={set('current_quantity')} className={inputClass} /></label>
        <label className="text-sm font-medium">Quantity unit<input value={values.quantity_unit ?? ''} onChange={set('quantity_unit')} className={inputClass} /></label>
        {allowBatch ? (
          <label className="text-sm font-medium">Shipping batch
            <select value={values.batch_id ?? ''} onChange={set('batch_id')} className={inputClass}>
              <option value="">No batch</option>
              {(batches.data ?? []).map(batch => <option key={batch.batch_id} value={batch.batch_id}>{batch.batch_code} · {batch.batch_name}</option>)}
            </select>
          </label>
        ) : <div />}
        <label className="text-sm font-medium">Concentration<input type="number" step="any" value={values.concentration ?? ''} onChange={set('concentration')} className={inputClass} /></label>
        <label className="text-sm font-medium">Concentration unit<input value={values.concentration_unit ?? ''} onChange={set('concentration_unit')} className={inputClass} /></label>
        <label className="text-sm font-medium sm:col-span-3">Notes<textarea value={values.notes ?? ''} onChange={set('notes')} className={`${inputClass} min-h-16`} /></label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error.message}</p>}
      <button disabled={isPending} className="mt-4 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400">{isPending ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
