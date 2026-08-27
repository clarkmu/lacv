import { FormEvent, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'

export function NewOffspringPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [sampleCode, setSampleCode] = useState('')
  const [sampleType, setSampleType] = useState('')
  const mutation = useMutation({
    mutationFn: () => api.createOffspring(Number(id), { sample_code: sampleCode, sample_type: sampleType || null }),
    onSuccess: child => navigate(`/sample/${child.sample_id}`),
  })

  function submit(e: FormEvent) { e.preventDefault(); mutation.mutate() }

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Create offspring sample</h1>
      <p className="mt-2 text-sm text-slate-500">Only the parent link is set automatically. No parent values are inherited.</p>
      <label className="mt-6 block text-sm font-medium">Sample code<input required value={sampleCode} onChange={e => setSampleCode(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Sample type<input value={sampleType} onChange={e => setSampleType(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <button disabled={mutation.isPending} className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{mutation.isPending ? 'Creating…' : 'Create sample'}</button>
    </form>
  )
}
