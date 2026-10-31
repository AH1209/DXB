const CACHE = 'dxb-shell-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', '/icons/icon-192.png', '/icons/icon-512.png'])),
  );
  self.skipWaiting();
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ]),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.netlify/')
  )
    return;
  if (event.request.mode === 'navigate')
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/')),
    );
  else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
});
function badgeStore(action, id) {
  return new Promise((resolve) => {
    const request = indexedDB.open('dxb-badges', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const get = store.get('state');
      let count = 0;
      get.onsuccess = () => {
        const data = get.result || { ids: [], count: 0 };
        if (action === 'clear') data.count = 0;
        else if (!data.ids.includes(id)) {
          data.count++;
          data.ids = [...data.ids.slice(-999), id];
        }
        count = data.count;
        store.put(data, 'state');
      };
      tx.oncomplete = () => {
        database.close();
        resolve(count);
      };
      tx.onerror = () => {
        database.close();
        resolve(0);
      };
    };
  });
}
self.addEventListener('push', (event) =>
  event.waitUntil(
    (async () => {
      let data = {
        title: 'DXB',
        body: 'Simulation notification',
        id: String(Date.now()),
        contactId: null,
        badge: true,
      };
      try {
        data = { ...data, ...event.data.json() };
      } catch {
        /* Still show a visible notification for malformed payloads. */
      }
      const count = await badgeStore('add', data.id);
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `dxb-${data.id}`,
        data: { contactId: data.contactId },
        renotify: false,
      });
      if (data.badge && self.navigator.setAppBadge)
        await self.navigator.setAppBadge(count).catch(() => {});
      if (!data.badge && self.navigator.clearAppBadge)
        await self.navigator.clearAppBadge().catch(() => {});
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((client) => client.postMessage({ type: 'DXB_PUSH' }));
    })(),
  ),
);
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.contactId;
  const path = id && /^[a-f0-9-]{36}$/i.test(id) ? `/?contact=${id}` : '/';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        await client.navigate(path);
        await client.focus();
      } else await self.clients.openWindow(path);
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_BADGE')
    event.waitUntil(
      (async () => {
        await badgeStore('clear');
        if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      })(),
    );
});
self.addEventListener('pushsubscriptionchange', (event) =>
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window' })
      .then((clients) =>
        clients.forEach((client) => client.postMessage({ type: 'DXB_SUBSCRIPTION_CHANGED' })),
      ),
  ),
);
