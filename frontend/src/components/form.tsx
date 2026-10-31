import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Label } from '@/components/ui/label'

// Pieces of LACV's laboratory forms: a titled section with a short explanation, and labelled fields with their errors.

export function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="grid gap-x-6 gap-y-2 border-b px-4 py-4 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <legend className="text-[13px] font-semibold tracking-tight">{title}</legend>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </fieldset>
  )
}

export function Field({ label, htmlFor, optional = false, hint, error, children }: { label: string; htmlFor: string; optional?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={htmlFor} className="text-xs font-medium">{label}{optional && <span className="font-normal text-muted-foreground">optional</span>}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p role="alert" className="flex items-start gap-1 text-xs text-destructive"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{message}</p>
}

export function distinct(values: (string | null | undefined)[]) {
  return [...new Set(values.map(value => (value ?? '').trim()).filter(Boolean))]
}
