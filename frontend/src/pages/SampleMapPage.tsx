import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Focus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '../api'
import { errorClass, PageHeader, Panel, SampleLink } from '../components/common'
import { formatCoordinates, plottableSites } from '../sampleMap'

// Leaflet loads only with this page.
const SampleMap = lazy(() => import('../components/map/SampleMap'))

/** Where geolocated Samples were collected: individual sites and their density. Samples without coordinates are counted, not plotted. */
export function SampleMapPage() {
  const query = useQuery({ queryKey: ['sample-map'], queryFn: api.getSampleMap })
  const sites = useMemo(() => plottableSites(query.data?.sites ?? []), [query.data])
  const [showPoints, setShowPoints] = useState(true)
  const [showDensity, setShowDensity] = useState(true)
  const [fitRequest, setFitRequest] = useState(0)

  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading sample locations…</p>
  if (query.error) return <p role="alert" className={errorClass}>Could not load sample locations. {query.error.message}</p>
  const located = query.data?.located_count ?? 0
  const unlocated = query.data?.unlocated_count ?? 0
  const bySize = [...sites].sort((left, right) => right.count - left.count || left.lat - right.lat)

  return (
    <section className="space-y-3">
      <PageHeader
        title="Sample map"
        description={<>
          <span className="tabular-nums">{located} {located === 1 ? 'sample' : 'samples'} at {sites.length} {sites.length === 1 ? 'site' : 'sites'}</span>
          {unlocated > 0 && <span className="tabular-nums"> · {unlocated} without coordinates (not shown)</span>}
        </>}
        actions={<Button asChild variant="outline" size="sm"><Link to="/samples">Samples list</Link></Button>}
      />
      <Panel
        primary
        title="Collection sites"
        bodyClassName="p-0"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <label className="flex items-center gap-1.5"><Checkbox checked={showPoints} onCheckedChange={checked => setShowPoints(checked === true)} aria-label="Show sample sites" />Sites</label>
            <label className="flex items-center gap-1.5"><Checkbox checked={showDensity} onCheckedChange={checked => setShowDensity(checked === true)} aria-label="Show density heatmap" />Density heatmap</label>
            <Button type="button" variant="ghost" size="sm" className="h-7" disabled={sites.length === 0} onClick={() => setFitRequest(count => count + 1)}><Focus aria-hidden="true" />Zoom to all samples</Button>
          </div>
        }
      >
        {sites.length === 0 && (
          <p role="status" className="border-b px-3 py-2 text-[13px] text-muted-foreground">
            No samples have both a latitude and a longitude yet. Add them on a sample's page (Source and dates) or in a batch workbook's latitude and longitude columns.
          </p>
        )}
        <Suspense fallback={<p className="px-3 py-6 text-sm text-muted-foreground">Loading map…</p>}>
          <SampleMap sites={sites} showPoints={showPoints} showDensity={showDensity} fitRequest={fitRequest} />
        </Suspense>
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          A numbered marker holds several samples recorded at exactly the same point; select it to list them. The heatmap is weighted by the number of samples.
        </p>
      </Panel>

      {sites.length > 0 && (
        <Panel title={<>Sites <span className="font-normal text-muted-foreground tabular-nums">· {sites.length}</span></>} label="Sites" bodyClassName="p-0">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-[13px]" aria-label="Sites and their samples">
              <thead className="sticky top-0 bg-muted text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-3 py-1.5">Coordinates</th>
                  <th scope="col" className="px-3 py-1.5 text-right">Samples</th>
                  <th scope="col" className="px-3 py-1.5">Sample codes</th>
                </tr>
              </thead>
              <tbody>
                {bySize.map(site => (
                  <tr key={`${site.latitude},${site.longitude}`} className="border-t align-top">
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap tabular-nums">{formatCoordinates(site)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{site.count}</td>
                    <td className="px-3 py-1.5"><span className="flex flex-wrap gap-x-2 gap-y-0.5">{site.samples.map(sample => <SampleLink key={sample.sample_id} sample={sample} className="text-xs" />)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  )
}
