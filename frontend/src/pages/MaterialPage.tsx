import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

function formatStorageEventDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

export function MaterialPage() {
  const { id = '' } = useParams()
  const client = useQueryClient()
  const materialQuery = useQuery({ queryKey: ['material', id], queryFn: () => api.getMaterial(id) })
  const samplesQuery = useQuery({ queryKey: ['samples'], queryFn: api.listSamples })
  const locationsQuery = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const [sampleId, setSampleId] = useState('')
  const [storageLocationId, setStorageLocationId] = useState('')
  const [detailsDraft, setDetailsDraft] = useState({
    current_quantity: '',
    quantity_unit: '',
    concentration: '',
    concentration_unit: '',
    status: '',
    is_consumed: false,
    is_disposed: false,
    expiration_date: '',
    notes: '',
  })

  useEffect(() => {
    if (!materialQuery.data) return
    setSampleId(String(materialQuery.data.sample_id))
    setStorageLocationId(String(materialQuery.data.storage_location_id ?? ''))
    setDetailsDraft({
      current_quantity: materialQuery.data.current_quantity ?? '',
      quantity_unit: materialQuery.data.quantity_unit ?? '',
      concentration: materialQuery.data.concentration ?? '',
      concentration_unit: materialQuery.data.concentration_unit ?? '',
      status: materialQuery.data.status,
      is_consumed: materialQuery.data.is_consumed,
      is_disposed: materialQuery.data.is_disposed,
      expiration_date: materialQuery.data.expiration_date ? materialQuery.data.expiration_date.slice(0, 16) : '',
      notes: materialQuery.data.notes ?? '',
    })
  }, [materialQuery.data])

  const updateSample = useMutation({
    mutationFn: () => api.updateMaterial(Number(id), {
      sample_id: Number(sampleId),
    }),
    onSuccess: material => client.setQueryData(['material', id], material),
  })

  const updateStorage = useMutation({
    mutationFn: () => api.updateMaterial(Number(id), {
      storage_location_id: storageLocationId ? Number(storageLocationId) : null,
    }),
    onSuccess: material => client.setQueryData(['material', id], material),
  })

  const updateDetails = useMutation({
    mutationFn: () => api.updateMaterial(Number(id), {
      current_quantity: detailsDraft.current_quantity ? Number(detailsDraft.current_quantity) : null,
      quantity_unit: detailsDraft.quantity_unit || null,
      concentration: detailsDraft.concentration ? Number(detailsDraft.concentration) : null,
      concentration_unit: detailsDraft.concentration_unit || null,
      status: detailsDraft.status,
      is_consumed: detailsDraft.is_consumed,
      is_disposed: detailsDraft.is_disposed,
      expiration_date: detailsDraft.expiration_date || null,
      notes: detailsDraft.notes || null,
    }),
    onSuccess: material => client.setQueryData(['material', id], material),
  })

  if (materialQuery.isLoading) return <p>Loading material...</p>
  if (!materialQuery.data) return <p>Material not found.</p>

  const material = materialQuery.data

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">Material</div>
          <h1 className="text-3xl font-semibold">{material.material_code}</h1>
          <p className="mt-1 text-slate-600">{material.material_type} - {material.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/material/${material.material_id}/offspring/new`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Add child material</Link>
          <Link to={`/material/${material.material_id}/aliquots/new`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Aliquot</Link>
          <Link to={`/material/${material.material_id}/process/new?action=Homogenization`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Homogenize</Link>
          <Link to={`/material/${material.material_id}/process/new?action=RNA extraction`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Perform extraction</Link>
          <Link to={`/material/${material.material_id}/process/new?action=Reverse transcription`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Create cDNA</Link>
          <Link to={`/material/${material.material_id}/process/new?action=Library preparation`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Create sequencing library</Link>
          <Link to={`/material/${material.material_id}/assays/new`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Send to assay</Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <h2 className="mb-3 font-semibold">Material status and quantity</h2>
          <form onSubmit={event => { event.preventDefault(); updateDetails.mutate() }} className="grid gap-3 md:grid-cols-4">
            <label className="text-sm font-medium">Quantity<input type="number" step="any" value={detailsDraft.current_quantity} onChange={event => setDetailsDraft(draft => ({ ...draft, current_quantity: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="text-sm font-medium">Quantity unit<input value={detailsDraft.quantity_unit} onChange={event => setDetailsDraft(draft => ({ ...draft, quantity_unit: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="text-sm font-medium">Concentration<input type="number" step="any" value={detailsDraft.concentration} onChange={event => setDetailsDraft(draft => ({ ...draft, concentration: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="text-sm font-medium">Concentration unit<input value={detailsDraft.concentration_unit} onChange={event => setDetailsDraft(draft => ({ ...draft, concentration_unit: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="text-sm font-medium">Status<input value={detailsDraft.status} onChange={event => setDetailsDraft(draft => ({ ...draft, status: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="text-sm font-medium">Expiration<input type="datetime-local" value={detailsDraft.expiration_date} onChange={event => setDetailsDraft(draft => ({ ...draft, expiration_date: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={detailsDraft.is_consumed} onChange={event => setDetailsDraft(draft => ({ ...draft, is_consumed: event.target.checked }))} />Consumed</label>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={detailsDraft.is_disposed} onChange={event => setDetailsDraft(draft => ({ ...draft, is_disposed: event.target.checked }))} />Disposed</label>
            <label className="text-sm font-medium md:col-span-3">Notes<textarea value={detailsDraft.notes} onChange={event => setDetailsDraft(draft => ({ ...draft, notes: event.target.value }))} className="mt-2 min-h-20 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <div className="self-end"><button disabled={updateDetails.isPending} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:text-slate-400">{updateDetails.isPending ? 'Saving...' : 'Save'}</button></div>
          </form>
          {updateDetails.error && <p className="mt-3 text-sm text-red-700">{updateDetails.error.message}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Sample</h2>
          <Link className="mb-4 inline-block text-blue-700 hover:underline" to={`/sample/${material.sample.sample_id}`}>
            {material.sample.sample_code}
            <span className="text-slate-500"> - {material.sample.sample_type || 'No type'}</span>
          </Link>
          <form onSubmit={event => { event.preventDefault(); updateSample.mutate() }} className="flex gap-2">
            <select required value={sampleId} onChange={event => setSampleId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm">
              {(samplesQuery.data ?? []).map(sample => (
                <option key={sample.sample_id} value={sample.sample_id}>
                  {sample.sample_code} - {sample.sample_type || 'No type'}
                </option>
              ))}
            </select>
            <button disabled={updateSample.isPending || !sampleId} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:text-slate-400">
              {updateSample.isPending ? 'Saving...' : 'Save'}
            </button>
          </form>
          {updateSample.error && <p className="mt-3 text-sm text-red-700">{updateSample.error.message}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Move to storage</h2>
          {material.storage_location ? (
            <Link className="mb-4 inline-block text-blue-700 hover:underline" to={`/storage-location/${material.storage_location.storage_location_id}`}>
              {material.storage_location.location_code}
              <span className="text-slate-500"> - {material.storage_location.location_type}</span>
            </Link>
          ) : (
            <p className="mb-4 text-sm text-slate-500">No storage location assigned.</p>
          )}
          <form onSubmit={event => { event.preventDefault(); updateStorage.mutate() }} className="flex gap-2">
            <select value={storageLocationId} onChange={event => setStorageLocationId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">No location</option>
              {(locationsQuery.data ?? []).map(location => (
                <option key={location.storage_location_id} value={location.storage_location_id}>
                  {location.location_code} - {location.location_type}
                </option>
              ))}
            </select>
            <button disabled={updateStorage.isPending} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:text-slate-400">
              {updateStorage.isPending ? 'Saving...' : 'Save'}
            </button>
          </form>
          {updateStorage.error && <p className="mt-3 text-sm text-red-700">{updateStorage.error.message}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Lineage</h2>
            <Link to={`/material/${material.material_id}/offspring/new`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Create offspring</Link>
          </div>
          {material.parent ? (
            <Link className="text-blue-700 hover:underline" to={`/material/${material.parent.material_id}`}>Parent: {material.parent.material_code}</Link>
          ) : (
            <p className="text-sm text-slate-500">No parent material.</p>
          )}
          <div className="mt-4">
            {material.offspring.map(child => (
              <Link className="block text-blue-700 hover:underline" key={child.material_id} to={`/material/${child.material_id}`}>Child: {child.material_code}</Link>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Process events</h2>
          {material.process_events.length ? material.process_events.map(event => (
            <div className="border-t border-slate-100 py-2 text-sm" key={event.process_event_id}>
              <b>{event.process_code}</b> - {event.process_type} - {event.status}
            </div>
          )) : <p className="text-sm text-slate-500">No process events.</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Assays</h2>
            <Link to={`/material/${material.material_id}/assays/new`} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">Create assay</Link>
          </div>
          {material.assays.length ? material.assays.map(assay => (
            <Link to={`/assay/${assay.assay_id}`} className="block border-t border-slate-100 py-2 text-sm text-blue-700 hover:underline" key={assay.assay_id}>
              <b>{assay.assay_code}</b> - {assay.assay_type} - {assay.qc_status}
            </Link>
          )) : <p className="text-sm text-slate-500">No assays.</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Storage history</h2>
          {material.storage_events.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 py-2 pr-3 font-medium">Storage location</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">From location</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Action</th>
                  <th className="border-b border-slate-200 py-2 pl-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {material.storage_events.map(event => (
                  <tr key={event.storage_event_id}>
                    <td className="border-t border-slate-100 py-2 pr-3">{event.to_location_name || event.to_location_code || 'No location'}</td>
                    <td className="border-t border-slate-100 px-3 py-2">{event.from_location_name || event.from_location_code || '-'}</td>
                    <td className="border-t border-slate-100 px-3 py-2">{event.event_type}</td>
                    <td className="border-t border-slate-100 py-2 pl-3">{formatStorageEventDate(event.event_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-slate-500">No storage events.</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Quantity history</h2>
          {material.quantity_events.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600"><tr><th className="border-b border-slate-200 py-2 pr-3 font-medium">Action</th><th className="border-b border-slate-200 px-3 py-2 font-medium">Change</th><th className="border-b border-slate-200 px-3 py-2 font-medium">Before</th><th className="border-b border-slate-200 px-3 py-2 font-medium">After</th><th className="border-b border-slate-200 py-2 pl-3 font-medium">Date</th></tr></thead>
              <tbody>{material.quantity_events.map(event => <tr key={event.quantity_event_id}><td className="border-t border-slate-100 py-2 pr-3">{event.event_type}</td><td className="border-t border-slate-100 px-3 py-2">{event.quantity_change} {event.quantity_unit}</td><td className="border-t border-slate-100 px-3 py-2">{event.quantity_before ?? '-'}</td><td className="border-t border-slate-100 px-3 py-2">{event.quantity_after ?? '-'}</td><td className="border-t border-slate-100 py-2 pl-3">{formatStorageEventDate(event.event_date)}</td></tr>)}</tbody>
            </table>
          ) : <p className="text-sm text-slate-500">No quantity events.</p>}
        </section>
      </div>
    </section>
  )
}
