import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'

export function NewAliquotPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const materialQuery = useQuery({ queryKey: ['material', id], queryFn: () => api.getMaterial(id) })
  const materialTypes = useQuery({ queryKey: ['material-types'], queryFn: api.listMaterialTypes })
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const [processCode, setProcessCode] = useState('')
  const [materialTypeId, setMaterialTypeId] = useState('')
  const [aliquotCount, setAliquotCount] = useState('3')
  const [materialCodePrefix, setMaterialCodePrefix] = useState('')
  const [quantityPerAliquot, setQuantityPerAliquot] = useState('')
  const [quantityUnit, setQuantityUnit] = useState('')
  const [storageLocationId, setStorageLocationId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.createMaterialAliquots(Number(id), {
      process_code: processCode,
      material_type_id: Number(materialTypeId),
      aliquot_count: Number(aliquotCount),
      material_code_prefix: materialCodePrefix,
      quantity_per_aliquot: quantityPerAliquot ? Number(quantityPerAliquot) : null,
      quantity_unit: quantityUnit || null,
      storage_location_id: storageLocationId ? Number(storageLocationId) : null,
      operator_name: operatorName || null,
      notes: notes || null,
    }),
    onSuccess: material => navigate(`/material/${material.material_id}`),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  if (materialQuery.isLoading) return <p>Loading material...</p>
  if (!materialQuery.data) return <p>Material not found.</p>
  const material = materialQuery.data

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <div className="text-sm text-slate-500">Parent material</div>
        <Link className="text-blue-700 hover:underline" to={`/material/${material.material_id}`}>{material.material_code}</Link>
        <h1 className="mt-3 text-2xl font-semibold">Aliquot material</h1>
      </div>
      <label className="block text-sm font-medium">Process code<input required value={processCode} onChange={event => setProcessCode(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Output material type<select required value={materialTypeId} onChange={event => setMaterialTypeId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">Select material type</option>{(materialTypes.data ?? []).map(type => <option key={type.material_type_id} value={type.material_type_id}>{type.type_name}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Number of aliquots<input required type="number" min="1" value={aliquotCount} onChange={event => setAliquotCount(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Material code prefix<input required value={materialCodePrefix} onChange={event => setMaterialCodePrefix(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Volume per aliquot<input type="number" step="any" value={quantityPerAliquot} onChange={event => setQuantityPerAliquot(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Unit<input value={quantityUnit} onChange={event => setQuantityUnit(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      </div>
      <label className="mt-4 block text-sm font-medium">Storage location<select value={storageLocationId} onChange={event => setStorageLocationId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">No location</option>{(locations.data ?? []).map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code} - {location.location_name || location.location_type}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Operator<input value={operatorName} onChange={event => setOperatorName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      {mutation.error && <p className="mt-4 text-sm text-red-700">{mutation.error.message}</p>}
      <button disabled={mutation.isPending || !materialTypeId} className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400">{mutation.isPending ? 'Creating...' : 'Create aliquots'}</button>
    </form>
  )
}
