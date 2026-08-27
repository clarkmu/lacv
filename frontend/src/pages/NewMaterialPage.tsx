import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { MaterialCreateForm, MaterialCreatePayload } from '../components/MaterialCreateForm'

export function NewMaterialPage() {
  const navigate = useNavigate()
  const samples = useQuery({ queryKey: ['samples'], queryFn: api.listSamples })
  const materialTypes = useQuery({ queryKey: ['material-types'], queryFn: api.listMaterialTypes })
  const storageLocations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })

  const mutation = useMutation({
    mutationFn: (payload: MaterialCreatePayload) => api.createMaterial(payload),
    onSuccess: material => navigate(`/material/${material.material_id}`),
  })

  return (
    <MaterialCreateForm
      title="Create material"
      submitLabel="Create material"
      pendingLabel="Creating..."
      samples={samples.data ?? []}
      materialTypes={materialTypes.data ?? []}
      storageLocations={storageLocations.data ?? []}
      isPending={mutation.isPending}
      error={mutation.error}
      onSubmit={payload => mutation.mutate(payload)}
    />
  )
}
