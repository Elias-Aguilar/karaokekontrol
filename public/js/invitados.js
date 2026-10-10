import { api, connectLive, escapeHtml } from './live.js'

const TOKEN_KEY = 'karaoke.deviceToken'

function randomId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function deviceToken() {
  let value = localStorage.getItem(TOKEN_KEY)
  if (!value || !/^[A-Za-z0-9-]{16,80}$/.test(value)) {
    value = randomId()
    localStorage.setItem(TOKEN_KEY, value)
  }
  return value
}

const token = deviceToken()
const nameScreen = document.getElementById('name-screen')
const appScreen = document.getElementById('app-screen')
const nameError = document.getElementById('name-error')
const songError = document.getElementById('song-error')

let me = null
let state = null

function showApp(visible) {
  nameScreen.hidden = visible
  appScreen.hidden = !visible
}

function render() {
  if (!me || !state) return
  const mine = state.guests.find((guest) => guest.id === me.id)
  const songs = mine?.songs || []
  const max = state.settings.maxSongs
  const left = Math.max(0, max - songs.length)
  const playback = state.playback
  const place = state.guests.findIndex((guest) => guest.id === me.id) + 1

  document.getElementById('hello').textContent = mine?.name || me.name
  document.getElementById('place').textContent = place
    ? `Lugar en la ronda: ${place} de ${state.guests.length}. Por turno suenan hasta ${state.settings.songsPerTurn}.`
    : ''

  const status = document.getElementById('status')
  if (playback.guestId === me.id && playback.phase === 'announce') {
    status.textContent = 'Prepárate: es tu turno'
  } else if (playback.guestId === me.id && playback.phase === 'playing') {
    status.textContent = 'Está sonando tu canción'
  } else if (songs.length > 0) {
    status.textContent = 'En la cola'
  } else {
    status.textContent = 'Sin canciones'
  }

  const slots = document.getElementById('slots')
  if (songs.length > max) {
    slots.textContent = `Tenés ${songs.length} canciones y el cupo ahora es ${max}. Se reproducen igual; vas a poder agregar cuando bajes de ${max}.`
  } else if (left === 0) {
    slots.textContent = `Lista llena (${songs.length} de ${max}). Cuando se reproduzca una, vas a poder agregar otra.`
  } else {
    slots.textContent = `Podés agregar ${left} de ${max}.`
  }

  const urlInput = document.getElementById('url')
  const submit = document.querySelector('#song-form button[type="submit"]')
  const blocked = left === 0
  urlInput.disabled = blocked
  submit.disabled = blocked
  syncClear()

  const list = document.getElementById('songs')
  if (songs.length === 0) {
    list.innerHTML = '<li class="empty">Tu lista está vacía.</li>'
    return
  }

  list.innerHTML = songs.map((song, index) => {
    const current = song.id === playback.songId
    return `<li class="${current ? 'is-current' : ''}">
      <span class="pos">${index + 1}</span>
      <a href="${escapeHtml(song.url)}" target="_blank" rel="noreferrer">${escapeHtml(song.url)}</a>
      ${current ? '<em class="badge">En curso</em>' : ''}
    </li>`
  }).join('')
}

document.getElementById('name-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  nameError.textContent = ''
  const name = document.getElementById('name').value
  try {
    const data = await api('/api/guests', {
      method: 'POST',
      body: { name, deviceToken: token }
    })
    me = data.guest
    state = data.state
    showApp(true)
    render()
  } catch (error) {
    nameError.textContent = error.message
  }
})

function syncClear() {
  const input = document.getElementById('url')
  const clear = document.getElementById('clear-url')
  clear.hidden = input.disabled || input.value.trim() === ''
}

document.getElementById('url').addEventListener('input', syncClear)

document.getElementById('clear-url').addEventListener('click', () => {
  const input = document.getElementById('url')
  input.value = ''
  syncClear()
  input.focus()
})

document.getElementById('song-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  songError.textContent = ''
  const input = document.getElementById('url')
  const submit = event.currentTarget.querySelector('button[type="submit"]')
  submit.disabled = true
  submit.textContent = 'Comprobando...'
  try {
    state = await api('/api/songs', {
      method: 'POST',
      body: { deviceToken: token, url: input.value }
    })
    input.value = ''
    render()
  } catch (error) {
    songError.textContent = error.message
    if (error.message.includes('no permite reproducir')) {
      input.value = ''
      input.focus()
    }
  } finally {
    submit.textContent = 'Agregar'
    render()
  }
})

const meData = await api('/api/me', { headers: { 'X-Device-Token': token } })
me = meData.guest
showApp(Boolean(me))

connectLive((next) => {
  state = next
  if (me && !state.guests.some((guest) => guest.id === me.id)) {
    me = null
    nameError.textContent = 'Te sacaron de la ronda. Volvé a anotarte con tu nombre.'
    showApp(false)
    return
  }
  render()
})
