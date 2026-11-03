import { FormEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
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

/** Create a reusable assay (/assays/new). Its executions are then run from the assay's page. */
export function AssayDefinitionFormPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const definitions = useQuery({ queryKey: ['assay-definitions'], queryFn: () => api.listAssayDefinitions() })
  const [draft, setDraft] = useState<AssayDefinitionDraft>({
    assay_name: '', assay_type: '', target: '', kit: '', instrument: '', typical_volume: '', typical_volume_unit: 'uL', description: '',
    result_name: '', result_unit: '', result_value_type: 'either',
  })
  const submitting = useRef(false)
  const set = <K extends keyof AssayDefinitionDraft>(key: K, value: AssayDefinitionDraft[K]) => setDraft(current => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      return api.createAssayDefinition({
        ...draft,
        typical_volume: draft.typical_volume || null,
        typical_volume_unit: draft.typical_volume ? draft.typical_volume_unit : null,
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

        <Section title="Result" description="The one result each sample in an execution reports, e.g. LACV CT in cycles. Results are entered on the assay's page.">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_12rem]">
            <Field label="Result name" htmlFor="definition-result-name" optional>
              <Input id="definition-result-name" value={draft.result_name ?? ''} onChange={event => set('result_name', event.target.value)} placeholder="e.g. LACV CT" className="h-8 text-[13px]" />
            </Field>
            <Field label="Unit" htmlFor="definition-result-unit" optional>
              <Input id="definition-result-unit" value={draft.result_unit ?? ''} onChange={event => set('result_unit', event.target.value)} placeholder="e.g. cycles" className="h-8 text-[13px]" />
            </Field>
            <Field label="Value" htmlFor="definition-result-type" hint="Only numbers are averaged.">
              <select id="definition-result-type" value={draft.result_value_type} onChange={event => set('result_value_type', event.target.value as ResultValueType)} className={`${inputClass} w-full text-[13px]`}>
                <option value="either">number or text</option>
                <option value="numeric">number</option>
                <option value="text">text</option>
              </select>
            </Field>
          </div>
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
