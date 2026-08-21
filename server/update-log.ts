export type UpdateLogEntry = {
  id: string;
  version: string;
  title: string;
  summary: string;
  publishedAt: string;
};

const UPDATE_LOG_ENTRIES: UpdateLogEntry[] = [
  {
    id: "2026-07-20-cloud-sync-persistence",
    version: "v0.9.9",
    title: "Cloud sync connection persistence fix",
    summary:
      "Fixed an issue where the Cloud Sync toggle and backup provider connections could appear reset after a server update. The settings page no longer permanently disables cloud sync based on a single subscription check; backup provider credentials now degrade gracefully if the encryption key rotates, showing a reconnect prompt instead of a blank list.",
    publishedAt: "2026-07-20T12:00:00.000Z",
  },
  {
    id: "2026-04-30-cloud-backup",
    version: "v0.9.8",
    title: "One-click cloud backup",
    summary:
      "Added one-click Connect buttons for Google Drive, OneDrive, and Dropbox backup. Recordings and conversions are automatically backed up to a 'Proset' folder organized by date.",
    publishedAt: "2026-04-30T04:00:00.000Z",
  },
  {
    id: "2026-04-29-auth-persistence-fix",
    version: "v0.9.7",
    title: "Admin password persistence fix",
    summary:
      "Fixed an issue where admin passwords changed through the app were silently overwritten on every server restart. Also corrected the mobile deep-link scheme from legacy naming.",
    publishedAt: "2026-04-29T23:00:00.000Z",
  },
  {
    id: "2026-03-31-catholic-module",
    version: "v0.9.5",
    title: "Catholic Ecumenical module opt-in",
    summary:
      "Added a self-serve Catholic Ecumenical module for eligible paid users, with account-level activation and module-aware conversion gating.",
    publishedAt: "2026-03-31T18:00:00.000Z",
  },
  {
    id: "2026-03-31-ship-cleanup",
    version: "v0.9.4",
    title: "Shipping cleanup pass",
    summary:
      "Simplified account settings, removed unfinished integration surfaces, clarified plan options, and tightened production billing behavior.",
    publishedAt: "2026-03-31T12:00:00.000Z",
  },
  {
    id: "2026-03-27-production-cutover",
    version: "v0.9.3",
    title: "Production cutover",
    summary:
      "Moved the app onto Dokploy-managed hosting, verified HTTPS, and stabilized production auth, storage, and billing entry flows.",
    publishedAt: "2026-03-27T12:00:00.000Z",
  },
  {
    id: "2026-03-26-storage-rollout",
    version: "v0.9.2",
    title: "Cloud storage rollout",
    summary:
      "Activated DigitalOcean Spaces for authenticated file storage and verified upload, download, and deletion through the live app.",
    publishedAt: "2026-03-26T12:00:00.000Z",
  },
  {
    id: "2026-03-24-local-hardening",
    version: "v0.9.1",
    title: "Local and CI hardening",
    summary:
      "Added Docker-backed PostgreSQL setup, tightened local environment defaults, and restored the core build and verification pipeline.",
    publishedAt: "2026-03-24T12:00:00.000Z",
  },
];

export function getUpdateLogEntries(): UpdateLogEntry[] {
  return [...UPDATE_LOG_ENTRIES].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );
}
