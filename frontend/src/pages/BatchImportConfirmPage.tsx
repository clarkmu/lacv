import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { BatchSampleImportRow } from '../types'

type ImportState = {
  samples?: BatchSampleImportRow[]
  fileName?: string
}

const columns: { key: keyof BatchSampleImportRow; label: string; inputMode?: 'numeric' }[] = [
  { key: 'sample_code', label: 'Sample code' },
  { key: 'parent_sample_id', label: 'Parent sample ID', inputMode: 'numeric' },
  { key: 'external_sample_id', label: 'External sample ID' },
  { key: 'sample_type', label: 'Sample type' },
  { key: 'source_type', label: 'Source type' },
  { key: 'source_description', label: 'Source description' },
  { key: 'collection_date', label: 'Collection date' },
  { key: 'received_date', label: 'Received date' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes' },
]

export function BatchImportConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as ImportState
  const [batchName, setBatchName] = useState('')
  const [samples, setSamples] = useState<BatchSampleImportRow[]>(state.samples ?? [])
  const normalizedSamples = useMemo(() => samples.map(sample => ({
    ...sample,
    sample_code: sample.sample_code || '',
    parent_sample_id: sample.parent_sample_id ? Number(sample.parent_sample_id) : null,
    collection_date: sample.collection_date || null,
    received_date: sample.received_date || null,
    status: sample.status || 'expected',
  })), [samples])

  const save = useMutation({
    mutationFn: () => api.createSampleBatch({ batch_name: batchName, samples: normalizedSamples }),
    onSuccess: batch => navigate(`/batch/${batch.batch_id}`),
  })

  function updateCell(rowIndex: number, key: keyof BatchSampleImportRow, value: string) {
    setSamples(current => current.map((sample, index) => {
      if (index !== rowIndex) return sample
      const nextValue = key === 'parent_sample_id' ? (value ? Number(value) : null) : value || null
      return { ...sample, [key]: nextValue }
    }))
  }

  if (!state.samples) {
    return <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="text-2xl font-semibold">Confirm batch import</h1><p className="mt-2 text-sm text-slate-500">Choose an XLSX file from the Batches page before confirming an import.</p><Link className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" to="/batches">Back to batches</Link></section>
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Confirm batch import</h1>
        <p className="mt-1 text-sm text-slate-500">{state.fileName || 'Imported XLSX'} · {samples.length} sample rows</p>
      </div>
      <label className="block max-w-xl text-sm font-medium">Batch Name<input required value={batchName} onChange={event => setBatchName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-semibold">Samples</h2></div>
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full min-w-[1400px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr><th className="px-3 py-2">Row</th>{columns.map(column => <th className="px-3 py-2" key={column.key}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {samples.map((sample, rowIndex) => (
                <tr className="border-t border-slate-100" key={rowIndex}>
                  <td className="px-3 py-2 text-slate-500">{rowIndex + 1}</td>
                  {columns.map(column => <td className="px-3 py-2" key={column.key}><input inputMode={column.inputMode} value={sample[column.key] ?? ''} onChange={event => updateCell(rowIndex, column.key, event.target.value)} className="w-full min-w-32 rounded border border-slate-200 px-2 py-1" /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {save.error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{save.error.message}</p>}
      <button disabled={save.isPending || !batchName.trim() || samples.length === 0} onClick={() => save.mutate()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400">{save.isPending ? 'Saving...' : 'Save batch'}</button>
    </section>
  )
}
