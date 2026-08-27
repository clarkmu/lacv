import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { ListTable } from '../components/ListTable'

export function StorageLocationsPage() {
  const query = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Storage locations</h1><p className="mt-1 text-sm text-slate-500">Freezers, racks, boxes, and positions.</p></div>
        <Link to="/storage-locations/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create new location</Link>
      </div>
      {query.isLoading ? <p>Loading storage locations…</p> : <ListTable
        rows={query.data ?? []}
        searchPlaceholder="Search storage locations by name, code, type, or active state"
        getRowKey={location => location.storage_location_id}
        emptyMessage="No storage locations match your search."
        columns={[
          { key: 'location_code', label: 'Code', value: location => location.location_code, render: location => <Link className="font-medium text-blue-700 hover:underline" to={`/storage-location/${location.storage_location_id}`}>{location.location_code}</Link> },
          { key: 'location_type', label: 'Type', value: location => location.location_type },
          { key: 'location_name', label: 'Name', value: location => location.location_name },
          { key: 'is_active', label: 'Active', value: location => location.is_active },
        ]}
      />}
    </section>
  )
}
