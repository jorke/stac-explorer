import { openCog, renderCogTile, TILE_SIZE } from './cogRaster'
import type { CogDataset } from './cogRaster'

let dataset: CogDataset | undefined
const controllers = new Map<number, AbortController>()
const queue: { id: number; z: number; x: number; y: number }[] = []
let active = 0

function pump() {
  while (active < 3 && queue.length) {
    const job = queue.shift()!
    const controller = controllers.get(job.id)
    if (!controller || !dataset) continue
    active++
    void renderCogTile(dataset, job.z, job.x, job.y, controller.signal)
      .then(async (tile) => {
        controller.signal.throwIfAborted()
        const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
        const context = canvas.getContext('2d')!
        const image = context.createImageData(TILE_SIZE, TILE_SIZE)
        image.data.set(tile.pixels)
        context.putImageData(image, 0, 0)
        const data = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
        if (!controller.signal.aborted) self.postMessage({ id: job.id, data }, { transfer: [data] })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          self.postMessage({
            id: job.id,
            error: error instanceof Error ? error.message : 'Could not read COG tile.',
          })
      })
      .finally(() => {
        controllers.delete(job.id)
        active--
        pump()
      })
  }
}

self.onmessage = async (
  event: MessageEvent<{ type: string; id: number; url: string; z: number; x: number; y: number }>,
) => {
  const message = event.data
  if (message.type === 'open') {
    try {
      dataset = await openCog(message.url)
      self.postMessage({ id: message.id, bounds: dataset.bounds })
    } catch (error) {
      self.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : 'Could not open COG.',
      })
    }
  } else if (message.type === 'cancel') {
    controllers.get(message.id)?.abort()
    const index = queue.findIndex((job) => job.id === message.id)
    if (index >= 0) {
      queue.splice(index, 1)
      controllers.delete(message.id)
    }
  } else if (message.type === 'tile') {
    controllers.set(message.id, new AbortController())
    queue.push(message)
    pump()
  }
}
