import crypto from 'node:crypto'
import { db, transaction } from './db.js'
import { parseYouTubeVideoId, youtubeEmbedBlocked } from './youtube.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

let notify = () => {}

export function setNotifier(fn) {
  notify = fn
}

function publish() {
  const state = getPublicState()
  notify(state)
  return state
}

function nameKey(name) {
  return name.toLocaleLowerCase('es')
}

function normalizeName(name) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (clean.length < 1 || clean.length > 40) {
    throw new HttpError(400, 'El nombre debe tener entre 1 y 40 caracteres')
  }
  return clean
}

function assertToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9-]{16,80}$/.test(token)) {
    throw new HttpError(400, 'Identificador de dispositivo inválido')
  }
}

function readInt(value, label, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label} debe ser un entero entre ${min} y ${max}`)
  }
  return number
}

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    maxSongs: Number(map.max_songs),
    songsPerTurn: Number(map.songs_per_turn),
    announceSeconds: Number(map.announce_seconds),
    adminPin: String(map.admin_pin)
  }
}

function writeSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value))
}

function listGuestRows() {
  return db.prepare(
    'SELECT id, name, sort_order FROM guests ORDER BY sort_order ASC, id ASC'
  ).all()
}

function listSongs(guestId) {
  return db.prepare(
    `SELECT id, url, video_id, created_at
     FROM songs
     WHERE guest_id = ?
     ORDER BY created_at ASC, id ASC`
  ).all(guestId)
}

function songCount(guestId) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM songs WHERE guest_id = ?').get(guestId).c)
}

function readPlayback() {
  return db.prepare(
    `SELECT phase, guest_id, song_id, turn_remaining, announce_until
     FROM playback WHERE id = 1`
  ).get()
}

function writePlayback({ phase, guestId, songId, turnRemaining, announceUntil }) {
  db.prepare(
    `UPDATE playback
     SET phase = ?, guest_id = ?, song_id = ?, turn_remaining = ?, announce_until = ?, updated_at = ?
     WHERE id = 1`
  ).run(
    phase,
    guestId ?? null,
    songId ?? null,
    turnRemaining,
    announceUntil ?? null,
    new Date().toISOString()
  )
}

function setIdle() {
  writePlayback({
    phase: 'idle',
    guestId: null,
    songId: null,
    turnRemaining: 0,
    announceUntil: null
  })
}

function findNextGuestWithSongs(afterGuestId) {
  const guests = listGuestRows()
  if (guests.length === 0) return null

  let start = 0
  if (afterGuestId) {
    const index = guests.findIndex((guest) => guest.id === afterGuestId)
    start = index === -1 ? 0 : index + 1
  }

  for (let offset = 0; offset < guests.length; offset += 1) {
    const guest = guests[(start + offset) % guests.length]
    if (songCount(guest.id) > 0) return guest.id
  }
  return null
}

function beginTurn(guestId) {
  const songs = listSongs(guestId)
  const settings = readSettings()
  const count = Math.min(settings.songsPerTurn, songs.length)
  if (count === 0) {
    setIdle()
    return
  }

  const seconds = settings.announceSeconds
  writePlayback({
    phase: seconds > 0 ? 'announce' : 'playing',
    guestId,
    songId: songs[0].id,
    turnRemaining: count,
    announceUntil: seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null
  })
}

function advanceAfter(guestId) {
  const nextGuestId = findNextGuestWithSongs(guestId)
  if (!nextGuestId) {
    setIdle()
    return
  }
  beginTurn(nextGuestId)
}

function completeCurrent() {
  const playback = readPlayback()
  if (playback.phase === 'idle') return

  if (playback.song_id) {
    db.prepare('DELETE FROM songs WHERE id = ?').run(playback.song_id)
  }

  const guestId = playback.guest_id
  const remaining = Number(playback.turn_remaining) - 1
  const songs = guestId ? listSongs(guestId) : []

  if (remaining > 0 && songs.length > 0) {
    writePlayback({
      phase: 'playing',
      guestId,
      songId: songs[0].id,
      turnRemaining: remaining,
      announceUntil: null
    })
    return
  }

  advanceAfter(guestId)
}

export function getPublicState() {
  const settings = readSettings()
  const playback = readPlayback()
  const playbackGuestId = playback.guest_id == null ? null : Number(playback.guest_id)
  const playbackSongId = playback.song_id == null ? null : Number(playback.song_id)
  const guests = listGuestRows().map((guest) => ({
    id: Number(guest.id),
    name: guest.name,
    sortOrder: Number(guest.sort_order),
    songs: listSongs(guest.id).map((song) => ({
      id: Number(song.id),
      url: song.url,
      videoId: song.video_id,
      createdAt: song.created_at
    }))
  }))

  const currentGuest = guests.find((guest) => guest.id === playbackGuestId) || null
  const currentSong = currentGuest?.songs.find((song) => song.id === playbackSongId) || null

  return {
    settings: {
      maxSongs: settings.maxSongs,
      songsPerTurn: settings.songsPerTurn,
      announceSeconds: settings.announceSeconds
    },
    guests,
    playback: {
      phase: playback.phase,
      guestId: currentGuest ? currentGuest.id : null,
      guestName: currentGuest ? currentGuest.name : null,
      songId: currentSong ? currentSong.id : null,
      videoId: currentSong ? currentSong.videoId : null,
      url: currentSong ? currentSong.url : null,
      turnRemaining: currentSong ? Number(playback.turn_remaining) : 0,
      announceUntil: playback.phase === 'announce' ? playback.announce_until : null
    },
    serverTime: new Date().toISOString()
  }
}

export function findGuestByToken(deviceToken) {
  if (typeof deviceToken !== 'string' || !deviceToken) return null
  const guest = db.prepare(
    'SELECT id, name FROM guests WHERE device_token = ?'
  ).get(deviceToken)
  if (!guest) return null
  return { id: Number(guest.id), name: guest.name }
}

export function checkPin(pin) {
  const settings = readSettings()
  const left = Buffer.from(String(pin ?? ''))
  const right = Buffer.from(settings.adminPin)
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left)
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

export function registerGuest(nameInput, deviceToken) {
  assertToken(deviceToken)
  const name = normalizeName(nameInput)

  const guest = transaction(() => {
    const byToken = db.prepare(
      'SELECT id, name FROM guests WHERE device_token = ?'
    ).get(deviceToken)
    if (byToken) return { id: byToken.id, name: byToken.name }

    const byName = db.prepare('SELECT id FROM guests WHERE name_key = ?').get(nameKey(name))
    if (byName) {
      throw new HttpError(409, 'Ese nombre ya está en uso en otro dispositivo')
    }

    const maxOrder = Number(
      db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM guests').get().max
    )
    const createdAt = new Date().toISOString()
    const result = db.prepare(
      `INSERT INTO guests (name, name_key, device_token, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(name, nameKey(name), deviceToken, maxOrder + 1, createdAt)

    return { id: Number(result.lastInsertRowid), name }
  })

  return { guest, state: publish() }
}

export async function addSong(deviceToken, urlInput, pageOrigin) {
  assertToken(deviceToken)
  const url = String(urlInput ?? '').trim()
  const videoId = parseYouTubeVideoId(url)
  if (!videoId) throw new HttpError(400, 'No reconozco ese enlace de YouTube')

  const guest = db.prepare('SELECT id FROM guests WHERE device_token = ?').get(deviceToken)
  if (!guest) throw new HttpError(404, 'Primero ingresá tu nombre')

  const settings = readSettings()
  if (songCount(guest.id) >= settings.maxSongs) {
    throw new HttpError(400, `Ya alcanzaste el máximo de ${settings.maxSongs} canciones`)
  }

  const duplicate = db.prepare(
    'SELECT id FROM songs WHERE guest_id = ? AND video_id = ?'
  ).get(guest.id, videoId)
  if (duplicate) throw new HttpError(409, 'Esa canción ya está en tu lista')

  const embed = await youtubeEmbedBlocked(videoId, pageOrigin)
  if (embed === 'unreachable') {
    throw new HttpError(503, 'No pude verificar el video con YouTube. Intentá de nuevo.')
  }
  if (embed === 'blocked') {
    throw new HttpError(400, 'YouTube no permite reproducir ese video en esta pantalla. Probá con otro enlace.')
  }

  transaction(() => {
    if (songCount(guest.id) >= readSettings().maxSongs) {
      throw new HttpError(400, `Ya alcanzaste el máximo de ${readSettings().maxSongs} canciones`)
    }
    const stillThere = db.prepare(
      'SELECT id FROM songs WHERE guest_id = ? AND video_id = ?'
    ).get(guest.id, videoId)
    if (stillThere) throw new HttpError(409, 'Esa canción ya está en tu lista')

    db.prepare(
      'INSERT INTO songs (guest_id, url, video_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(guest.id, url, videoId, new Date().toISOString())
  })

  return publish()
}

export function updateSettings(input) {
  transaction(() => {
    const current = readSettings()
    const maxSongs = input.maxSongs === undefined
      ? current.maxSongs
      : readInt(input.maxSongs, 'El máximo de canciones', 1, 20)

    let songsPerTurn = input.songsPerTurn === undefined
      ? current.songsPerTurn
      : readInt(input.songsPerTurn, 'Las canciones por turno', 1, 20)

    const announceSeconds = input.announceSeconds === undefined
      ? current.announceSeconds
      : readInt(input.announceSeconds, 'Los segundos de anuncio', 0, 120)

    if (input.songsPerTurn !== undefined && songsPerTurn > maxSongs) {
      throw new HttpError(400, 'Las canciones por turno no pueden superar el máximo por invitado')
    }
    if (songsPerTurn > maxSongs) songsPerTurn = maxSongs

    writeSetting('max_songs', maxSongs)
    writeSetting('songs_per_turn', songsPerTurn)
    writeSetting('announce_seconds', announceSeconds)

    if (input.pin !== undefined && String(input.pin).trim() !== '') {
      const pin = String(input.pin).trim()
      if (pin.length < 4 || pin.length > 32) {
        throw new HttpError(400, 'El PIN debe tener entre 4 y 32 caracteres')
      }
      writeSetting('admin_pin', pin)
    }
  })

  return publish()
}

export function removeSong(songId) {
  const id = Number(songId)
  if (!Number.isInteger(id)) throw new HttpError(400, 'Canción inválida')

  transaction(() => {
    const song = db.prepare('SELECT id FROM songs WHERE id = ?').get(id)
    if (!song) throw new HttpError(404, 'Canción no encontrada')

    const playback = readPlayback()
    if (playback.phase !== 'idle' && Number(playback.song_id) === id) {
      completeCurrent()
      return
    }
    db.prepare('DELETE FROM songs WHERE id = ?').run(id)
  })

  return publish()
}

export function removeGuest(guestId) {
  const id = Number(guestId)
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invitado inválido')

  transaction(() => {
    const guest = db.prepare('SELECT id FROM guests WHERE id = ?').get(id)
    if (!guest) throw new HttpError(404, 'Invitado no encontrado')

    const playback = readPlayback()
    const interrupts = playback.phase !== 'idle' && Number(playback.guest_id) === id
    if (interrupts) {
      db.prepare('DELETE FROM songs WHERE guest_id = ?').run(id)
      advanceAfter(id)
    }
    db.prepare('DELETE FROM guests WHERE id = ?').run(id)
  })

  return publish()
}

export function clearGuestSongs(guestId) {
  const id = Number(guestId)
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invitado inválido')

  transaction(() => {
    const guest = db.prepare('SELECT id FROM guests WHERE id = ?').get(id)
    if (!guest) throw new HttpError(404, 'Invitado no encontrado')

    const playback = readPlayback()
    const interrupts = playback.phase !== 'idle' && Number(playback.guest_id) === id
    db.prepare('DELETE FROM songs WHERE guest_id = ?').run(id)
    if (interrupts) advanceAfter(id)
  })

  return publish()
}

export function moveGuest(guestId, direction) {
  const id = Number(guestId)
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invitado inválido')
  if (direction !== 'up' && direction !== 'down') {
    throw new HttpError(400, 'Dirección inválida')
  }

  transaction(() => {
    const guests = listGuestRows()
    const index = guests.findIndex((guest) => guest.id === id)
    if (index === -1) throw new HttpError(404, 'Invitado no encontrado')

    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= guests.length) return

    const current = guests[index]
    const other = guests[target]
    db.prepare('UPDATE guests SET sort_order = ? WHERE id = ?').run(-1, current.id)
    db.prepare('UPDATE guests SET sort_order = ? WHERE id = ?').run(current.sort_order, other.id)
    db.prepare('UPDATE guests SET sort_order = ? WHERE id = ?').run(other.sort_order, current.id)
  })

  return publish()
}

export function playbackStart() {
  transaction(() => {
    const playback = readPlayback()
    if (playback.phase !== 'idle') return
    const nextGuestId = findNextGuestWithSongs(null)
    if (!nextGuestId) return
    beginTurn(nextGuestId)
  })
  return publish()
}

export function markPlaying(songId) {
  transaction(() => {
    const playback = readPlayback()
    if (playback.phase !== 'announce') return
    if (Number(songId) !== Number(playback.song_id)) return
    writePlayback({
      phase: 'playing',
      guestId: playback.guest_id,
      songId: playback.song_id,
      turnRemaining: Number(playback.turn_remaining),
      announceUntil: null
    })
  })
  return publish()
}

export function playbackEnded(songId) {
  transaction(() => {
    const playback = readPlayback()
    if (playback.phase === 'idle') return
    if (Number(songId) !== Number(playback.song_id)) return
    completeCurrent()
  })
  return publish()
}

export function playbackSkip() {
  transaction(() => {
    const playback = readPlayback()
    if (playback.phase === 'idle') return
    completeCurrent()
  })
  return publish()
}
