import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { SampleForm } from '../components/SampleForm'
import { formatQuantity } from '../format'
import { SampleLink } from './SamplePage'

export function NewChildSamplePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const parent = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const [takenAmount, setTakenAmount] = useState('')
  const [takenUnit, setTakenUnit] = useState('')
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.createChildSample(Number(id), payload),
    onSuccess: child => { client.invalidateQueries({ queryKey: ['sample'] }); client.invalidateQueries({ queryKey: ['sample-lineage'] }); navigate(`/sample/${child.sample_id}`) },
  })

  if (parent.isLoading) return <p>Loading parent sample…</p>
  if (!parent.data) return <p>Parent sample not found.</p>
  const parentAvailable = parent.data.availability.available_quantity

  return (
    <SampleForm
      title="Create child sample"
      description="Only the parent link is set. Enter the child's own values; nothing is copied from the parent."
      submitLabel="Create child sample"
      defaultStatus="available"
      intro={<p className="mb-1 text-sm text-slate-500">Parent <SampleLink sample={parent.data} />{parentAvailable !== null && <> · {formatQuantity(parentAvailable, parent.data.quantity_unit)} available</>}</p>}
      extraFields={
        <fieldset className="mt-4 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">Taken from parent</legend>
          <label className="text-sm font-medium">Amount<input type="number" step="any" min="0" value={takenAmount} onChange={event => setTakenAmount(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
          <label className="text-sm font-medium">Unit<input value={takenUnit} onChange={event => setTakenUnit(event.target.value)} placeholder={parent.data.quantity_unit ?? ''} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
          <p className="self-end text-xs text-slate-500 sm:pb-1.5">Removed from the parent's available quantity. Leave blank if nothing was taken or it is unknown.</p>
        </fieldset>
      }
      isPending={mutation.isPending}
      error={mutation.error}
      onSubmit={payload => mutation.mutate({
        ...payload,
        quantity_taken_from_parent: takenAmount ? Number(takenAmount) : null,
        quantity_taken_unit: takenUnit.trim() || null,
      })}
    />
  )
}
