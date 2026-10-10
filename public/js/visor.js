import { api, connectLive } from './live.js'

const stage = document.querySelector('.stage')
const legend = document.getElementById('legend')
const sub = document.getElementById('sub')
const countdown = document.getElementById('countdown')
const nowName = document.getElementById('now')
const screen = document.getElementById('screen')
const arm = document.getElementById('arm')
const pauseButton = document.getElementById('pause')
const skipButton = document.getElementById('skip')
const error = document.getElementById('error')

let state = null
let armed = false
let clockOffset = 0
let player = null
let activeSongId = null
let playRequest = 0
let playerToken = 0
let announceKey = null
let announceTimer = null
let startInFlight = false
let skipInFlight = false
const reported = new Set()

const apiReady = new Promise((resolve) => {
  window.onYouTubeIframeAPIReady = () => resolve()
  const script = document.createElement('script')
  script.src = 'https://www.youtube.com/iframe_api'
  script.onerror = () => {
    error.textContent = 'No se pudo cargar el reproductor de YouTube. Revisá la conexión.'
  }
  document.head.appendChild(script)
})

function showError(message) {
  error.textContent = message || ''
}

function serverNow() {
  return Date.now() + clockOffset
}

function restoreSlot() {
  if (document.getElementById('player')) return
  const slot = document.createElement('div')
  slot.id = 'player'
  screen.appendChild(slot)
}

function removePlayer() {
  activeSongId = null
  pauseButton.disabled = true
  pauseButton.textContent = 'Pausar'
  if (player) {
    const dying = player
    player = null
    try {
      dying.destroy()
    } catch {
      // El iframe ya no estaba.
    }
  }
  document.getElementById('player')?.remove()
  restoreSlot()
}

function embedUrl(videoId) {
  const params = new URLSearchParams({
    autoplay: '1',
    enablejsapi: '1',
    origin: location.origin,
    rel: '0',
    modestbranding: '1',
    playsinline: '1'
  })
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`
}

function reportEnded(songId) {
  if (reported.has(songId)) return
  reported.add(songId)
  api('/api/playback/ended', { method: 'POST', body: { songId } }).catch((err) => showError(err.message))
}

function createPlayer(videoId, songId) {
  const token = ++playerToken
  let sawPlaying = false
  removePlayer()
  activeSongId = songId
  const alive = () => token === playerToken && activeSongId === songId
  const iframe = document.createElement('iframe')
  iframe.id = 'player'
  iframe.title = 'Reproductor de YouTube'
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  iframe.allowFullscreen = true
  iframe.src = embedUrl(videoId)
  document.getElementById('player').replaceWith(iframe)

  player = new YT.Player(iframe, {
    events: {
      onReady: (event) => {
        if (!alive()) return
        showError('')
        event.target.unMute()
        event.target.setVolume(100)
        event.target.playVideo()
        pauseButton.disabled = false
      },
      onStateChange: (event) => {
        if (!alive()) return
        if (event.data === YT.PlayerState.PLAYING) sawPlaying = true
        if (event.data === YT.PlayerState.ENDED && sawPlaying) reportEnded(songId)
        pauseButton.textContent = event.data === YT.PlayerState.PAUSED ? 'Seguir' : 'Pausar'
      },
      onError: (event) => {
        if (!alive()) return
        const reason = {
          2: 'El enlace no es un video válido.',
          5: 'El reproductor de YouTube falló.',
          100: 'Ese video no está disponible.',
          101: 'El autor no permite reproducir este video acá.',
          150: 'El autor no permite reproducir este video acá.',
          153: 'YouTube no identificó esta página.'
        }[Number(event?.data)] || 'Ese video no se puede reproducir.'
        showError(`${reason} Pasamos al siguiente.`)
        reportEnded(songId)
      }
    }
  })
}

function syncPlayback() {
  const playback = state?.playback
  if (!armed || playback?.phase !== 'playing' || !playback.videoId) {
    playRequest += 1
    removePlayer()
    return
  }
  if (activeSongId === playback.songId && player) return

  const request = ++playRequest
  const { songId, videoId } = playback
  apiReady.then(() => {
    if (request !== playRequest) return
    if (!armed || state.playback.phase !== 'playing' || state.playback.songId !== songId) return
    createPlayer(videoId, songId)
  })
}

function syncAnnounce() {
  const playback = state?.playback
  if (!armed || playback?.phase !== 'announce' || !playback.announceUntil) {
    announceKey = null
    clearTimeout(announceTimer)
    return
  }

  const key = `${playback.songId}:${playback.announceUntil}`
  if (announceKey === key) return
  announceKey = key
  clearTimeout(announceTimer)

  const songId = playback.songId
  const delay = Math.max(0, new Date(playback.announceUntil).getTime() - serverNow())
  announceTimer = setTimeout(() => {
    api('/api/playback/playing', { method: 'POST', body: { songId } })
      .then(applyState)
      .catch((err) => showError(err.message))
  }, delay)
}

function renderCountdown() {
  const playback = state?.playback
  if (!armed || playback?.phase !== 'announce' || !playback.announceUntil) {
    countdown.textContent = ''
    return
  }
  const left = Math.max(0, new Date(playback.announceUntil).getTime() - serverNow())
  countdown.textContent = String(Math.ceil(left / 1000))
}

function render() {
  const playback = state?.playback
  const playing = playback?.phase === 'playing'
  stage.classList.toggle('is-playing', playing)
  nowName.textContent = playback && playback.phase !== 'idle' ? (playback.guestName || '') : ''
  if (!playback || playback.phase === 'idle') {
    legend.textContent = 'Esperando canciones'
    sub.textContent = 'Cuando alguien agregue un enlace, arranca el turno'
    screen.classList.add('is-hidden')
  } else if (playback.phase === 'announce') {
    legend.textContent = 'Prepárate'
    sub.textContent = playback.turnRemaining === 1
      ? '1 canción en este turno'
      : `${playback.turnRemaining} canciones en este turno`
    screen.classList.add('is-hidden')
  } else {
    legend.textContent = ''
    sub.textContent = ''
    screen.classList.remove('is-hidden')
  }

  arm.hidden = armed
  skipButton.disabled = !playback || playback.phase === 'idle'
  if (playback?.phase !== 'playing') pauseButton.disabled = true
  renderCountdown()
}

function applyState(next) {
  state = next
  clockOffset = new Date(next.serverTime).getTime() - Date.now()
  render()
  syncAnnounce()
  syncPlayback()
  ensureRunning()
}

async function ensureRunning() {
  if (!armed || startInFlight || !state) return
  if (state.playback.phase !== 'idle') return
  if (!state.guests.some((guest) => guest.songs.length > 0)) return
  startInFlight = true
  try {
    applyState(await api('/api/playback/start', { method: 'POST', body: {} }))
  } catch (err) {
    showError(err.message)
  } finally {
    startInFlight = false
  }
}

document.getElementById('start').addEventListener('click', async () => {
  armed = true
  arm.hidden = true
  showError('')
  try {
    if (!state || state.playback.phase === 'idle') {
      state = await api('/api/playback/start', { method: 'POST', body: {} })
    }
    applyState(state)
  } catch (err) {
    showError(err.message)
  }
})

pauseButton.addEventListener('click', () => {
  if (!player?.getPlayerState) return
  if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo()
  else player.playVideo()
})

skipButton.addEventListener('click', async () => {
  if (skipInFlight) return
  skipInFlight = true
  showError('')
  try {
    applyState(await api('/api/playback/skip', { method: 'POST', body: {} }))
  } catch (err) {
    showError(err.message)
  } finally {
    skipInFlight = false
  }
})

setInterval(renderCountdown, 200)
connectLive(applyState)
