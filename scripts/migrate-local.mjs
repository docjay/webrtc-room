import { localD1 } from './local-db.mjs';
await localD1();
console.log('Applied Worker-compatible schema to .local-data/webrtc-room.sqlite');
