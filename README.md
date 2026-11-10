# Hammy Run

A responsive hamster runner with wallet-authenticated play, server-verified seed collection, a separate HAMS reward token, and official Squeekchain SQK staking on Ethereum Sepolia.

## Run locally

Requires Node.js 24.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:4187. `npm run dev` enables Vite hot reload.

The default reward administrator is **0xB804d506d5446b1A3BeBEfC903D84F754973C2D2**, as selected by the project owner. No private key is configured or stored.

## Player flow

1. Connect an injected Ethereum wallet on Sepolia. Mobile users can open the site in their wallet's in-app browser. The wallet signs an expiring, single-use sign-in message.
2. Run, jump with Space / ↑ / W or tap the garden, and double-jump by pressing again. Press P to pause. Leaving the game tab pauses a run. Finish via collision or the pause menu.
3. The server replays the same fixed-step deterministic engine with a server-issued seed and the submitted jump timestamps. Only the replay-derived seed count is banked, once per run.
4. Once the administrator publishes verified cumulative point totals, players can stake points. Each point reserves 0.01 HAMS. After 600 seconds, claim the HAMS in the wallet. Staked points are spent; they are not returned. This is a fixed testnet reward, not an APY.

## Deployed HAMS rewards

HAMS and its point staking logic are deployed together at **[0x90eFD23244E00A991c0F28A059858718fA04ee0e](https://eth-sepolia.blockscout.com/address/0x90eFD23244E00A991c0F28A059858718fA04ee0e)** on Sepolia. The verified deployment is saved in `deployments/hammy-sepolia.json` and used as the default if no database registration or explicit environment configuration is present.

The deployment screen and its desktop/mobile navigation entries have been removed. Players use **My rewards** to stake published points and claim HAMS. The deployed code, administrator, fixed reward rate, lock period and cap were verified onchain, and the current published root has a matching saved proof tree.

For subsequent points publications, connect the administrator wallet, open **My rewards**, and use **Publish new points → Review points publication**. This control is visible only to the configured administrator; the API independently requires that administrator's authenticated session. After review, the administrator signs in their wallet. No new deployment is needed.

Publication is manual by design: no administrator signing key exists on the server. Players can use their previous published points while newer scores wait for publication. The administrator is a trusted score publisher and can publish arbitrary roots; the token cap and per-wallet used-point accounting are independently enforced by the contract.

When an administrator has collected points but none ready to stake, **Publish points to enable staking** opens a publication review directly. The owner panel displays the number of new points across all players and disables publication when that count is zero. The API rejects duplicate or regressing publications and refuses to proceed if a previous proof tree is missing. Publication is rechecked against the latest chain state before signing. Trees always contain cumulative totals: older points carry forward, while the deployed contract's `usedPoints` accounting prevents their reuse. Duplicate-root protection is in the app/API; the existing deployed contract itself still permits an owner to publish a root again.

HAMS has a fixed 10,000,000-token cap including reserved, unclaimed rewards. No premint or direct owner mint exists. The contract is restricted to chain ID 11155111. It is an independent game token, **not SQK**, and the official Squeekchain contracts cannot stake HAMS or game points.

## HAMS staking pool

Open **Staking pools → HAMS pool** to stake existing HAMS separately from game point locks and official SQK staking. `contracts/HamsStakingPool.sol` distributes HAMS funded by its owner, without minting tokens or using deposited principal as rewards. Principal has no lock or exit fee. A full withdrawal preserves accrued rewards for a later claim. Rewards pause while nobody is staked; top-ups combine undistributed rewards with new funding and restart the selected duration (60 seconds–30 days). The UI displays the actual funded budget and shows when rewards are exhausted, without projecting an APY.

The pool is deployed on Sepolia at **[0xa20e79fcb0e08e33e424c2521ed9472e051b421c](https://eth-sepolia.blockscout.com/address/0xa20e79fcb0e08e33e424c2521ed9472e051b421c)** and linked in the app. The administrator deployed it in transaction `0x535b737301982c899fc3ac33758a9930e369761042606cbbaa9f094358ab944e`. Its transaction sender and creation input, runtime bytecode, HAMS token binding, owner and canonical block were verified. The deployment record is saved in `deployments/hams-pool-sepolia.json`; the app reads the registered address and transaction from SQLite. At the verification block 12106656, the pool had no stakes or funded rewards.

For an interrupted registration, **Already deployed this pool? → Link deployed pool** recovers the existing deployment without sending another transaction. The deployment transaction hash is saved in session storage before waiting for confirmations.

Once deployed, its owner can fund rewards using HAMS already in the wallet. Funding commits those tokens to stakers and cannot be reclaimed by the owner. Approval and funding are separate reviews; approvals are for the exact requested amount. Staking also uses separate approval and stake transactions. Each action verifies the pool, reads the live balance/allowance or ownership, simulates, and rechecks before wallet signing. The wallet signs every Sepolia transaction; the server holds no keys.

## Squeekchain integration

The published skill archive was fetched from the discovery index and verified against SHA-256 `8d5669a1f0154497e0bdec7dfe11949760f4d35d134b33f58d9f28c0d3e6a318`. Its full documentation, ABIs and deployment record are in `.agents/skills/squeekchain/`.

`server/chain.mjs` verifies the live documentation against the pinned record and checks the chain ID, three proxy implementation/admin slots, runtime hashes, layout digests, ProxyAdmin owners, guarded proxy identities, immutable token/NFT runtime hashes, contract bindings and supply/funding reconciliation. Reads use one block with a hash recheck. A mismatch stops the SQK flow.

Balances are direct contract reads, with unknown data shown as unavailable. SQK staking uses exact ERC-20 approvals, live allowance and balance checks, and separate approval/stake transactions. Claims check `claimRecipient`. Unstaking quotes and displays the burned fee, bounds it with `maxFee`, and uses a five-minute deadline. Every action is simulated and reviewed before the user's wallet signs. Pending transactions are retained across reloads to prevent automatic duplicate submission.

Only fungible SQK stake, unstake, claim and compound are in this UI. It does not perform NFT deposits or merges.

These controls are available under **Staking pools → SQK · Squeekchain**.

## Hosting and storage

For a Vercel frontend with a Railway backend, follow **[DEPLOYMENT.md](DEPLOYMENT.md)**. `vercel.mjs` routes browser `/api` requests to `RAILWAY_API_URL`. Set Railway's `PUBLIC_ORIGIN` to the Vercel production origin so wallet sign-in and API origin checks agree. SQLite stays on Railway's `/data` volume; migrate the existing game database before switching players over.

`Dockerfile` and `railway.toml` are provided for a persistent deployment. Mount a durable volume at `/data`; do not run independent replicas with separate SQLite databases. Back up the database, including the saved Merkle trees: losing those trees can make published points unavailable to prove. WAL mode is enabled.

| Variable          | Default                        | Purpose                                                                                                                                            |
| ----------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `4187` (Docker: `8080`)        | HTTP listener                                                                                                                                      |
| `DATA_DIR`        | `data` (Docker: `/data`)       | SQLite storage directory                                                                                                                           |
| `ADMIN_ADDRESS`   | Owner-selected wallet above    | Trusted game administrator                                                                                                                         |
| `RPC_URL`         | Public Sepolia RPC failover    | Server chain reads and simulations                                                                                                                 |
| `PUBLIC_ORIGIN`   | Request origin                 | Canonical website origin for sign-in messages and browser API writes. Set to the Vercel production origin when proxying from Vercel.                 |
| `RAILWAY_API_URL` | Required on Vercel              | Railway public HTTPS origin used by Vercel's API rewrite. Not required on Railway itself.                                                            |
| `REWARD_CONTRACT` | Verified deployed HAMS address | Optional override when no database registration exists; still bytecode-checked. An explicitly empty value disables the default for isolated tests. |

Serve over HTTPS. The production server uses HttpOnly, Secure, SameSite=Strict cookies, request origin checks, a restrictive content security policy and API rate limits. It does not add a separate website sign-in gate; wallet authentication only controls play and account actions.

The Cloudflare quick preview uses the local server and is temporary. A permanent deployment needs a renewed hosting login and durable storage. `scripts/public-preview.mjs` runs the downloaded Cloudflare binary at `/tmp/hammy-cloudflared`.

## Validation

```sh
npm test
npm run check:browser
node scripts/check-pools.mjs
npm run verify:squeek
npm audit
```

Tests cover score determinism, malformed transcripts, double-jump limits, wallet signature replay protection, forged identities, server timing bounds, duplicate score submission, administrator authorization, proof ownership, point double-spending, the onchain lock, duplicate claims, and reward caps. Contract integration tests use ephemeral Anvil accounts through JSON-RPC; they never read private keys. Install Foundry or set `ANVIL_BIN` for the contract test. Browser checks use Playwright and a local Anvil wallet; set `CHROME_BIN` to your Chromium executable. Test screenshots are in `test-results/` and excluded from version control.

Pool tests also cover exact approvals, reward sharing between two stakers, solvency after withdrawals and claims, empty-pool pauses, top-ups, authorization, duplicate registration recovery, incorrect token bindings and altered runtime code. `scripts/check-pools.mjs` runs the complete owner publication/claim and pool deployment/funding/staking/withdrawal/claim journey against an isolated database and disposable Anvil chain. All browser wallet calls and RPC requests in that script stay local. It also checks ordinary-player isolation and pool layouts at 320, 390, 768 and 1440 pixels.

Server replay prevents a player from simply inventing a score. It does not prove human play: deterministic games can be automated, and a production reward economy would need additional anti-bot and abuse controls. These are valueless testnet tokens.

## Code navigation

- `shared/engine.mjs`: deterministic simulation shared by the game and verifier.
- `src/game/`: canvas garden, hamster sprite and gameplay controls.
- `src/App.tsx`: navigation, wallet sign-in and transaction review.
- `src/Rewards.tsx`: HAMS point rewards, publication and SQK controls.
- `src/Pools.tsx`: pool selector, HAMS pool controls and owner deployment/funding.
- `server/index.mjs`: authentication, verified runs, rewards and administrator API.
- `server/store.mjs`: SQLite records and cumulative score Merkle trees.
- `server/chain.mjs`: Squeekchain graph verification and unsigned transaction preparation.
- `server/game-chain.mjs`: shared HAMS deployment identity verification.
- `server/hams-pool.mjs`: verified HAMS pool snapshots, unsigned calls and deployment registration.
- `contracts/HammyRewards.sol`: capped HAMS ERC-20 and point reward locks.
- `contracts/HamsStakingPool.sol`: separate pool for staking existing HAMS against an owner-funded reward stream.

Visuals are rendered locally in Canvas. Fonts are self-hosted; no image generation service or external asset API is needed.
