import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.KARAOKE_DB || path.join(dataDir, 'karaoke.db')
export const db = new DatabaseSync(dbPath)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  device_token TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playback (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL DEFAULT 'idle',
  guest_id INTEGER,
  song_id INTEGER,
  turn_remaining INTEGER NOT NULL DEFAULT 0,
  announce_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_songs_guest ON songs (guest_id, created_at, id);
`)

const defaults = {
  max_songs: '3',
  songs_per_turn: '1',
  announce_seconds: '8',
  admin_pin: 'karaoke'
}

const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
)
for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value)
}

const playback = db.prepare('SELECT id FROM playback WHERE id = 1').get()
if (!playback) {
  db.prepare(
    'INSERT INTO playback (id, phase, turn_remaining, updated_at) VALUES (1, ?, 0, ?)'
  ).run('idle', new Date().toISOString())
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // La transacción ya estaba cerrada.
    }
    throw error
  }
}
