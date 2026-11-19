// leaflet.heat 0.2.0 ships no types. It adds L.heatLayer to the global Leaflet object (see components/map/SampleMap.tsx).
import 'leaflet'

declare module 'leaflet' {
  type HeatLatLngTuple = [number, number, number]

  interface HeatMapOptions {
    minOpacity?: number
    maxZoom?: number
    max?: number
    radius?: number
    blur?: number
    gradient?: Record<number, string>
  }

  interface HeatLayer extends Layer {
    setLatLngs(latlngs: HeatLatLngTuple[]): this
    setOptions(options: HeatMapOptions): this
  }

  function heatLayer(latlngs: HeatLatLngTuple[], options?: HeatMapOptions): HeatLayer
}

