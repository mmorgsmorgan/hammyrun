# Vercel frontend + Railway backend

Deploy this same GitHub repository to both platforms. Vercel serves the Vite frontend; requests to `/api/*` are forwarded to Railway. Railway runs Express and owns the persistent SQLite database. The HAMS and SQK contracts remain on Sepolia.

## 1. Railway

Connect the repository and deploy its root directory using the existing Dockerfile. Keep one replica. Attach a persistent volume to the service with mount path `/data`, and enable backups.

Set these service variables (the Dockerfile already supplies the first three):

```env
NODE_ENV=production
PORT=8080
DATA_DIR=/data
ADMIN_ADDRESS=0xB804d506d5446b1A3BeBEfC903D84F754973C2D2
REWARD_CONTRACT=0x90eFD23244E00A991c0F28A059858718fA04ee0e
```

Generate a public Railway HTTPS domain targeting port **8080**. Verify `/api/health` returns `{"ok":true,"game":"Hammy Run"}`.

Once the Vercel production domain is known, add this variable on **Railway** and redeploy:

```env
PUBLIC_ORIGIN=https://YOUR-VERCEL-PRODUCTION-DOMAIN
```

Use the website's exact origin, without a path. This controls the domain shown in wallet sign-in messages and the allowed browser origin for API writes. With it configured, open the website through that Vercel domain. `RPC_URL` is optional; leaving it unset preserves the existing public Sepolia RPC failover.

## 2. Vercel

Import the same repository, using the root directory. The checked-in `vercel.mjs` config selects **Vite**, builds with **`npm run build`**, and serves **`dist`**. The repository pins Node **24.x**. It does not deploy the Express server or SQLite to Vercel.

Add this environment variable on **Vercel** before building:

```env
RAILWAY_API_URL=https://YOUR-SERVICE.up.railway.app
```

Use the Railway service's public HTTPS origin without an `/api` suffix. The configuration preserves `/api` while forwarding requests. Missing values, non-HTTPS URLs, embedded credentials and path/query suffixes fail configuration validation rather than deploying a broken API route. Redeploy Vercel after changing this value.

Keep the production website publicly accessible in Deployment Protection settings. Wallet sign-in is handled by the app. No Vercel or platform sign-in gate is required for players.

The browser continues calling `/api` on its own domain. Session cookies remain `Secure`, `HttpOnly` and `SameSite=Strict`; direct cross-site API calls and `SameSite=None` cookies are unnecessary. API responses are marked `no-store` at the backend and Vercel, so wallet-specific responses are not cached by the CDN.

## 3. Migrate existing game data before switching players over

GitHub intentionally excludes `data/hammy.sqlite`. A newly deployed Railway service starts with an empty database until the existing data is migrated.

Create a consistent SQLite backup of the live database, then restore it as **`/data/hammy.sqlite`** on Railway while writes are stopped. SQLite uses WAL mode: use SQLite's backup API or a clean shutdown/checkpoint; copying only a live `.sqlite` file can miss recent writes. Stop both the old preview and the Railway service from accepting game writes during the final copy, then start Railway and verify its state before directing players to Vercel.

Preserve the complete game ledger, saved Merkle proof trees, and settings including `rewardContract`, `hamsPool` and `hamsPoolDeployment`. The registered HAMS pool is **`0xa20e79fcb0e08e33e424c2521ed9472e051b421c`**. A missing registration on an empty server is a data migration issue; use the existing deployment rather than deploying a replacement pool.

Do not commit the database, wallet session cookies, or private configuration to GitHub. A local migration backup is not a replacement for backups of Railway's persistent volume.

## 4. Verify the production connection

1. Open `https://YOUR-VERCEL-PRODUCTION-DOMAIN/api/health` and `/api/config`. Confirm the HAMS token and registered pool addresses.
2. Connect a wallet on the Vercel site. The sign-in message must show the Vercel production domain.
3. Verify the account's saved points and rewards and check both staking pool screens.
4. Run a short game and confirm its score is saved once.
5. Confirm the old preview is no longer accepting writes against a separate database.

Backend tests exercise the full wallet, scoring and reward flow through a separate frontend proxy. They also verify that unrelated browser origins are rejected and API responses cannot be cached. Run `npm run build` followed by `npm test` for local verification.

Use a separate Railway service and database for preview environments. The production API accepts its configured `PUBLIC_ORIGIN`; unrelated Vercel preview URLs are not automatically authorized.

Sources: [Vercel external rewrites](https://vercel.com/docs/routing/rewrites), [programmatic Vercel configuration](https://vercel.com/docs/project-configuration/vercel-ts), and [Railway volumes](https://docs.railway.com/reference/volumes).
