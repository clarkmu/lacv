import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'

export function NewStorageLocationPage() {
  const navigate = useNavigate()
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  // Opened from a location's "Add location inside" with ?parent=<id>.
  const [searchParams] = useSearchParams()
  const [parentLocationId, setParentLocationId] = useState(searchParams.get('parent') ?? '')
  const [locationCode, setLocationCode] = useState('')
  const [locationType, setLocationType] = useState('')
  const [locationName, setLocationName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)

  const mutation = useMutation({
    mutationFn: () => api.createStorageLocation({
      parent_location_id: parentLocationId ? Number(parentLocationId) : null,
      location_code: locationCode,
      location_type: locationType,
      location_name: locationName || null,
      description: description || null,
      is_active: isActive,
    }),
    onSuccess: location => navigate(`/storage-location/${location.storage_location_id}`),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Create storage location</h1>
      <label className="mt-6 block text-sm font-medium">Parent location<select value={parentLocationId} onChange={event => setParentLocationId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">No parent</option>{(locations.data ?? []).map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code} - {location.location_type}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Code<input required value={locationCode} onChange={event => setLocationCode(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Type<input required value={locationType} onChange={event => setLocationType(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Name<input value={locationName} onChange={event => setLocationName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Description<textarea value={description} onChange={event => setDescription(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={isActive} onChange={event => setIsActive(event.target.checked)} /> Active</label>
      {mutation.error && <p className="mt-4 text-sm text-red-700">{mutation.error.message}</p>}
      <button disabled={mutation.isPending} className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{mutation.isPending ? 'Creating...' : 'Create location'}</button>
    </form>
  )
}
