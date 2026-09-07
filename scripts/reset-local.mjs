import { resetLocalDatabase, localD1 } from './local-db.mjs';
await resetLocalDatabase();
await localD1();
console.log('Reset .local-data/webrtc-room.sqlite and applied schema');
