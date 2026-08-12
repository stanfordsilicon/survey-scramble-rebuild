// Storage abstraction for room state.
//
// Everything the game touches goes through this module instead of a raw Map,
// and every room/player is a plain JSON-serializable object (no class
// instances, no closures) — that's what makes both backends below
// interchangeable without game/roomManager.js knowing which one is live.
//
// Locally (no MONGODB_URI set) rooms live in an in-memory Map, same as
// always -- zero setup needed to run the game. On a serverless host like
// Vercel, every request can land on a different, isolated instance with its
// own empty Map, so room state has to live somewhere shared: MongoDB, reusing
// the same connection already used for gamesession/player analytics.

const { connectMongo, getDb } = require('../data/mongo');

class InMemoryRoomStore {
  constructor() {
    this._rooms = new Map();
  }

  async getRoom(roomCode) {
    return this._rooms.get(roomCode) || null;
  }

  async saveRoom(room) {
    this._rooms.set(room.roomCode, room);
    return room;
  }

  async deleteRoom(roomCode) {
    this._rooms.delete(roomCode);
  }

  async listRoomCodes() {
    return Array.from(this._rooms.keys());
  }
}

class MongoRoomStore {
  async _col() {
    await connectMongo();
    const db = getDb();
    if (!db) throw new Error('MongoDB is not connected — cannot store room state.');
    return db.collection('rooms');
  }

  async getRoom(roomCode) {
    const col = await this._col();
    const doc = await col.findOne({ _id: roomCode });
    if (!doc) return null;
    const { _id, updatedAt, ...room } = doc;
    return room;
  }

  async saveRoom(room) {
    const col = await this._col();
    await col.updateOne(
      { _id: room.roomCode },
      { $set: { ...room, updatedAt: new Date() } },
      { upsert: true }
    );
    return room;
  }

  async deleteRoom(roomCode) {
    const col = await this._col();
    await col.deleteOne({ _id: roomCode });
  }

  async listRoomCodes() {
    const col = await this._col();
    const docs = await col.find({}, { projection: { _id: 1 } }).toArray();
    return docs.map((d) => d._id);
  }
}

function createRoomStore() {
  return process.env.MONGODB_URI ? new MongoRoomStore() : new InMemoryRoomStore();
}

module.exports = createRoomStore();
