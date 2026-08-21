(function () {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const clearProsetCaches = async () => {
    if (!("caches" in window)) return;
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        // Proset cache names (plus legacy "aiforms-*" names from older
        // instances, so a rename never strands stale cached app shells).
        .filter((name) => /^(proset|aiforms)-v\d+$/i.test(name))
        .map((name) => caches.delete(name))
    );
  };

  const unregisterProsetWorkers = async () => {
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
    unregisterProsetWorkers()
      .then(clearProsetCaches)
      .catch(() => {});
  }, { once: true });
})();
