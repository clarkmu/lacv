import { FormEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { buttonClass, errorClass, inputClass, Panel, StatusBadge } from '../components/common'
import { formatDateTime, formatQuantity } from '../format'
import { SampleLink } from '../components/common'

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

  const updateQc = useMutation({
    mutationFn: (qc_status: string) => api.updateAssay(Number(id), { qc_status }),
    onSuccess: assay => client.setQueryData(['assay', id], assay),
  })
  const [outputCode, setOutputCode] = useState('')
  const createOutput = useMutation({
    mutationFn: () => api.createAssayOutputSample(Number(id), { sample_code: outputCode }),
    onSuccess: assay => { client.setQueryData(['assay', id], assay); setOutputCode('') },
  })

  function submitResult(event: FormEvent) {
    event.preventDefault()
    createResult.mutate()
  }

  if (query.isLoading) return <p className="py-6 text-sm text-slate-500">Loading assay…</p>
  if (!query.data) return <p className="py-6 text-sm text-slate-500">Assay not found.</p>

  const assay = query.data
  const fieldClass = `${inputClass} mt-1 w-full`

  return (
    <div className="space-y-4">
      <header>
        <div className="text-xs tracking-wide text-slate-500 uppercase">Assay</div>
        <h1 className="font-mono text-2xl font-semibold text-slate-900">{assay.assay_code}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span className="font-medium text-slate-900">{assay.assay_name}</span>
          <span>{assay.assay_type}</span>
          <span>Sample <SampleLink sample={assay.sample} /></span>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <Panel title="Assay details">
          {/* Follows the assay workflow: name, date, who performed it, then the details. */}
          <dl className="grid gap-x-6 text-sm sm:grid-cols-2">
            <Detail label="Assay name">{assay.assay_name}</Detail>
            <Detail label="Date of assay">{formatDateTime(assay.assay_date)}</Detail>
            <Detail label="Performed by">{assay.operator_name || ''}</Detail>
            <Detail label="Sample assayed"><SampleLink sample={assay.sample} /></Detail>
            <Detail label="Volume used">{assay.volume_used !== null ? <span className="tabular-nums">{formatQuantity(assay.volume_used, assay.volume_unit)}</span> : <span className="text-muted-foreground">Not recorded</span>}</Detail>
            <Detail label="Assay type">{assay.assay_type}</Detail>
            <Detail label="Target">{assay.target || ''}</Detail>
            <Detail label="Notes" wide>{assay.notes ? <span className="whitespace-pre-wrap">{assay.notes}</span> : ''}</Detail>
          </dl>
        </Panel>

        <Panel title="Status">
          <dl className="text-sm">
            <Detail label="Status"><StatusBadge status={assay.status} /></Detail>
            <div className="grid grid-cols-[7rem_1fr] items-center gap-2 border-b border-slate-100 py-1.5">
              <dt className="text-slate-500"><label htmlFor="assay-qc">QC status</label></dt>
              <dd>
                <select id="assay-qc" value={assay.qc_status} disabled={updateQc.isPending} onChange={event => updateQc.mutate(event.target.value)} className={`${inputClass} py-1`}>
                  {Array.from(new Set(['not_reviewed', 'accepted', 'rejected', assay.qc_status])).map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </dd>
            </div>
            <Detail label="Results"><span className="tabular-nums">{assay.results.length}</span></Detail>
            <Detail label="Derived samples"><span className="tabular-nums">{assay.output_samples.length}</span></Detail>
            <Detail label="Files"><span className="tabular-nums">{assay.data_files.length}</span></Detail>
          </dl>
          {updateQc.error && <p role="alert" className={`${errorClass} mt-2`}>{updateQc.error.message}</p>}
        </Panel>
      </div>

      <Panel title="Results">
        {assay.results.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-slate-500 uppercase">
                <tr>{['Analyte', 'Result', 'Value', 'Interpretation', 'QC'].map(label => <th key={label} className={`border-b border-slate-200 px-2 py-1 font-medium ${label === 'Value' ? 'text-right' : ''}`}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {assay.results.map(result => (
                  <tr key={result.assay_result_id} className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-2 py-1.5">{result.analyte || ''}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-slate-900">{result.result_name}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums">{result.numeric_value !== null ? formatQuantity(result.numeric_value, result.unit) : `${result.text_value ?? ''}${result.unit ? ` ${result.unit}` : ''}`}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5">{result.interpretation || ''}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><StatusBadge status={result.qc_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-500">No results recorded.</p>}
      </Panel>

      <Panel title="Derived samples produced by this assay">
        {assay.output_samples.length ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{assay.output_samples.map(sample => <SampleLink key={sample.sample_id} sample={sample} />)}</div> : <p className="text-sm text-slate-500">None.</p>}
        <form onSubmit={event => { event.preventDefault(); createOutput.mutate() }} className="mt-3 flex flex-wrap gap-2">
          <input required value={outputCode} onChange={event => setOutputCode(event.target.value)} aria-label="New derived sample code" placeholder="New derived sample code" className={`${inputClass} w-64`} />
          <button disabled={createOutput.isPending} className={buttonClass.secondary}>Add derived sample</button>
        </form>
        {createOutput.error && <p role="alert" className={`${errorClass} mt-2`}>{createOutput.error.message}</p>}
      </Panel>

      {assay.data_files.length > 0 && (
        <Panel title="Files">
          <ul className="space-y-0.5 text-sm">{assay.data_files.map(file => <li key={file.data_file_id}>{file.file_name} <span className="text-slate-500">· {file.file_type} · <code className="text-xs">{file.file_location}</code></span></li>)}</ul>
        </Panel>
      )}

      <Panel title="Add result">
        <form onSubmit={submitResult}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium">Analyte<input value={analyte} onChange={event => setAnalyte(event.target.value)} className={fieldClass} /></label>
            <label className="text-sm font-medium">Result name<input required value={resultName} onChange={event => setResultName(event.target.value)} className={fieldClass} /></label>
            <label className="text-sm font-medium">Numeric value<input type="number" step="any" value={numericValue} onChange={event => setNumericValue(event.target.value)} className={fieldClass} /></label>
            <label className="text-sm font-medium">Text value<input value={textValue} onChange={event => setTextValue(event.target.value)} className={fieldClass} /></label>
            <label className="text-sm font-medium">Unit<input value={unit} onChange={event => setUnit(event.target.value)} className={fieldClass} /></label>
            <label className="text-sm font-medium">Interpretation<input value={interpretation} onChange={event => setInterpretation(event.target.value)} className={fieldClass} /></label>
            <label className="text-sm font-medium">QC status<input required value={qcStatus} onChange={event => setQcStatus(event.target.value)} className={fieldClass} /></label>
          </div>
          {createResult.error && <p role="alert" className={`${errorClass} mt-3`}>{createResult.error.message}</p>}
          <button disabled={createResult.isPending} className={`${buttonClass.primary} mt-4`}>{createResult.isPending ? 'Saving…' : 'Save result'}</button>
        </form>
      </Panel>
    </div>
  )
}

function Detail({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-[7rem_1fr] items-baseline gap-2 border-b border-slate-100 py-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-900">{children}</dd>
    </div>
  )
}
