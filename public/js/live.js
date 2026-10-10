export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo completar la acción')
    error.status = response.status
    throw error
  }
  return data
}

export function connectLive(onState) {
  let socket
  let stopped = false

  const pull = async () => {
    try {
      const state = await api('/api/state')
      onState(state)
    } catch {
      // El próximo intento llega por WebSocket o al reconectar.
    }
  }

  const open = () => {
    if (stopped) return
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${protocol}://${location.host}/ws`)
    socket.onmessage = (event) => onState(JSON.parse(event.data))
    socket.onclose = () => {
      if (!stopped) setTimeout(open, 1200)
    }
  }

  pull()
  open()

  return () => {
    stopped = true
    socket?.close()
  }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char])
}
