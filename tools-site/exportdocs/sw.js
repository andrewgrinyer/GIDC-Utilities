/* A tombstone.

   Earlier builds of this site shipped a service worker that cached whatever
   the network returned, errors included. Those registrations are still on
   people's machines and keep serving what they kept. A browser checks this
   file for a new version on navigation, so putting this here retires them:
   it clears every cache, unregisters itself, and reloads the open tabs.

   This site does not use a service worker any more. Leave the file in place.
   Removing it would let the old worker live on, because a 404 here does not
   unregister anything. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for(const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for(const client of await self.clients.matchAll({type: 'window'})){
      try{ client.navigate(client.url); }catch(e){}
    }
  })());
});
