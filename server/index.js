import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import {
  HttpError,
  addSong,
  checkPin,
  clearGuestSongs,
  findGuestByToken,
  getPublicState,
  markPlaying,
  moveGuest,
  playbackEnded,
  playbackSkip,
  playbackStart,
  registerGuest,
  removeGuest,
  removeSong,
  setNotifier,
  updateSettings
} from './store.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const port = Number(process.env.PORT) || 8082

const sessions = new Map()
let pinFailures = 0
let pinLockedUntil = 0

const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '32kb' }))

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expires = sessions.get(token)
  if (!token || !expires || expires < Date.now()) {
    sessions.delete(token)
    res.status(401).json({ error: 'No autorizado' })
    return
  }
  next()
}

app.get('/api/state', (req, res) => {
  res.json(getPublicState())
})

app.get('/api/me', (req, res) => {
  res.json({ guest: findGuestByToken(req.get('x-device-token') || '') })
})

app.post('/api/guests', asyncRoute(async (req, res) => {
  const { guest, state } = registerGuest(req.body?.name, req.body?.deviceToken)
  res.status(201).json({ guest, state })
}))

app.post('/api/songs', asyncRoute(async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`
  res.status(201).json(await addSong(req.body?.deviceToken, req.body?.url, origin))
}))

app.post('/api/admin/login', (req, res) => {
  if (Date.now() < pinLockedUntil) {
    res.status(429).json({ error: 'Demasiados intentos. Esperá unos segundos.' })
    return
  }
  if (!checkPin(req.body?.pin)) {
    pinFailures += 1
    if (pinFailures >= 5) {
      pinLockedUntil = Date.now() + 30_000
      pinFailures = 0
    }
    res.status(401).json({ error: 'PIN incorrecto' })
    return
  }
  pinFailures = 0
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, Date.now() + 24 * 60 * 60 * 1000)
  res.json({ token })
})

app.put('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  res.json(updateSettings(req.body || {}))
}))

app.delete('/api/admin/songs/:id', requireAdmin, asyncRoute(async (req, res) => {
  res.json(removeSong(req.params.id))
}))

app.delete('/api/admin/guests/:id/songs', requireAdmin, asyncRoute(async (req, res) => {
  res.json(clearGuestSongs(req.params.id))
}))

app.delete('/api/admin/guests/:id', requireAdmin, asyncRoute(async (req, res) => {
  res.json(removeGuest(req.params.id))
}))

app.post('/api/admin/guests/:id/move', requireAdmin, asyncRoute(async (req, res) => {
  res.json(moveGuest(req.params.id, req.body?.direction))
}))

app.post('/api/playback/start', asyncRoute(async (req, res) => {
  res.json(playbackStart())
}))

app.post('/api/playback/playing', asyncRoute(async (req, res) => {
  res.json(markPlaying(req.body?.songId))
}))

app.post('/api/playback/ended', asyncRoute(async (req, res) => {
  res.json(playbackEnded(req.body?.songId))
}))

app.post('/api/playback/skip', asyncRoute(async (req, res) => {
  res.json(playbackSkip())
}))

app.get('/invitados', (req, res) => {
  res.sendFile(path.join(publicDir, 'invitados.html'))
})

app.get('/visor', (req, res) => {
  res.sendFile(path.join(publicDir, 'visor.html'))
})

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'))
})

app.use(express.static(publicDir))

app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido' })
    return
  }
  const status = err instanceof HttpError ? err.status : 500
  if (status === 500) console.error(err)
  res.status(status).json({
    error: status === 500 ? 'Error interno' : err.message
  })
})

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Karaoke listo en http://127.0.0.1:${port}`)
  for (const address of localAddresses()) {
    console.log(`  http://${address}:${port}`)
  }
})

const sockets = new WebSocketServer({ server, path: '/ws' })

function broadcast(state) {
  const payload = JSON.stringify(state)
  for (const client of sockets.clients) {
    if (client.readyState === 1) client.send(payload)
  }
}

setNotifier(broadcast)

sockets.on('connection', (socket) => {
  socket.send(JSON.stringify(getPublicState()))
})

function localAddresses() {
  const addresses = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}
