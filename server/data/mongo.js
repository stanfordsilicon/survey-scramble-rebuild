// MongoDB connection for gameplay analytics — completely separate from the
// in-memory room store in ./game/store.js, which holds *live* game state.
// This module only persists finished game sessions for later analysis, and
// is deliberately best-effort: if it's unset or unreachable, the game keeps
// working exactly as before, just without analytics.
//
// Configuration (set these on the host, e.g. Render's Environment tab):
//   MONGODB_URI            - full connection string (required)
//   MONGODB_TLS_CERT_PATH  - path to a client .pem cert, only needed when
//                            the URI uses MONGODB-X509 auth (e.g. via a
//                            Render "Secret File" mounted at /etc/secrets/*)
//   MONGODB_DB_NAME        - defaults to "surveyscramble_data"

const { MongoClient } = require('mongodb');

let client = null;
let db = null;
let connecting = null;

async function connectMongo() {
  if (db) return db;
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[mongo] MONGODB_URI not set — game session analytics are disabled.');
    return null;
  }

  const options = {};
  if (process.env.MONGODB_TLS_CERT_PATH) {
    options.tlsCertificateKeyFile = process.env.MONGODB_TLS_CERT_PATH;
  }

  connecting = (async () => {
    try {
      client = new MongoClient(uri, options);
      await client.connect();
      db = client.db(process.env.MONGODB_DB_NAME || 'surveyscramble_data');
      console.log('[mongo] Connected — game session analytics enabled.');

      // Best-effort — querying by room or time range is the common case,
      // and index creation is a no-op if these already exist.
      db.collection('gamesessions')
        .createIndexes([{ key: { roomCode: 1 } }, { key: { gameStartedAt: -1 } }])
        .catch((e) => console.error('[mongo] Index creation failed:', e.message));

      // Unique per username since that's the upsert key in recordPlayerResults.
      db.collection('players')
        .createIndexes([{ key: { username: 1 }, unique: true }])
        .catch((e) => console.error('[mongo] Player index creation failed:', e.message));

      return db;
    } catch (e) {
      console.error('[mongo] Connection failed — analytics disabled:', e.message);
      client = null;
      db = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

function getDb() {
  return db;
}

// Rolling per-player stats across every game ever played, keyed by username
// (mirrors the `players` collection pattern from the emoji-munchers project:
// bestScore / gamesPlayed / lastPlayedAt / totalScore, upserted once per
// player each time a game session finishes). This is a derived summary, not
// the source of truth — gamesessions holds the full per-round/per-guess
// detail this is aggregated from.
async function recordPlayerResults(players) {
  if (!db || !players || !players.length) return;
  const collection = db.collection('players');
  const now = new Date();

  await Promise.all(
    players.map((p) =>
      collection
        .updateOne(
          { username: p.username },
          {
            $inc: { gamesPlayed: 1, totalScore: p.finalScore },
            $max: { bestScore: p.finalScore },
            $set: { lastPlayedAt: now },
          },
          { upsert: true }
        )
        .catch((e) => console.error(`[mongo] Failed to update player stats for "${p.username}":`, e.message))
    )
  );
}

module.exports = { connectMongo, getDb, recordPlayerResults };
