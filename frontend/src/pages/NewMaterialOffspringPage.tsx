import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { MaterialCreateForm, MaterialCreatePayload } from '../components/MaterialCreateForm'

export function NewMaterialOffspringPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const parentQuery = useQuery({ queryKey: ['material', id], queryFn: () => api.getMaterial(id) })
  const samplesQuery = useQuery({ queryKey: ['samples'], queryFn: api.listSamples })
  const materialTypesQuery = useQuery({ queryKey: ['material-types'], queryFn: api.listMaterialTypes })
  const storageLocationsQuery = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })

  const mutation = useMutation({
    mutationFn: (payload: MaterialCreatePayload) => api.createMaterialOffspring(Number(id), payload),
    onSuccess: material => navigate(`/material/${material.material_id}`),
  })

  if (parentQuery.isLoading) return <p>Loading parent material...</p>
  if (!parentQuery.data) return <p>Parent material not found.</p>

  const parent = parentQuery.data
  return (
    <MaterialCreateForm
      title="Create offspring material"
      submitLabel="Create offspring"
      pendingLabel="Creating..."
      samples={samplesQuery.data ?? []}
      materialTypes={materialTypesQuery.data ?? []}
      storageLocations={storageLocationsQuery.data ?? []}
      isPending={mutation.isPending}
      error={mutation.error}
      description="Only the parent material link is set automatically. Enter child values explicitly."
      onSubmit={payload => mutation.mutate(payload)}
      intro={
        <div>
          <div className="text-sm text-slate-500">Parent material</div>
          <Link className="text-blue-700 hover:underline" to={`/material/${parent.material_id}`}>{parent.material_code}</Link>
        </div>
      }
    />
  )
}
