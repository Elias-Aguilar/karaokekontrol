import { api, connectLive, escapeHtml } from './live.js'

const TOKEN_KEY = 'karaoke.adminToken'
const loginScreen = document.getElementById('login-screen')
const appScreen = document.getElementById('app-screen')
const loginError = document.getElementById('login-error')
const settingsError = document.getElementById('settings-error')
const settingsForm = document.getElementById('settings-form')
const maxInput = document.getElementById('max-songs')
const turnInput = document.getElementById('songs-per-turn')
const announceInput = document.getElementById('announce-seconds')

let token = sessionStorage.getItem(TOKEN_KEY) || ''
let state = null
let settingsReady = false

function showApp(visible) {
  loginScreen.hidden = visible
  appScreen.hidden = !visible
}

function fillSettings() {
  if (!state) return
  const active = document.activeElement
  if (active && settingsForm.contains(active)) return
  maxInput.value = state.settings.maxSongs
  turnInput.max = state.settings.maxSongs
  turnInput.value = state.settings.songsPerTurn
  announceInput.value = state.settings.announceSeconds
  settingsReady = true
}

function renderGuests() {
  const host = document.getElementById('guests')
  if (!state.guests.length) {
    host.innerHTML = '<p class="muted">Todavía no hay invitados.</p>'
    return
  }

  host.innerHTML = state.guests.map((guest, index) => {
    const live = guest.id === state.playback.guestId && state.playback.phase !== 'idle'
    const songs = guest.songs.map((song, songIndex) => {
      const current = song.id === state.playback.songId
      return `<li class="${current ? 'is-current' : ''}">
        <span class="pos">${songIndex + 1}</span>
        <a href="${escapeHtml(song.url)}" target="_blank" rel="noreferrer">${escapeHtml(song.url)}</a>
        ${current ? '<em class="badge">En curso</em>' : ''}
        <button type="button" class="ghost" data-delete-song="${song.id}">Borrar</button>
      </li>`
    }).join('')

    return `<article class="guest ${live ? 'is-live' : ''}">
      <header>
        <strong>${index + 1}. ${escapeHtml(guest.name)}</strong>
        <div class="actions">
          <button type="button" class="secondary" data-move="up" data-guest="${guest.id}" ${index === 0 ? 'disabled' : ''}>Subir</button>
          <button type="button" class="secondary" data-move="down" data-guest="${guest.id}" ${index === state.guests.length - 1 ? 'disabled' : ''}>Bajar</button>
          <button type="button" class="ghost" data-clear="${guest.id}" ${guest.songs.length ? '' : 'disabled'}>Borrar canciones</button>
          <button type="button" class="ghost" data-remove="${guest.id}">Borrar usuario</button>
        </div>
      </header>
      <ul class="song-list">${songs || '<li class="empty">Sin canciones</li>'}</ul>
    </article>`
  }).join('')
}

function render() {
  if (!token || !state) return
  showApp(true)
  if (!settingsReady) fillSettings()
  else {
    turnInput.max = state.settings.maxSongs
  }
  renderGuests()
}

async function admin(path, options = {}) {
  try {
    return await api(path, { ...options, token })
  } catch (error) {
    if (error.status === 401) {
      token = ''
      sessionStorage.removeItem(TOKEN_KEY)
      settingsReady = false
      showApp(false)
      loginError.textContent = 'La sesión venció. Volvé a entrar.'
    }
    throw error
  }
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  loginError.textContent = ''
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: { pin: document.getElementById('pin').value }
    })
    token = data.token
    sessionStorage.setItem(TOKEN_KEY, token)
    settingsReady = false
    if (state) render()
  } catch (error) {
    loginError.textContent = error.message
  }
})

maxInput.addEventListener('input', () => {
  const max = Number(maxInput.value)
  if (!Number.isInteger(max) || max < 1) return
  turnInput.max = max
  if (Number(turnInput.value) > max) turnInput.value = String(max)
})

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  settingsError.textContent = ''
  const body = {
    maxSongs: Number(maxInput.value),
    songsPerTurn: Number(turnInput.value),
    announceSeconds: Number(announceInput.value)
  }
  const pin = document.getElementById('new-pin').value.trim()
  if (pin) body.pin = pin
  try {
    state = await admin('/api/admin/settings', { method: 'PUT', body })
    document.getElementById('new-pin').value = ''
    settingsReady = false
    fillSettings()
    renderGuests()
    settingsError.textContent = ''
  } catch (error) {
    settingsError.textContent = error.message
  }
})

document.getElementById('guests').addEventListener('click', async (event) => {
  const button = event.target.closest('button')
  if (!button) return
  settingsError.textContent = ''
  try {
    if (button.dataset.deleteSong) {
      if (!confirm('¿Borrar esta canción?')) return
      state = await admin(`/api/admin/songs/${button.dataset.deleteSong}`, { method: 'DELETE' })
    } else if (button.dataset.clear) {
      if (!confirm('¿Borrar todas las canciones de este invitado?')) return
      state = await admin(`/api/admin/guests/${button.dataset.clear}/songs`, { method: 'DELETE' })
    } else if (button.dataset.remove) {
      const guest = state.guests.find((item) => String(item.id) === button.dataset.remove)
      const name = guest?.name || 'este invitado'
      if (!confirm(`¿Borrar a ${name}? También se borran sus canciones.`)) return
      state = await admin(`/api/admin/guests/${button.dataset.remove}`, { method: 'DELETE' })
    } else if (button.dataset.move) {
      state = await admin(`/api/admin/guests/${button.dataset.guest}/move`, {
        method: 'POST',
        body: { direction: button.dataset.move }
      })
    } else {
      return
    }
    render()
  } catch (error) {
    settingsError.textContent = error.message
  }
})

connectLive((next) => {
  state = next
  if (token) render()
})

showApp(Boolean(token))
