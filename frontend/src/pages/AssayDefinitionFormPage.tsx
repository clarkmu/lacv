import { FormEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '../api'
import { inputClass } from '../components/common'
import { distinct, Field, Section } from '../components/form'
import { SuggestInput } from '../components/SuggestInput'
import type { AssayDefinitionDraft, ResultValueType } from '../types'

type FieldDraft = AssayDefinitionDraft['result_fields'][number]
const EMPTY_FIELD: FieldDraft = { analyte: '', result_name: '', unit: '', value_type: 'either' }

/** Create a reusable assay (/assays/new). Its executions are then run from the assay's page. */
export function AssayDefinitionFormPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const definitions = useQuery({ queryKey: ['assay-definitions'], queryFn: () => api.listAssayDefinitions() })
  const [draft, setDraft] = useState<AssayDefinitionDraft>({
    assay_name: '', assay_type: '', target: '', kit: '', instrument: '', typical_volume: '', typical_volume_unit: 'uL', description: '',
    result_fields: [{ ...EMPTY_FIELD }],
  })
  const submitting = useRef(false)
  const set = <K extends keyof AssayDefinitionDraft>(key: K, value: AssayDefinitionDraft[K]) => setDraft(current => ({ ...current, [key]: value }))

  const setField = (index: number, changes: Partial<FieldDraft>) => set('result_fields', draft.result_fields.map((field, i) => (i === index ? { ...field, ...changes } : field)))

  const save = useMutation({
    mutationFn: () => {
      return api.createAssayDefinition({
        ...draft,
        typical_volume: draft.typical_volume || null,
        typical_volume_unit: draft.typical_volume ? draft.typical_volume_unit : null,
        result_fields: draft.result_fields.filter(field => field.result_name.trim()).map(field => ({ ...field, analyte: field.analyte || null, unit: field.unit || null })),
      })
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

  const title = 'New assay'
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/assays">Assays</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>New assay</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-[13px] text-muted-foreground">An assay is the reusable procedure. Who ran it, when, and on which samples is recorded on each execution, from the assay's page.</p>
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

        <Section title="Results reported" description="The result fields each sample in an execution reports, e.g. CT for analyte LACV in cycles. Each becomes a column on the assay's page; numeric ones are averaged.">
          <table className="w-full text-[13px]" aria-label="Result fields">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pb-1 font-medium">Analyte</th><th className="pb-1 font-medium">Result</th><th className="pb-1 font-medium">Unit</th><th className="pb-1 font-medium">Value</th><th className="sr-only">Remove</th></tr>
            </thead>
            <tbody>
              {draft.result_fields.map((field, index) => (
                <tr key={index}>
                  <td className="py-0.5 pr-2"><input aria-label={`Analyte ${index + 1}`} value={field.analyte ?? ''} onChange={event => setField(index, { analyte: event.target.value })} className={`${inputClass} w-full`} placeholder="e.g. LACV" /></td>
                  <td className="py-0.5 pr-2"><input aria-label={`Result name ${index + 1}`} value={field.result_name} onChange={event => setField(index, { result_name: event.target.value })} className={`${inputClass} w-full`} placeholder="e.g. CT" /></td>
                  <td className="py-0.5 pr-2"><input aria-label={`Unit ${index + 1}`} value={field.unit ?? ''} onChange={event => setField(index, { unit: event.target.value })} className={`${inputClass} w-24`} placeholder="e.g. cycles" /></td>
                  <td className="py-0.5 pr-2">
                    <select aria-label={`Value type ${index + 1}`} value={field.value_type} onChange={event => setField(index, { value_type: event.target.value as ResultValueType })} className={inputClass}>
                      <option value="either">number or text</option>
                      <option value="numeric">number</option>
                      <option value="text">text</option>
                    </select>
                  </td>
                  <td className="py-0.5 text-right">
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove result field ${index + 1}`} onClick={() => set('result_fields', draft.result_fields.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button type="button" variant="ghost" size="sm" className="mt-1 text-primary hover:text-primary" onClick={() => set('result_fields', [...draft.result_fields, { ...EMPTY_FIELD }])}><Plus aria-hidden="true" />Add result field</Button>
          {fieldErrors.result_fields && <p role="alert" className="text-xs text-destructive">{fieldErrors.result_fields}</p>}
        </Section>

        <div className="flex flex-wrap items-center justify-end gap-3 bg-muted/40 px-4 py-3">
          {otherError && <p role="alert" className="mr-auto text-xs text-destructive">{otherError}</p>}
          <Button asChild variant="ghost" size="sm"><Link to="/assays">Cancel</Link></Button>
          <Button type="submit" size="sm" disabled={save.isPending}><Save aria-hidden="true" />{save.isPending ? 'Saving…' : 'Create assay'}</Button>
        </div>
      </form>
    </div>
  )
}
