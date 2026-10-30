import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { SampleForm } from '../components/SampleForm'
import { SampleLink } from './SamplePage'

export function NewChildSamplePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const parent = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.createChildSample(Number(id), payload),
    onSuccess: child => { client.invalidateQueries({ queryKey: ['sample'] }); client.invalidateQueries({ queryKey: ['sample-lineage'] }); navigate(`/sample/${child.sample_id}`) },
  })

  if (parent.isLoading) return <p>Loading parent sample…</p>
  if (!parent.data) return <p>Parent sample not found.</p>

  return (
    <SampleForm
      title="Create child sample"
      description="Only the parent link is set. Enter the child's own values; nothing is copied from the parent."
      submitLabel="Create child sample"
      defaultStatus="available"
      intro={<p className="mb-1 text-sm text-slate-500">Parent <SampleLink sample={parent.data} /></p>}
      isPending={mutation.isPending}
      error={mutation.error}
      onSubmit={payload => mutation.mutate(payload)}
    />
  )
}
