// What the sample map draws, kept apart from Leaflet so it can be tested. The backend groups Samples at identical
// coordinates into sites; nothing here infers or adjusts a location.
import type { SampleSite } from './types'

export const ASHEVILLE = { latitude: 35.5951, longitude: -82.5515 }
export const PIGEON_FORGE = { latitude: 35.7884, longitude: -83.5543 }

/**
 * The opening view: centred on Asheville and wide enough east and west of it to include Pigeon Forge, so the
 * Asheville to Pigeon Forge region is in view. (South-west/north-east corners, for Leaflet's fitBounds.)
 */
export function initialBounds(): [[number, number], [number, number]] {
  const halfWidth = Math.abs(ASHEVILLE.longitude - PIGEON_FORGE.longitude) + 0.1
  const halfHeight = Math.abs(ASHEVILLE.latitude - PIGEON_FORGE.latitude) + 0.15
  return [
    [ASHEVILLE.latitude - halfHeight, ASHEVILLE.longitude - halfWidth],
    [ASHEVILLE.latitude + halfHeight, ASHEVILLE.longitude + halfWidth],
  ]
}

export type PlottedSite = SampleSite & { lat: number; lng: number; count: number }

/** Sites as numbers. A site the API could only give as unreadable text is skipped rather than drawn in the wrong place. */
export function plottableSites(sites: SampleSite[]): PlottedSite[] {
  return sites
    .map(site => ({ ...site, lat: Number(site.latitude), lng: Number(site.longitude), count: site.samples.length }))
    .filter(site => Number.isFinite(site.lat) && Number.isFinite(site.lng) && Math.abs(site.lat) <= 90 && Math.abs(site.lng) <= 180 && site.count > 0)
}

/** The zoom level from which heat points count at full weight; below it leaflet.heat halves them per level. Regional view. */
export const HEAT_FULL_WEIGHT_ZOOM = 8

/** One heat point per site, weighted by how many Samples it holds, so 30 tubes from one trap count 30 times. */
export function heatPoints(sites: PlottedSite[]): [number, number, number][] {
  return sites.map(site => [site.lat, site.lng, site.count])
}

/**
 * The weight at which the heatmap is fully saturated: the 90th percentile of site sizes (at least 1). One very large
 * site then reads as hot without washing every ordinary site out to nothing.
 */
export function heatMax(sites: PlottedSite[]): number {
  if (!sites.length) return 1
  const counts = sites.map(site => site.count).sort((a, b) => a - b)
  return Math.max(1, counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.9))])
}

/** The corners of every plotted site, to zoom to the data. Null when nothing is plotted. */
export function boundsOf(sites: PlottedSite[]): [[number, number], [number, number]] | null {
  if (!sites.length) return null
  const lats = sites.map(site => site.lat)
  const lngs = sites.map(site => site.lng)
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]
}

/** Coordinates as shown to people: 5 decimals is about a metre. */
export function formatCoordinates(site: { lat: number; lng: number }) {
  return `${site.lat.toFixed(5)}, ${site.lng.toFixed(5)}`
}
