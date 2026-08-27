import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'

export function NewAssayPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const materialQuery = useQuery({ queryKey: ['material', id], queryFn: () => api.getMaterial(id) })
  const [assayInstanceCode, setAssayInstanceCode] = useState('')
  const [assayName, setAssayName] = useState('')
  const [assayType, setAssayType] = useState('')
  const [target, setTarget] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [assayDate, setAssayDate] = useState('')
  const [status, setStatus] = useState('planned')
  const [qcStatus, setQcStatus] = useState('not_reviewed')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.createMaterialAssay(Number(id), {
      assay_instance_code: assayInstanceCode,
      assay_name: assayName || null,
      assay_type: assayType,
      target: target || null,
      operator_name: operatorName || null,
      assay_date: assayDate || null,
      status,
      qc_status: qcStatus,
      notes: notes || null,
    }),
    onSuccess: material => navigate(`/material/${material.material_id}`),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  if (materialQuery.isLoading) return <p>Loading material...</p>
  if (!materialQuery.data) return <p>Material not found.</p>

  const material = materialQuery.data

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <div className="text-sm text-slate-500">Material</div>
        <Link className="text-blue-700 hover:underline" to={`/material/${material.material_id}`}>{material.material_code}</Link>
        <h1 className="mt-3 text-2xl font-semibold">Create assay</h1>
      </div>

      <label className="block text-sm font-medium">Assay code<input required value={assayInstanceCode} onChange={event => setAssayInstanceCode(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Assay type<input required value={assayType} onChange={event => setAssayType(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Assay name<input value={assayName} onChange={event => setAssayName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Target<input value={target} onChange={event => setTarget(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Operator<input value={operatorName} onChange={event => setOperatorName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Assay date<input type="datetime-local" value={assayDate} onChange={event => setAssayDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Status<input required value={status} onChange={event => setStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">QC status<input required value={qcStatus} onChange={event => setQcStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <label className="mt-4 block text-sm font-medium">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>

      {mutation.error && <p className="mt-4 text-sm text-red-700">{mutation.error.message}</p>}
      <button disabled={mutation.isPending} className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{mutation.isPending ? 'Creating...' : 'Create assay'}</button>
    </form>
  )
}
