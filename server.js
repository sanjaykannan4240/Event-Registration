const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'events.db');

function createApp({ db = new Database(DB_PATH), seed = true } = {}) {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK(length(trim(name)) > 0),
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(trim(title)) > 0),
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL CHECK(length(trim(location)) > 0),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(ends_at > starts_at)
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_registrations_user ON registrations(user_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
  `);

  if (seed && db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0) {
    const insertUser = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
    const insertEvent = db.prepare(`INSERT INTO events
      (title, description, location, starts_at, ends_at, capacity)
      VALUES (?, ?, ?, ?, ?, ?)`);
    insertUser.run('Demo User', 'demo@example.com');
    insertEvent.run('Community Tech Meetup', 'An evening of talks, networking, and practical software engineering tips.', 'Innovation Hub, Room 2', '2026-11-20T18:00:00Z', '2026-11-20T20:30:00Z', 100);
    insertEvent.run('SQLite Workshop', 'Hands-on introduction to schema design, constraints, and queries with SQLite.', 'Online', '2026-12-05T10:00:00Z', '2026-12-05T12:00:00Z', 40);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  const sendError = (res, status, message, details) => res.status(status).json({ error: message, ...(details ? { details } : {}) });
  const getUserId = (req) => {
    const raw = req.header('x-user-id') || req.body?.userId || req.query?.userId;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  const getEvent = db.prepare(`
    SELECT e.*, COUNT(r.id) AS registration_count, e.capacity - COUNT(r.id) AS available_seats
    FROM events e LEFT JOIN registrations r ON r.event_id = e.id
    WHERE e.id = ? GROUP BY e.id
  `);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/users', (_req, res) => {
    res.json({ data: db.prepare('SELECT id, name, email, created_at FROM users ORDER BY id DESC').all() });
  });

  app.post('/api/users', (req, res) => {
    const { name, email } = req.body || {};
    if (!name || !String(name).trim() || !email || !String(email).includes('@')) return sendError(res, 400, 'name and a valid email are required');
    try {
      const result = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run(String(name).trim(), String(email).trim());
      return res.status(201).json({ data: db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(result.lastInsertRowid) });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'A user with this email already exists');
      return sendError(res, 400, 'Could not create user');
    }
  });

  app.get('/api/events', (req, res) => {
    const search = String(req.query.search || '').trim();
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push('(e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (req.query.upcoming === 'true') conditions.push("e.starts_at >= datetime('now')");
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const events = db.prepare(`
      SELECT e.*, COUNT(r.id) AS registration_count, e.capacity - COUNT(r.id) AS available_seats
      FROM events e LEFT JOIN registrations r ON r.event_id = e.id
      ${where} GROUP BY e.id ORDER BY e.starts_at ASC
    `).all(...params);
    res.json({ data: events });
  });

  app.get('/api/events/:id', (req, res) => {
    const event = getEvent.get(Number(req.params.id));
    if (!event) return sendError(res, 404, 'Event not found');
    res.json({ data: event });
  });

  app.post('/api/events', (req, res) => {
    const { title, description = '', location, startsAt, endsAt, capacity } = req.body || {};
    const capacityNumber = Number(capacity);
    if (!title || !location || !startsAt || !endsAt || !Number.isInteger(capacityNumber) || capacityNumber < 1) return sendError(res, 400, 'title, location, startsAt, endsAt, and a positive integer capacity are required');
    if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt)) || new Date(endsAt) <= new Date(startsAt)) return sendError(res, 400, 'endsAt must be a valid date after startsAt');
    try {
      const result = db.prepare(`INSERT INTO events (title, description, location, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, ?, ?)`).run(title.trim(), description, location.trim(), startsAt, endsAt, capacityNumber);
      return res.status(201).json({ data: getEvent.get(result.lastInsertRowid) });
    } catch (_error) {
      return sendError(res, 400, 'Could not create event');
    }
  });

  app.post('/api/events/:eventId/registrations', (req, res) => {
    const userId = getUserId(req);
    const eventId = Number(req.params.eventId);
    if (!userId) return sendError(res, 400, 'Provide a valid user id using the X-User-Id header or userId field');
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return sendError(res, 404, 'User not found');
    const event = getEvent.get(eventId);
    if (!event) return sendError(res, 404, 'Event not found');
    if (event.available_seats <= 0) return sendError(res, 409, 'This event is fully booked');
    try {
      const result = db.prepare('INSERT INTO registrations (user_id, event_id) VALUES (?, ?)').run(userId, eventId);
      const registration = db.prepare(`SELECT r.id, r.registered_at, u.id AS user_id, u.name AS user_name, u.email AS user_email, e.id AS event_id, e.title AS event_title, e.starts_at, e.ends_at, e.location FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id WHERE r.id = ?`).get(result.lastInsertRowid);
      return res.status(201).json({ data: registration });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'User is already registered for this event');
      return sendError(res, 400, 'Could not create registration');
    }
  });

  app.get('/api/registrations', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return sendError(res, 400, 'Provide a valid user id using the X-User-Id header or userId query parameter');
    const registrations = db.prepare(`SELECT r.id, r.registered_at, e.id AS event_id, e.title AS event_title, e.description, e.location, e.starts_at, e.ends_at FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = ? ORDER BY e.starts_at ASC`).all(userId);
    res.json({ data: registrations });
  });

  app.delete('/api/registrations/:registrationId', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return sendError(res, 400, 'Provide a valid user id using the X-User-Id header or userId field');
    const result = db.prepare('DELETE FROM registrations WHERE id = ? AND user_id = ?').run(Number(req.params.registrationId), userId);
    if (!result.changes) return sendError(res, 404, 'Registration not found for this user');
    res.status(204).send();
  });

  app.use((_req, res) => sendError(res, 404, 'Route not found'));
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && error.message.includes('JSON')) return sendError(res, 400, 'Request body must contain valid JSON');
    return sendError(res, 500, 'Internal server error');
  });
  app.locals.db = db;
  return app;
}

if (require.main === module) {
  createApp().listen(PORT, '0.0.0.0', () => console.log(`Event registration API running at http://localhost:${PORT}`));
}

module.exports = { createApp };
