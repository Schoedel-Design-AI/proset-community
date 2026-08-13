(function () {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const clearBarryCaches = async () => {
    if (!("caches" in window)) return;
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => /^aiforms-v\d+$/i.test(name))
        .map((name) => caches.delete(name))
    );
  };

  const unregisterBarryWorkers = async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(async (registration) => {
        const scriptUrl = registration.active?.scriptURL
          || registration.waiting?.scriptURL
          || registration.installing?.scriptURL
          || "";

        if (scriptUrl.includes("/service-worker.js")) {
          await registration.unregister();
        }
      })
    );
  };

  window.addEventListener("load", () => {
    unregisterBarryWorkers()
      .then(clearBarryCaches)
      .catch(() => {});
  }, { once: true });
})();
