import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useNavigate } from 'react-router-dom'
import { boundsOf, formatCoordinates, HEAT_FULL_WEIGHT_ZOOM, heatMax, heatPoints, initialBounds, type PlottedSite } from '../../sampleMap'

// OpenStreetMap's standard tiles: open data, no account or key. For heavy use, point this at the lab's own tile server.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// leaflet.heat is a plain script that extends the global L, so L must be global before it loads.
let heatPlugin: Promise<unknown> | null = null
function loadHeatPlugin() {
  ;(window as unknown as { L: typeof L }).L = L
  heatPlugin ??= import('leaflet.heat')
  return heatPlugin
}

/**
 * The Leaflet map: one keyboard-focusable marker per site (its sample count shown when there is more than one), whose
 * popup links to each Sample, and a density heatmap weighted by sample count. Opens over Asheville; pan and zoom freely.
 */
export default function SampleMap({ sites, showPoints, showDensity, fitRequest }: {
  sites: PlottedSite[]
  showPoints: boolean
  showDensity: boolean
  /** Changes when the user asks to zoom to every plotted sample. */
  fitRequest: number
}) {
  const navigate = useNavigate()
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const points = useRef<L.LayerGroup | null>(null)
  const density = useRef<L.Layer | null>(null)

  useEffect(() => {
    if (!container.current) return
    // Whole zoom levels: fractional zoom scales tiles and leaves faint seams between them.
    const created = L.map(container.current, { worldCopyJump: true })
    created.fitBounds(initialBounds())
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(created)
    L.control.scale({ imperial: true, metric: true }).addTo(created)
    map.current = created
    return () => {
      created.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const current = map.current
    if (!current) return
    points.current?.remove()
    points.current = null
    if (!showPoints) return
    const group = L.layerGroup(sites.map(site => siteMarker(site, href => navigate(href))))
    group.addTo(current)
    points.current = group
  }, [sites, showPoints, navigate])

  useEffect(() => {
    let cancelled = false
    density.current?.remove()
    density.current = null
    if (!showDensity || sites.length === 0) return
    loadHeatPlugin().then(() => {
      if (cancelled || !map.current) return
      // leaflet.heat divides every weight by 2^(maxZoom - zoom). Full weight from the regional view inwards, so the
      // view the page opens on (about zoom 8) shows real differences in density instead of uniformly faint blue.
      density.current = L.heatLayer(heatPoints(sites), { radius: 28, blur: 22, maxZoom: HEAT_FULL_WEIGHT_ZOOM, max: heatMax(sites), minOpacity: 0.25 }).addTo(map.current)
    })
    return () => { cancelled = true }
  }, [sites, showDensity])

  useEffect(() => {
    const bounds = boundsOf(sites)
    if (fitRequest > 0 && bounds && map.current) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [fitRequest, sites])

  return <div ref={container} role="region" aria-label="Map of sample collection sites" className="h-[calc(100vh-17rem)] min-h-96 w-full" />
}

function siteMarker(site: PlottedSite, open: (href: string) => void) {
  const multiple = site.count > 1
  const icon = L.divIcon({
    className: '',
    html: `<span class="lacv-site${multiple ? ' lacv-site-multiple' : ''}">${multiple ? site.count : ''}</span>`,
    iconSize: multiple ? [24, 24] : [12, 12],
  })
  const title = `${multiple ? `${site.count} samples` : site.samples[0].sample_code} at ${formatCoordinates(site)}`
  const marker = L.marker([site.lat, site.lng], { icon, title, alt: title, keyboard: true, riseOnHover: true })
  marker.bindPopup(() => popupContent(site, open), { maxWidth: 320 })
  return marker
}

/** Built from DOM nodes (codes are text, never HTML); links navigate inside the app. */
function popupContent(site: PlottedSite, open: (href: string) => void) {
  const root = document.createElement('div')
  root.className = 'lacv-site-popup'
  const heading = document.createElement('p')
  heading.className = 'lacv-site-popup-heading'
  heading.textContent = `${site.count} ${site.count === 1 ? 'sample' : 'samples'} · ${formatCoordinates(site)}`
  root.append(heading)
  const list = document.createElement('ul')
  for (const sample of site.samples.slice(0, 25)) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = `/sample/${sample.sample_id}`
    link.textContent = sample.sample_code
    link.addEventListener('click', event => { event.preventDefault(); open(link.getAttribute('href')!) })
    const detail = document.createElement('span')
    detail.textContent = [sample.sample_type, sample.collection_date?.slice(0, 10)].filter(Boolean).join(' · ')
    item.append(link, ' ', detail)
    list.append(item)
  }
  root.append(list)
  if (site.count > 25) {
    const more = document.createElement('p')
    more.textContent = `and ${site.count - 25} more; see the site list below the map.`
    root.append(more)
  }
  return root
}
