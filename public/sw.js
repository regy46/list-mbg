// Simple Service Worker for PWA
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first or cache-first strategy could go here
  // For now, just a pass-through
  event.respondWith(fetch(event.request));
});
