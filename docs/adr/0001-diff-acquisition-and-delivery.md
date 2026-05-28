# Diff acquisition and delivery

GitHub pull request targets are remote snapshots: the server starts fetching the public PR `.diff` immediately, exposes fetch status/progress to the browser, caches the fetched patch for the life of the yadiff process, and does not refetch on browser reload. Local git and jj targets keep their existing live lazy behavior, because browser reload should reflect ongoing local working-tree changes without restarting yadiff.

The browser fetches target metadata separately from raw patch text (`/api/raw.diff`) instead of receiving the patch embedded in JSON. This avoids large JSON payload overhead for huge diffs, keeps GitHub progress/status separate from raw delivery, and lets the browser parse the patch once per raw patch while the server remains responsible only for acquiring diff text.
