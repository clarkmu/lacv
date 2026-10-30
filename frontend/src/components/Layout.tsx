import { NavLink, Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-4">
          <div className="text-lg font-semibold tracking-tight">LACV</div>
          <nav className="flex gap-5 text-sm">
            <NavLink to="/batches" className="text-slate-700 hover:text-slate-950">Batches</NavLink>
            <NavLink to="/samples" className="text-slate-700 hover:text-slate-950">Samples</NavLink>
            <NavLink to="/assays" className="text-slate-700 hover:text-slate-950">Assays</NavLink>
            <NavLink to="/storage-locations" className="text-slate-700 hover:text-slate-950">Storage</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-7"><Outlet /></main>
    </div>
  )
}
