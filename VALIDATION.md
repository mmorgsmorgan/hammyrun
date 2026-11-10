# Validation — 10 November 2026

- Production build and TypeScript checks passed.
- Eight Node test cases passed, including complete API/contract integration flows on local Anvil chains configured with chain ID 11155111.
- The integration case exercised wallet authentication, nonce replay rejection, forged signatures, real-time score bounds, deterministic replay, idempotent score submission, owner-only publication, wallet-bound proofs, double-spend rejection, lock expiry, reward claims, duplicate claim rejection and the HAMS cap.
- Interactive browser checks passed for wallet sign-in, keyboard/double-jump controls, pause/resume, preserving a paused run across navigation, verified score saving, leaderboard, admin isolation, disconnect and modal focus behavior.
- Responsive checks covered widths 320, 390, 768, 844 and 1440 pixels. The final 390px public check measured a 350px game frame and 348px canvas/intro, without document overflow.
- Public HTTPS preview returned HTTP 200 with a production content security policy. Sign-in cookies were Secure, HttpOnly and SameSite=Strict. No page errors were observed in the final public check.
- Live Squeekchain graph and account snapshot verified on Sepolia at block **12104202**, hash `0x966c1a49c7e330103678995e0cc91ccec2ed4bb5a9bf7942f166b65ec0e7fc28`. The first public snapshot check timed out; subsequent direct and browser reads passed. RPC failures remain unavailable in the UI and do not enable transactions.
- `npm audit` and the production dependency audit reported zero known vulnerabilities after dependency updates.

## Deployment status

Public preview: https://limited-facilitate-bracelet-proven.trycloudflare.com

The preview is served by the local production server through a temporary Cloudflare quick tunnel. Existing Railway and Vercel credentials were expired; no permanent deployment was claimed.

The owner deployed HAMS at **0x90eFD23244E00A991c0F28A059858718fA04ee0e** and published a points root. The deployment was verified at Sepolia block **12104302**, hash `0xcc28630c0479aa1035f3d593d2ca9945f72d61ad4e39c4885d2441dbf0b62f05`: bytecode matches the compiled artifact, owner is `0xB804d506d5446b1A3BeBEfC903D84F754973C2D2`, lock is 600 seconds, each point earns 0.01 HAMS, and the cap is 10 million HAMS. Published root `0xdc970864ad68db0f4f5750db279b6a73e1a18fe9e766be970d16409c32209d62` has its proof tree saved in the game database.

The address is now also saved in `deployments/hammy-sepolia.json`. The deployment screen was removed; future score publications remain available to the owner within My rewards. Existing game data and published proofs were preserved. No blockchain transaction was sent by the coding agent while linking the deployment.

Post-link checks passed on the public HTTPS site: HAMS rewards active at the registered address, Reward setup absent on desktop and mobile, publication controls hidden from ordinary players, live Squeekchain verification successful, and no page errors. A live `stakePoints` simulation for 99 available published points passed at Sepolia block 12104439 without submitting a transaction. The production build and all four automated test cases also passed.

The coding agent did not request, read or store an owner private key. Local tests used Anvil's ephemeral unlocked JSON-RPC accounts without accessing their keys. Automated gameplay test data was removed from the preview leaderboard.

## Resumed session: publication protection and HAMS pool

- Duplicate or regressing point publication is rejected by the API. The owner panel shows **All points published** when the global unpublished delta is zero. The publication review rechecks the live root before signing. Consumed-point protection remains onchain; duplicate-root protection is application-level because the original deployment is unchanged.
- A fresh read at Sepolia block **12106489** found 291 collected, zero published and zero used points for the owner. The other recorded player has 99 published points. The published proof tree remains available.
- `HammyRewards` retains runtime hash `0x70e35febd28b079bd48b7b26e37c8583505028b704f8af8ee50688eb332bffb1`; the test suite asserts this after compilation.
- The separate HAMS staking pool is implemented with owner-funded rewards, empty-pool pauses, unrestricted principal withdrawals and no exit fee. Tests verified two-staker distribution, accrued rewards after withdrawal, top-ups preserving remaining rewards, budget/principal solvency, exact approvals, authorization, idempotent registration, rejection of replacement deployments, token binding and runtime verification.
- Browser checks ran the complete publication → point stake → HAMS claim → pool deployment → registration → approval/funding → approval/stake → withdrawal → reward claim flow against isolated test data and a disposable Anvil chain. Owner-only controls were absent for ordinary players. Layouts passed at 320, 390, 768 and 1440 pixels with no browser errors.
- The HAMS pool was initially awaiting the administrator's deployment; the subsequent confirmed deployment is recorded below. The agent sent no live blockchain transactions.
- The final production build passed and the public preview was restarted at the URL above. Public HTTPS checks passed for secure wallet sign-in, active HAMS point rewards, the new HAMS pool card, ordinary-player isolation, live SQK graph verification, and absence of browser errors. The 390px viewport had a 350px game frame and a 348px scene without overflow. The first SQK documentation fetch failed and disabled its actions; a subsequent check fetched the live record and passed verification.

## Owner-deployed HAMS pool

The owner deployed and registered **0xa20e79fcb0e08e33e424c2521ed9472e051b421c** in transaction `0x535b737301982c899fc3ac33758a9930e369761042606cbbaa9f094358ab944e` at Sepolia block **12106533**. Read-only verification at block **12106656** confirmed the canonical deployment receipt, expected creation input, exact runtime hash `0x71dac5f963a906084ba85991236258cde2843b299b3aa7d0247450c1477f91cf`, owner `0xB804d506d5446b1A3BeBEfC903D84F754973C2D2`, and binding to the game's HAMS token. The public app config exposes this registered pool address.

At that block the pool had zero staked HAMS and zero funded rewards, and the owner's HAMS wallet balance was zero. Funding remains a separate owner-wallet action after obtaining HAMS from the point rewards. `scripts/inspect-hams-pool.mjs` provides a repeatable read-only check of deployment identity, ownership, token binding, balances and solvency. The verified deployment is recorded in `deployments/hams-pool-sepolia.json`.

Post-deployment public browser checks passed: the live HAMS pool card reads the registered address, ordinary players cannot see owner funding/deployment controls, secure wallet sign-in and live SQK verification work, and no browser errors were observed. A point-ledger read at block 12106661 found 291 published/used points for the owner, plus 46 newly collected points awaiting publication.
