import { Boxes, ChevronDown, ClipboardList, FlaskConical, Refrigerator, TestTubes, type LucideIcon } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type Module = { label: string; to: string; prefixes: string[]; icon: LucideIcon }

// Each module owns its list path and its record pages (e.g. /samples and /sample/12), so detail pages keep the module highlighted.
const MODULES: Module[] = [
  { label: 'Batches', to: '/batches', prefixes: ['/batches', '/batch/'], icon: Boxes },
  { label: 'Samples', to: '/samples', prefixes: ['/samples', '/sample/'], icon: TestTubes },
  { label: 'Assays', to: '/assays', prefixes: ['/assays'], icon: FlaskConical },
  { label: 'Storage', to: '/storage-locations', prefixes: ['/storage-locations', '/storage-location/'], icon: Refrigerator },
]

/**
 * Shortcuts to results. Results live on each assay's page, so each link opens the Assays list narrowed to one kind of
 * assay (matched on its type, e.g. qPCR or RT-qPCR); there is no separate results page.
 */
export const RESULT_LINKS = [
  { label: 'qPCR results', to: '/assays?type=qPCR' },
  { label: 'Sequencing results', to: '/assays?type=Sequencing' },
]

const navItemClass = (isActive: boolean) => cn(
  'relative flex items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-inset',
  'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
  isActive ? 'text-white after:bg-indigo-400' : 'text-chrome-foreground/75 after:bg-transparent hover:text-white hover:after:bg-white/20',
)

export function Layout() {
  const { pathname, search } = useLocation()
  const viewingResults = pathname === '/assays' && new URLSearchParams(search).has('type')

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
              const isActive = prefixes.some(prefix => pathname.startsWith(prefix)) && !(label === 'Assays' && viewingResults)
              return (
                <Link key={to} to={to} aria-current={isActive ? 'page' : undefined} className={navItemClass(isActive)}>
                  <Icon aria-hidden="true" className={cn('size-4', isActive ? 'text-indigo-300' : 'opacity-70')} />
                  {label}
                </Link>
              )
            })}
            <ResultsMenu active={viewingResults} current={pathname + search} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6"><Outlet /></main>
    </div>
  )
}

/** A menu button in the module bar: Enter, Space or the arrow keys open it, arrows move, Escape closes and returns focus. */
function ResultsMenu({ active, current }: { active: boolean; current: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={navItemClass(active)}>
        <ClipboardList aria-hidden="true" className={cn('size-4', active ? 'text-indigo-300' : 'opacity-70')} />
        Results
        <ChevronDown aria-hidden="true" className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {RESULT_LINKS.map(link => (
          <DropdownMenuItem key={link.to} asChild>
            <Link to={link.to} aria-current={current === link.to ? 'page' : undefined} className="text-[13px]">{link.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/assays" className="text-[13px] text-muted-foreground">All assays</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
