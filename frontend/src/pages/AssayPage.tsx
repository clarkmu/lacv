import { FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export function AssayPage() {
  const { id = '' } = useParams()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['assay', id], queryFn: () => api.getAssay(id) })
  const [analyte, setAnalyte] = useState('')
  const [resultName, setResultName] = useState('')
  const [numericValue, setNumericValue] = useState('')
  const [textValue, setTextValue] = useState('')
  const [unit, setUnit] = useState('')
  const [interpretation, setInterpretation] = useState('')
  const [qcStatus, setQcStatus] = useState('not_reviewed')

  const createResult = useMutation({
    mutationFn: () => api.createAssayResult(Number(id), {
      analyte: analyte || null,
      result_name: resultName,
      numeric_value: numericValue ? Number(numericValue) : null,
      text_value: textValue || null,
      unit: unit || null,
      interpretation: interpretation || null,
      qc_status: qcStatus,
    }),
    onSuccess: assay => {
      client.setQueryData(['assay', id], assay)
      setAnalyte('')
      setResultName('')
      setNumericValue('')
      setTextValue('')
      setUnit('')
      setInterpretation('')
      setQcStatus('not_reviewed')
    },
  })

  function submitResult(event: FormEvent) {
    event.preventDefault()
    createResult.mutate()
  }

  if (query.isLoading) return <p>Loading assay...</p>
  if (!query.data) return <p>Assay not found.</p>

  const assay = query.data

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <div className="text-sm text-slate-500">Assay</div>
        <h1 className="text-3xl font-semibold">{assay.assay_code}</h1>
        <p className="mt-1 text-slate-600">{assay.assay_type} - {assay.qc_status}</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">Assay details</h2>
        </div>
        <dl className="grid grid-cols-[180px_1fr] text-sm">
          <dt className="border-b border-slate-100 px-5 py-3 font-medium text-slate-600">Name</dt>
          <dd className="border-b border-slate-100 px-5 py-3">{assay.assay_name}</dd>
          <dt className="border-b border-slate-100 px-5 py-3 font-medium text-slate-600">Material</dt>
          <dd className="border-b border-slate-100 px-5 py-3"><Link className="text-blue-700 hover:underline" to={`/material/${assay.material.material_id}`}>{assay.material.material_code}</Link></dd>
          <dt className="border-b border-slate-100 px-5 py-3 font-medium text-slate-600">Target</dt>
          <dd className="border-b border-slate-100 px-5 py-3">{assay.target || ''}</dd>
          <dt className="border-b border-slate-100 px-5 py-3 font-medium text-slate-600">Status</dt>
          <dd className="border-b border-slate-100 px-5 py-3">{assay.status}</dd>
          <dt className="border-b border-slate-100 px-5 py-3 font-medium text-slate-600">Operator</dt>
          <dd className="border-b border-slate-100 px-5 py-3">{assay.operator_name || ''}</dd>
          <dt className="border-b border-slate-100 px-5 py-3 font-medium text-slate-600">Assay date</dt>
          <dd className="border-b border-slate-100 px-5 py-3">{assay.assay_date || ''}</dd>
          <dt className="px-5 py-3 font-medium text-slate-600">Notes</dt>
          <dd className="px-5 py-3">{assay.notes || ''}</dd>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">Results</h2>
        </div>
        {assay.results.length ? (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3 font-medium">Analyte</th><th className="px-5 py-3 font-medium">Result</th><th className="px-5 py-3 font-medium">Value</th><th className="px-5 py-3 font-medium">Interpretation</th><th className="px-5 py-3 font-medium">QC</th></tr></thead>
            <tbody>{assay.results.map(result => <tr className="border-t border-slate-100" key={result.assay_result_id}><td className="px-5 py-3">{result.analyte || ''}</td><td className="px-5 py-3">{result.result_name}</td><td className="px-5 py-3">{result.numeric_value ?? result.text_value ?? ''} {result.unit || ''}</td><td className="px-5 py-3">{result.interpretation || ''}</td><td className="px-5 py-3">{result.qc_status}</td></tr>)}</tbody>
          </table>
        ) : <p className="px-5 py-4 text-sm text-slate-500">No results recorded.</p>}
      </section>

      <form onSubmit={submitResult} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Add result</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">Analyte<input value={analyte} onChange={event => setAnalyte(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
          <label className="text-sm font-medium">Result name<input required value={resultName} onChange={event => setResultName(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
          <label className="text-sm font-medium">Numeric value<input type="number" step="any" value={numericValue} onChange={event => setNumericValue(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
          <label className="text-sm font-medium">Text value<input value={textValue} onChange={event => setTextValue(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
          <label className="text-sm font-medium">Unit<input value={unit} onChange={event => setUnit(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
          <label className="text-sm font-medium">Interpretation<input value={interpretation} onChange={event => setInterpretation(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
          <label className="text-sm font-medium">QC status<input required value={qcStatus} onChange={event => setQcStatus(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
        </div>
        {createResult.error && <p className="mt-3 text-sm text-red-700">{createResult.error.message}</p>}
        <button disabled={createResult.isPending} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{createResult.isPending ? 'Saving...' : 'Save result'}</button>
      </form>
    </section>
  )
}
