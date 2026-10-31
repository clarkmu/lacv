import type { ReactNode } from 'react'

// Shared LACV presentation. Class strings work on <button>, <a>, and router <Link> alike.

const buttonBase = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export const buttonClass = {
  primary: `${buttonBase} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700`,
  secondary: `${buttonBase} border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50`,
  quiet: `${buttonBase} text-indigo-700 hover:bg-indigo-50`,
  danger: `${buttonBase} border border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50`,
}

export const inputClass = 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500'

export const linkClass = 'text-indigo-700 hover:text-indigo-900 hover:underline'

export const errorClass = 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

type Tone = 'positive' | 'pending' | 'negative' | 'retired' | 'neutral'

// Muted tones for statuses the app uses today. Anything else renders in the neutral tone, text unchanged.
const STATUS_TONES: Record<string, Tone> = {
  available: 'positive', active: 'positive', completed: 'positive', accepted: 'positive', passed: 'positive', received: 'positive', stored: 'positive',
  expected: 'pending', planned: 'pending', pending: 'pending', in_progress: 'pending', not_reviewed: 'pending', running: 'pending',
  rejected: 'negative', failed: 'negative', cancelled: 'negative', canceled: 'negative',
  consumed: 'retired', disposed: 'retired', inactive: 'retired', depleted: 'retired', archived: 'retired',
}

const TONE_CLASSES: Record<Tone, string> = {
  positive: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  negative: 'bg-red-50 text-red-800 ring-red-600/20',
  retired: 'bg-slate-100 text-slate-500 ring-slate-400/20',
  neutral: 'bg-slate-50 text-slate-700 ring-slate-500/20',
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const tone = STATUS_TONES[status.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral'
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}>{status}</span>
}
