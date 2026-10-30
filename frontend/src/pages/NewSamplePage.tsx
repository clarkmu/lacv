import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { SampleForm } from '../components/SampleForm'

export function NewSamplePage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: api.createSample,
    onSuccess: sample => { client.invalidateQueries({ queryKey: ['samples'] }); navigate(`/sample/${sample.sample_id}`) },
  })

  return (
    <SampleForm
      title="Create root sample"
      description="An original sample as received. Derived samples are created from their parent's page."
      submitLabel="Create sample"
      defaultStatus="expected"
      allowBatch
      isPending={mutation.isPending}
      error={mutation.error}
      onSubmit={payload => mutation.mutate(payload)}
    />
  )
}
