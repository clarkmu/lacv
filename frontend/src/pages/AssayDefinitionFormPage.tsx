import { FormEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '../api'
import { inputClass } from '../components/common'
import { distinct, Field, Section } from '../components/form'
import { SuggestInput } from '../components/SuggestInput'
import type { AssayDefinitionDetail, AssayDefinitionDraft, ExpectedResult } from '../types'

const EMPTY_RESULT: ExpectedResult = { analyte: null, result_name: '', unit: null, value_type: 'either' }

/** Create a reusable assay (/assays/new) or edit one (/assays/:id/edit). */
export function AssayDefinitionFormPage() {
  const { id } = useParams()
  const existing = useQuery({ queryKey: ['assay-definition', id], queryFn: () => api.getAssayDefinition(id!), enabled: Boolean(id) })
  if (id && existing.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading assay…</p>
  if (id && !existing.data) return <p className="py-6 text-sm text-muted-foreground">Assay not found.</p>
  return <AssayDefinitionForm key={id ?? 'new'} existing={existing.data} />
}

function AssayDefinitionForm({ existing }: { existing?: AssayDefinitionDetail }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const definitions = useQuery({ queryKey: ['assay-definitions'], queryFn: () => api.listAssayDefinitions() })
  const [draft, setDraft] = useState<AssayDefinitionDraft>(() => ({
    assay_name: existing?.assay_name ?? '',
    assay_type: existing?.assay_type ?? '',
    target: existing?.target ?? '',
    kit: existing?.kit ?? '',
    instrument: existing?.instrument ?? '',
    typical_volume: existing?.typical_volume ? String(Number(existing.typical_volume)) : '',
    typical_volume_unit: existing?.typical_volume_unit ?? 'uL',
    description: existing?.description ?? '',
    expected_results: existing?.expected_results.length ? existing.expected_results : [{ ...EMPTY_RESULT }],
  }))
  const submitting = useRef(false)
  const set = <K extends keyof AssayDefinitionDraft>(key: K, value: AssayDefinitionDraft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const setResult = (index: number, changes: Partial<ExpectedResult>) => set('expected_results', draft.expected_results.map((row, i) => (i === index ? { ...row, ...changes } : row)))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...draft,
        typical_volume: draft.typical_volume || null,
        typical_volume_unit: draft.typical_volume ? draft.typical_volume_unit : null,
        expected_results: draft.expected_results.filter(row => row.result_name.trim()),
      }
      return existing ? api.updateAssayDefinition(existing.assay_definition_id, payload) : api.createAssayDefinition(payload)
    },
    onSuccess: definition => {
      client.invalidateQueries({ queryKey: ['assay-definitions'] })
      client.setQueryData(['assay-definition', String(definition.assay_definition_id)], definition)
      navigate(`/assays/${definition.assay_definition_id}`)
    },
    onSettled: () => { submitting.current = false },
  })
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  const otherError = save.error && Object.keys(fieldErrors).length === 0 ? save.error.message : null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    save.mutate()
  }

  const title = existing ? `Edit ${existing.assay_name}` : 'New assay'
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/assays">Assays</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            {existing && <><BreadcrumbItem><BreadcrumbLink asChild><Link to={`/assays/${existing.assay_definition_id}`}>{existing.assay_name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
            <BreadcrumbItem><BreadcrumbPage>{existing ? 'Edit' : 'New assay'}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-[13px] text-muted-foreground">An assay is the reusable procedure. Who ran it, when, and on which Sample is recorded on each execution, from the Sample's page.</p>
      </header>

      <form onSubmit={submit} aria-label={title} className="rounded-md border bg-card shadow-xs">
        <Section title="Assay" description="How the lab refers to it, the method, and what it detects.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="definition-name" error={fieldErrors.assay_name}>
              <Input id="definition-name" required value={draft.assay_name} onChange={event => set('assay_name', event.target.value)} aria-invalid={Boolean(fieldErrors.assay_name) || undefined} placeholder="e.g. LACV qPCR (SYBR Green)" className="h-8 text-[13px]" />
            </Field>
            <Field label="Type" htmlFor="definition-type" hint="The method, e.g. qPCR, Serology." error={fieldErrors.assay_type}>
              <SuggestInput id="definition-type" value={draft.assay_type} onChange={value => set('assay_type', value)} suggestions={distinct((definitions.data ?? []).map(definition => definition.assay_type))} suggestionsLabel="Types in use" invalid={Boolean(fieldErrors.assay_type)} />
            </Field>
            <Field label="Target" htmlFor="definition-target" optional>
              <SuggestInput id="definition-target" value={draft.target ?? ''} onChange={value => set('target', value)} suggestions={distinct((definitions.data ?? []).map(definition => definition.target))} suggestionsLabel="Targets in use" placeholder="e.g. LACV" />
            </Field>
          </div>
        </Section>

        <Section title="Method" description="Kit, instrument, and the Sample volume one execution usually takes. Each execution still records its own volume.">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem]">
            <Field label="Kit" htmlFor="definition-kit" optional>
              <Input id="definition-kit" value={draft.kit ?? ''} onChange={event => set('kit', event.target.value)} className="h-8 text-[13px]" />
            </Field>
            <Field label="Instrument" htmlFor="definition-instrument" optional>
              <Input id="definition-instrument" value={draft.instrument ?? ''} onChange={event => set('instrument', event.target.value)} className="h-8 text-[13px]" />
            </Field>
            <Field label="Typical volume" htmlFor="definition-volume" optional error={fieldErrors.typical_volume ?? fieldErrors.typical_volume_unit}>
              <div className="flex">
                <Input id="definition-volume" type="number" min="0" step="any" value={draft.typical_volume ?? ''} onChange={event => set('typical_volume', event.target.value)} className="h-8 rounded-r-none text-right text-[13px] tabular-nums" />
                <Input aria-label="Typical volume unit" value={draft.typical_volume_unit ?? ''} onChange={event => set('typical_volume_unit', event.target.value)} className="h-8 w-16 rounded-l-none border-l-0 text-[13px]" />
              </div>
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Procedure notes" htmlFor="definition-description" optional>
              <Textarea id="definition-description" value={draft.description ?? ''} onChange={event => set('description', event.target.value)} className="min-h-16 text-[13px]" placeholder="Cycling conditions, cut-offs, how to report a negative…" />
            </Field>
          </div>
        </Section>

        <Section title="Results reported" description="What one execution reports, e.g. a CT for analyte LACV. These lay out result entry; an execution can still add others.">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pb-1 font-medium">Analyte</th><th className="pb-1 font-medium">Result</th><th className="pb-1 font-medium">Unit</th><th className="pb-1 font-medium">Value</th><th className="sr-only">Remove</th></tr>
            </thead>
            <tbody>
              {draft.expected_results.map((row, index) => (
                <tr key={index}>
                  <td className="py-0.5 pr-2"><input aria-label={`Analyte ${index + 1}`} value={row.analyte ?? ''} onChange={event => setResult(index, { analyte: event.target.value })} className={`${inputClass} w-full`} placeholder="e.g. LACV" /></td>
                  <td className="py-0.5 pr-2"><input aria-label={`Result name ${index + 1}`} value={row.result_name} onChange={event => setResult(index, { result_name: event.target.value })} className={`${inputClass} w-full`} placeholder="e.g. CT" /></td>
                  <td className="py-0.5 pr-2"><input aria-label={`Unit ${index + 1}`} value={row.unit ?? ''} onChange={event => setResult(index, { unit: event.target.value })} className={`${inputClass} w-24`} /></td>
                  <td className="py-0.5 pr-2">
                    <select aria-label={`Value type ${index + 1}`} value={row.value_type} onChange={event => setResult(index, { value_type: event.target.value as ExpectedResult['value_type'] })} className={inputClass}>
                      <option value="either">number or text</option>
                      <option value="numeric">number</option>
                      <option value="text">text</option>
                    </select>
                  </td>
                  <td className="py-0.5 text-right">
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove result ${index + 1}`} onClick={() => set('expected_results', draft.expected_results.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button type="button" variant="ghost" size="sm" className="mt-1 text-primary hover:text-primary" onClick={() => set('expected_results', [...draft.expected_results, { ...EMPTY_RESULT }])}><Plus aria-hidden="true" />Add result</Button>
        </Section>

        <div className="flex flex-wrap items-center justify-end gap-3 bg-muted/40 px-4 py-3">
          {otherError && <p role="alert" className="mr-auto text-xs text-destructive">{otherError}</p>}
          <Button asChild variant="ghost" size="sm"><Link to={existing ? `/assays/${existing.assay_definition_id}` : '/assays'}>Cancel</Link></Button>
          <Button type="submit" size="sm" disabled={save.isPending}><Save aria-hidden="true" />{save.isPending ? 'Saving…' : existing ? 'Save assay' : 'Create assay'}</Button>
        </div>
      </form>
    </div>
  )
}
