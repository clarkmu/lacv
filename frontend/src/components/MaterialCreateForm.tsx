import { FormEvent, useState } from 'react'
import type { ReactNode } from 'react'
import type { MaterialTypeBrief, SampleBrief, StorageLocation } from '../types'

export type MaterialCreatePayload = {
  sample_id: number
  material_type_id: number
  material_code: string
  material_label: string | null
  material_subtype: string | null
  current_quantity: number | null
  quantity_unit: string | null
  concentration: number | null
  concentration_unit: string | null
  storage_location_id: number | null
  status: string
  is_consumed: boolean
  is_disposed: boolean
  expiration_date: string | null
  notes: string | null
}

type MaterialCreateFormProps = {
  title: string
  submitLabel: string
  pendingLabel: string
  samples: SampleBrief[]
  materialTypes: MaterialTypeBrief[]
  storageLocations: StorageLocation[]
  isPending: boolean
  error: Error | null
  intro?: ReactNode
  description?: string
  onSubmit: (payload: MaterialCreatePayload) => void
}

export function MaterialCreateForm({
  title,
  submitLabel,
  pendingLabel,
  samples,
  materialTypes,
  storageLocations,
  isPending,
  error,
  intro,
  description,
  onSubmit,
}: MaterialCreateFormProps) {
  const [sampleId, setSampleId] = useState('')
  const [materialTypeId, setMaterialTypeId] = useState('')
  const [storageLocationId, setStorageLocationId] = useState('')
  const [materialCode, setMaterialCode] = useState('')
  const [materialLabel, setMaterialLabel] = useState('')
  const [materialSubtype, setMaterialSubtype] = useState('')
  const [currentQuantity, setCurrentQuantity] = useState('')
  const [quantityUnit, setQuantityUnit] = useState('')
  const [concentration, setConcentration] = useState('')
  const [concentrationUnit, setConcentrationUnit] = useState('')
  const [status, setStatus] = useState('available')
  const [isConsumed, setIsConsumed] = useState(false)
  const [isDisposed, setIsDisposed] = useState(false)
  const [expirationDate, setExpirationDate] = useState('')
  const [notes, setNotes] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      sample_id: Number(sampleId),
      material_type_id: Number(materialTypeId),
      material_code: materialCode,
      material_label: materialLabel || null,
      material_subtype: materialSubtype || null,
      current_quantity: currentQuantity ? Number(currentQuantity) : null,
      quantity_unit: quantityUnit || null,
      concentration: concentration ? Number(concentration) : null,
      concentration_unit: concentrationUnit || null,
      storage_location_id: storageLocationId ? Number(storageLocationId) : null,
      status,
      is_consumed: isConsumed,
      is_disposed: isDisposed,
      expiration_date: expirationDate || null,
      notes: notes || null,
    })
  }

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {intro}
      <h1 className={intro ? 'mt-3 text-2xl font-semibold' : 'text-2xl font-semibold'}>{title}</h1>
      {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
      <label className="mt-6 block text-sm font-medium">Sample<select required value={sampleId} onChange={event => setSampleId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">Select sample</option>{samples.map(sample => <option key={sample.sample_id} value={sample.sample_id}>{sample.sample_code} - {sample.sample_type || 'No type'}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Material type<select required value={materialTypeId} onChange={event => setMaterialTypeId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">Select material type</option>{materialTypes.map(type => <option key={type.material_type_id} value={type.material_type_id}>{type.type_name}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Storage location<select value={storageLocationId} onChange={event => setStorageLocationId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">No location</option>{storageLocations.map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code} - {location.location_name || location.location_type}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Material code<input required value={materialCode} onChange={event => setMaterialCode(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Label<input value={materialLabel} onChange={event => setMaterialLabel(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Subtype<input value={materialSubtype} onChange={event => setMaterialSubtype(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Quantity<input type="number" step="any" value={currentQuantity} onChange={event => setCurrentQuantity(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Quantity unit<input value={quantityUnit} onChange={event => setQuantityUnit(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Concentration<input type="number" step="any" value={concentration} onChange={event => setConcentration(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Concentration unit<input value={concentrationUnit} onChange={event => setConcentrationUnit(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      </div>
      <label className="mt-4 block text-sm font-medium">Expiration date<input type="datetime-local" value={expirationDate} onChange={event => setExpirationDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Status<input required value={status} onChange={event => setStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={isConsumed} onChange={event => setIsConsumed(event.target.checked)} />Consumed</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={isDisposed} onChange={event => setIsDisposed(event.target.checked)} />Disposed</label>
      </div>
      <label className="mt-4 block text-sm font-medium">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      {error && <p className="mt-4 text-sm text-red-700">{error.message}</p>}
      <button disabled={isPending || !sampleId || !materialTypeId} className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400">{isPending ? pendingLabel : submitLabel}</button>
    </form>
  )
}
