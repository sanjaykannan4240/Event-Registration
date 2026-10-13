# Event Registration System

A REST API built with **Express.js** and **SQLite** for managing events, users, and event registrations.

## Run locally

```bash
npm install
npm test
npm start
```

The API listens on `http://localhost:3000`. The SQLite file is created as `events.db` in the project directory. Set `PORT` or `DB_PATH` to override defaults.

## Browser interface

The project includes `public/index.html`, a responsive frontend for searching events, creating an attendee profile, registering, viewing registrations, and cancelling registrations. Start the server with `npm start`, then open **http://localhost:3000** in a browser. Do not open the HTML with `file://` if the API server is not running; the page is intended to be served by Express.

## API endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/api/users` | List users |
| POST | `/api/users` | Create a user |
| GET | `/api/events` | List events; supports `?search=` and `?upcoming=true` |
| GET | `/api/events/:id` | Event details with capacity and registration count |
| POST | `/api/events` | Create an event |
| POST | `/api/events/:eventId/registrations` | Register the current user |
| GET | `/api/registrations` | List registrations for the current user |
| DELETE | `/api/registrations/:registrationId` | Cancel one of the current user's registrations |

For user-scoped endpoints, send the current user's ID in `X-User-Id`. This lightweight identity mechanism keeps the demo focused; production deployments should replace it with JWT or session authentication.

## Example flow

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jordan Lee","email":"jordan@example.com"}'

curl http://localhost:3000/api/events

curl -X POST http://localhost:3000/api/events/1/registrations \
  -H 'X-User-Id: 2'

curl http://localhost:3000/api/registrations -H 'X-User-Id: 2'

curl -X DELETE http://localhost:3000/api/registrations/1 -H 'X-User-Id: 2'
```

## Data model

- `users`: user identity and contact details.
- `events`: event details, schedule, location, and capacity.
- `registrations`: join table linking users and events, with a unique `(user_id, event_id)` constraint to prevent duplicates.

SQLite foreign keys, indexes, input validation, capacity checks, and useful HTTP errors are enabled. A demo user and two demo events are seeded on first start.
