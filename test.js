const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApp } = require('./server');

function setup() {
  const db = new Database(':memory:');
  return { app: createApp({ db, seed: false }), db };
}

test('creates users and events, registers and cancels a registration', async () => {
  const { app, db } = setup();
  const user = await request(app).post('/api/users').send({ name: 'Asha', email: 'asha@example.com' });
  assert.equal(user.status, 201);
  const event = await request(app).post('/api/events').send({ title: 'API Day', location: 'Hall A', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T12:00:00Z', capacity: 1 });
  assert.equal(event.status, 201);
  const registration = await request(app).post(`/api/events/${event.body.data.id}/registrations`).set('X-User-Id', user.body.data.id);
  assert.equal(registration.status, 201);
  const duplicate = await request(app).post(`/api/events/${event.body.data.id}/registrations`).set('X-User-Id', user.body.data.id);
  assert.equal(duplicate.status, 409);
  const list = await request(app).get('/api/registrations').set('X-User-Id', user.body.data.id);
  assert.equal(list.body.data.length, 1);
  const cancel = await request(app).delete(`/api/registrations/${registration.body.data.id}`).set('X-User-Id', user.body.data.id);
  assert.equal(cancel.status, 204);
  db.close();
});

test('prevents registrations after capacity is reached', async () => {
  const { app, db } = setup();
  const a = await request(app).post('/api/users').send({ name: 'A', email: 'a@example.com' });
  const b = await request(app).post('/api/users').send({ name: 'B', email: 'b@example.com' });
  const event = await request(app).post('/api/events').send({ title: 'Small Event', location: 'Online', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T11:00:00Z', capacity: 1 });
  const first = await request(app).post(`/api/events/${event.body.data.id}/registrations`).set('X-User-Id', a.body.data.id);
  const second = await request(app).post(`/api/events/${event.body.data.id}/registrations`).set('X-User-Id', b.body.data.id);
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  db.close();
});
