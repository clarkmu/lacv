// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { SampleMapPage } from './SampleMapPage'
import { ASHEVILLE, boundsOf, heatMax, heatPoints, initialBounds, PIGEON_FORGE, plottableSites } from '../sampleMap'
import type { SampleMap, SampleSite } from '../types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Leaflet needs a real browser (canvas, layout); the page is tested with a stand-in that records what it was given.
const drawn: { sites: { lat: number; lng: number; count: number }[]; showPoints: boolean; showDensity: boolean }[] = []
vi.mock('../components/map/SampleMap', () => ({
  default: (props: (typeof drawn)[number]) => {
    drawn.push(props)
    return <div data-testid="map">{props.sites.length} sites</div>
  },
}))

const located = (sample_id: number, sample_code: string) => ({ sample_id, sample_code, sample_type: 'Mosquito pool', status: 'received', sample_type_id: 1, subject_code: null, collection_date: '2026-07-01T00:00:00' })
const site = (latitude: string, longitude: string, ...samples: ReturnType<typeof located>[]): SampleSite => ({ latitude, longitude, samples })

let container: HTMLDivElement
let root: Root

async function render(data: SampleMap) {
  drawn.length = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(data))))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><SampleMapPage /></MemoryRouter></QueryClientProvider>))
  for (let attempt = 0; attempt < 50 && !container.querySelector('[data-testid="map"]'); attempt++) await act(() => new Promise(resolve => setTimeout(resolve, 10)))
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

test('plots sites with coordinates, counts the samples without, and links every sample', async () => {
  await render({
    sites: [site('35.600000', '-82.500000', located(1, 'TRAP-A-1'), located(2, 'TRAP-A-2')), site('35.788400', '-83.554300', located(3, 'TRAP-B-1'))],
    located_count: 3, unlocated_count: 40,
  })

  expect(container.textContent).toContain('3 samples at 2 sites')
  expect(container.textContent).toContain('40 without coordinates (not shown)')
  const last = drawn.at(-1)!
  expect(last.sites.map(item => [item.lat, item.lng, item.count])).toEqual([[35.6, -82.5, 2], [35.7884, -83.5543, 1]])
  expect([last.showPoints, last.showDensity]).toEqual([true, true])
  // The site list (largest first) reaches every sample without the map.
  const rows = [...container.querySelectorAll('table[aria-label="Sites and their samples"] tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))
  expect(rows).toEqual([['35.60000, -82.50000', '2', 'TRAP-A-1TRAP-A-2'], ['35.78840, -83.55430', '1', 'TRAP-B-1']])
  expect(container.querySelector('a[href="/sample/3"]')?.textContent).toBe('TRAP-B-1')
})

test('with no geolocated samples the map still opens and says how to add coordinates', async () => {
  await render({ sites: [], located_count: 0, unlocated_count: 12 })

  expect(drawn.at(-1)!.sites).toEqual([])
  expect(container.textContent).toContain('No samples have both a latitude and a longitude yet.')
  expect(container.textContent).toContain('12 without coordinates (not shown)')
  expect(container.querySelector('table[aria-label="Sites and their samples"]')).toBeNull()
  expect([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Zoom to all samples'))?.hasAttribute('disabled')).toBe(true)
})

test('the layers can be switched off and on', async () => {
  await render({ sites: [site('35.6', '-82.5', located(1, 'TRAP-A-1'))], located_count: 1, unlocated_count: 0 })

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show density heatmap"]')!.click())
  expect([drawn.at(-1)!.showPoints, drawn.at(-1)!.showDensity]).toEqual([true, false])
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show sample sites"]')!.click())
  expect([drawn.at(-1)!.showPoints, drawn.at(-1)!.showDensity]).toEqual([false, false])
})

test('the opening view is centred on Asheville and reaches Pigeon Forge', () => {
  const [[south, west], [north, east]] = initialBounds()
  expect((south + north) / 2).toBeCloseTo(ASHEVILLE.latitude, 6)
  expect((west + east) / 2).toBeCloseTo(ASHEVILLE.longitude, 6)
  expect(west).toBeLessThan(PIGEON_FORGE.longitude)
  expect(north).toBeGreaterThan(PIGEON_FORGE.latitude)
})

test('map data: overlapping samples weigh their site, nearby sites stay separate, bad coordinates are skipped', () => {
  const sites = plottableSites([
    site('35.600000', '-82.500000', ...Array.from({ length: 30 }, (_, index) => located(index + 1, `POOL-${index + 1}`))),
    site('35.600010', '-82.500000', located(100, 'NEAR-1')),
    site('35.7', '-82.6', located(101, 'ALONE-1')),
    site('not a number', '-82.6', located(102, 'BROKEN-1')),
    site('95', '-82.6', located(103, 'OFF-GLOBE-1')),
  ])

  expect(sites.map(item => item.count)).toEqual([30, 1, 1])
  expect(heatPoints(sites)).toEqual([[35.6, -82.5, 30], [35.60001, -82.5, 1], [35.7, -82.6, 1]])
  // One very large site is hot, but does not wash out ordinary sites: saturation is set by the 90th percentile.
  expect(heatMax(sites)).toBe(30)
  expect(heatMax(plottableSites(Array.from({ length: 20 }, (_, index) => site(String(35 + index / 100), '-82.5', located(index, `S-${index}`)))))).toBe(1)
  expect(heatMax([])).toBe(1)
  expect(boundsOf(sites)).toEqual([[35.6, -82.6], [35.7, -82.5]])
  expect(boundsOf([])).toBeNull()
})
