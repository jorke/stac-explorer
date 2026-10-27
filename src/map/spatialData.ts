import type { Feature, FeatureCollection } from 'geojson'
import { centroidsOf, featuresOf } from '../util/stac'
import type { Entry } from '../util/stac'

export interface SpatialData {
  footprints: FeatureCollection
  centroids: FeatureCollection
  entriesByKey: Map<string, Entry>
}

interface EntryFeatures {
  footprint?: Feature
  centroid?: Feature
}

function collection(features: Feature[], previous?: FeatureCollection): FeatureCollection {
  if (
    previous?.features.length === features.length &&
    features.every((feature, index) => previous.features[index] === feature)
  ) {
    return previous
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Entries are immutable. Reuse their geometry while item metadata arrives in
 * batches, and let discarded entries leave memory with the WeakMap.
 */
export function createSpatialDataBuilder(): (entries: Entry[]) => SpatialData {
  const cache = new WeakMap<Entry, EntryFeatures>()
  let previous: SpatialData | undefined

  return (entries) => {
    const footprints: Feature[] = []
    const centroids: Feature[] = []
    const entriesByKey = new Map<string, Entry>()

    for (const entry of entries) {
      let features = cache.get(entry)
      if (!features) {
        features = {
          footprint: featuresOf([entry]).features[0],
          centroid: centroidsOf([entry]).features[0],
        }
        cache.set(entry, features)
      }
      if (features.footprint) footprints.push(features.footprint)
      if (features.centroid) centroids.push(features.centroid)
      entriesByKey.set(entry.key, entry)
    }

    previous = {
      footprints: collection(footprints, previous?.footprints),
      centroids: collection(centroids, previous?.centroids),
      entriesByKey,
    }
    return previous
  }
}
