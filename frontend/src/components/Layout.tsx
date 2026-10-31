import { Link, Outlet, useLocation } from 'react-router-dom'

// Each module owns its list path and its record pages (e.g. /samples and /sample/12), so detail pages keep the module highlighted.
const MODULES = [
  { label: 'Batches', to: '/batches', prefixes: ['/batches', '/batch/'] },
  { label: 'Samples', to: '/samples', prefixes: ['/samples', '/sample/'] },
  { label: 'Assays', to: '/assays', prefixes: ['/assays', '/assay/'] },
  { label: 'Storage', to: '/storage-locations', prefixes: ['/storage-locations', '/storage-location/'] },
]

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur">
        <div className="mx-auto flex h-12 max-w-screen-2xl items-stretch gap-4 px-4 sm:gap-8 sm:px-6">
          <Link to="/" className="flex items-center gap-2 self-center rounded" aria-label="LACV home">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded bg-indigo-600 text-[11px] font-bold tracking-tight text-white">LV</span>
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">LACV</span>
            <span className="hidden border-l border-slate-200 pl-2 text-xs text-slate-500 lg:inline">Laboratory Analysis &amp; Collection Vault</span>
          </Link>
          <nav aria-label="Modules" className="-mb-px flex items-stretch gap-1 overflow-x-auto [scrollbar-width:none]">
            {MODULES.map(module => {
              const isActive = module.prefixes.some(prefix => pathname.startsWith(prefix))
              return (
                <Link
                  key={module.to}
                  to={module.to}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors ${isActive ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}
                >
                  {module.label}
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
