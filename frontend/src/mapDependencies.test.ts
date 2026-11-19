// @vitest-environment jsdom
// The sample map's packages: declared exactly, locked, and loadable the way components/map/SampleMap.tsx loads them.
import { expect, test } from 'vitest'
import lock from '../package-lock.json'
import pkg from '../package.json'

test('leaflet, leaflet.heat and the Leaflet types are declared with exact versions and are in the lockfile', () => {
  expect(pkg.dependencies.leaflet).toBe('1.9.4')
  expect((pkg.dependencies as Record<string, string>)['leaflet.heat']).toBe('0.2.0')
  expect((pkg.devDependencies as Record<string, string>)['@types/leaflet']).toBe('1.9.22')
  expect((lock.packages as Record<string, { version: string }>)['node_modules/leaflet'].version).toBe('1.9.4')
  expect((lock.packages as Record<string, { version: string }>)['node_modules/leaflet.heat'].version).toBe('0.2.0')
  expect((lock.packages as Record<string, { version: string }>)['node_modules/@types/leaflet'].version).toBe('1.9.22')
})

test('leaflet resolves, and leaflet.heat registers heatLayer once Leaflet is global', async () => {
  const L = (await import('leaflet')).default
  expect(typeof L.map).toBe('function')
  ;(window as unknown as { L: typeof L }).L = L
  await import('leaflet.heat')
  expect(typeof L.heatLayer).toBe('function')
})
