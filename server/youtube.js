const HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com'
])

const ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

export function parseYouTubeVideoId(input) {
  let raw = String(input || '').trim()
  if (!raw || raw.length > 2048) return null
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`

  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  if (!HOSTS.has(host)) return null

  let id = null
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] || null
  } else if (url.pathname === '/watch' || url.pathname === '/watch/') {
    id = url.searchParams.get('v')
  } else {
    const parts = url.pathname.split('/').filter(Boolean)
    if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || null
  }

  if (!id || !ID_PATTERN.test(id)) return null
  return id
}

export async function youtubeEmbedBlocked(videoId, pageOrigin) {
  const headers = { 'User-Agent': 'Mozilla/5.0' }
  if (pageOrigin) headers.Referer = `${pageOrigin}/`

  let response
  try {
    response = await fetch(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    return 'unreachable'
  }

  if (!response.ok) return 'blocked'
  const html = await response.text()
  if (html.includes('UNPLAYABLE') || html.includes('LOGIN_REQUIRED')) return 'blocked'
  return 'ok'
}
