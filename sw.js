// A minimal service worker to satisfy PWA installation requirements
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installed');
});

self.addEventListener('fetch', (event) => {
    // This empty fetch handler is required by Chrome to trigger the install prompt
});