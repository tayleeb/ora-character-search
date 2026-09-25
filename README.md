# ORA character search for Railway

Deploy this folder as a Node.js service on Railway.  After Railway generates a public domain, the endpoint is:

`https://YOUR-RAILWAY-DOMAIN/search-users?query=USERNAME`

Use `/health` to check that the service is live.

The service queries Roblox's public user-search API, returns at most 20 public results, caches searches for one minute, and has a small rate limit to reduce abuse.
