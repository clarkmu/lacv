import { Boxes, FlaskConical, Refrigerator, TestTubes, type LucideIcon } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

// Each module owns its list path and its record pages (e.g. /samples and /sample/12), so detail pages keep the module highlighted.
const MODULES: { label: string; to: string; prefixes: string[]; icon: LucideIcon }[] = [
  { label: 'Batches', to: '/batches', prefixes: ['/batches', '/batch/'], icon: Boxes },
  { label: 'Samples', to: '/samples', prefixes: ['/samples', '/sample/'], icon: TestTubes },
  { label: 'Assays', to: '/assays', prefixes: ['/assays', '/assay/'], icon: FlaskConical },
  { label: 'Storage', to: '/storage-locations', prefixes: ['/storage-locations', '/storage-location/'], icon: Refrigerator },
]

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-chrome text-chrome-foreground">
        <div className="mx-auto flex h-11 max-w-screen-2xl items-stretch gap-3 px-4 sm:gap-6 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 self-center rounded-sm" aria-label="LACV home">
            <span aria-hidden="true" className="grid size-6 place-items-center rounded-[5px] bg-primary font-mono text-[10px] font-semibold tracking-tighter text-white ring-1 ring-white/15">LV</span>
            <span className="text-[15px] font-semibold tracking-tight text-white">LACV</span>
            <span className="hidden border-l border-white/15 pl-2.5 text-xs text-chrome-foreground/70 lg:inline">Laboratory Analysis &amp; Collection Vault</span>
          </Link>
          <nav aria-label="Modules" className="flex items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {MODULES.map(({ label, to, prefixes, icon: Icon }) => {
              const isActive = prefixes.some(prefix => pathname.startsWith(prefix))
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                    'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
                    isActive ? 'text-white after:bg-indigo-400' : 'text-chrome-foreground/75 after:bg-transparent hover:text-white hover:after:bg-white/20',
                  )}
                >
                  <Icon aria-hidden="true" className={cn('size-4', isActive ? 'text-indigo-300' : 'opacity-70')} />
                  {label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6"><Outlet /></main>
    </div>
  )
}
