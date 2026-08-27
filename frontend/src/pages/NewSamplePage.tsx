import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export function NewSamplePage() {
  const navigate = useNavigate()
  const batches = useQuery({ queryKey: ['batches'], queryFn: api.listBatches })
  const [sampleCode, setSampleCode] = useState('')
  const [sampleType, setSampleType] = useState('')
  const [batchId, setBatchId] = useState('')
  const [status, setStatus] = useState('expected')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.createSample({
      sample_code: sampleCode,
      sample_type: sampleType || null,
      batch_id: batchId ? Number(batchId) : null,
      status,
      notes: notes || null,
    }),
    onSuccess: sample => navigate(`/sample/${sample.sample_id}`),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Create sample</h1>
      <label className="mt-6 block text-sm font-medium">Sample code<input required value={sampleCode} onChange={event => setSampleCode(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Sample type<input value={sampleType} onChange={event => setSampleType(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Batch<select value={batchId} onChange={event => setBatchId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">No batch</option>{(batches.data ?? []).map(batch => <option key={batch.batch_id} value={batch.batch_id}>{batch.batch_code} - {batch.batch_name}</option>)}</select></label>
      <label className="mt-4 block text-sm font-medium">Status<input required value={status} onChange={event => setStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      {mutation.error && <p className="mt-4 text-sm text-red-700">{mutation.error.message}</p>}
      <button disabled={mutation.isPending} className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{mutation.isPending ? 'Creating...' : 'Create sample'}</button>
    </form>
  )
}
