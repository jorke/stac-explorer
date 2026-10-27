import { addProtocol } from 'maplibre-gl'

type Bounds = [number, number, number, number]
interface Reply {
  id: number
  bounds?: Bounds
  data?: ArrayBuffer
  error?: string
}
interface Session {
  worker: Worker
  nextId: number
  pending: Map<
    number,
    { resolve: (value: Reply) => void; reject: (error: Error) => void; cleanup: () => void }
  >
}
const sessions = new Map<string, Session>()
let nextSource = 0

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const session of sessions.values()) {
      session.worker.terminate()
      for (const call of session.pending.values()) {
        call.cleanup()
        call.reject(new DOMException('Reloaded', 'AbortError'))
      }
    }
    sessions.clear()
  })

function rpc(
  session: Session,
  message: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const id = session.nextId++
    const abort = () => {
      session.pending.delete(id)
      session.worker.postMessage({ type: 'cancel', id })
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      session.pending.delete(id)
      session.worker.postMessage({ type: 'cancel', id })
      cleanup()
      reject(new Error('The COG request timed out.'))
    }, 45000)
    const cleanup = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    session.pending.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
    session.worker.postMessage({ ...message, id })
  })
}

// A real MapLibre raster protocol: each XYZ tile reads and reprojects a COG window.
addProtocol('cog', async (request, controller) => {
  const url = new URL(request.url)
  const match = /^\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname)
  const session = sessions.get(url.hostname)
  if (!session || !match) throw new DOMException('COG source was removed.', 'AbortError')
  const [z, x, y] = match.slice(1).map(Number)
  const reply = await rpc(session, { type: 'tile', z, x, y }, controller.signal)
  return { data: reply.data! }
})

export async function createCogSource(url: string, signal: AbortSignal) {
  const id = `r${++nextSource}`
  const worker = new Worker(new URL('./cog.worker.ts', import.meta.url), { type: 'module' })
  const session: Session = { worker, nextId: 0, pending: new Map() }
  sessions.set(id, session)
  const release = () => {
    sessions.delete(id)
    signal.removeEventListener('abort', release)
    worker.terminate()
    for (const call of session.pending.values()) {
      call.cleanup()
      call.reject(new DOMException('COG source removed.', 'AbortError'))
    }
    session.pending.clear()
  }
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const call = session.pending.get(event.data.id)
    if (!call) return
    session.pending.delete(event.data.id)
    call.cleanup()
    if (event.data.error) call.reject(new Error(event.data.error))
    else call.resolve(event.data)
  }
  worker.onerror = () => {
    for (const call of session.pending.values()) {
      call.cleanup()
      call.reject(new Error('The COG reader could not start.'))
    }
    session.pending.clear()
    release()
  }
  signal.addEventListener('abort', release, { once: true })
  try {
    const reply = await rpc(session, { type: 'open', url }, signal)
    return { tiles: [`cog://${id}/{z}/{x}/{y}`], bounds: reply.bounds!, release }
  } catch (error) {
    release()
    throw error
  }
}
