# Hammy Run

Use Node 24. Run `npm run build` and `npm test` for changes affecting rewards, auth or scoring.

Keep HAMS game rewards separate from Squeekchain SQK. Never imply game points produce official SQK. The owner selected wallet is `0xB804d506d5446b1A3BeBEfC903D84F754973C2D2`.

For Squeekchain integrations read `.agents/skills/squeekchain/SKILL.md` and the relevant bundled reference. Official contract addresses and ABIs come exclusively from that published record. Verification failures disable actions. Every transaction must be simulated and handed to the connected wallet for signing; never read, request or store a private key.

Preserve the shared deterministic engine between browser and server. Never accept a client score. Use durable SQLite storage and retain published Merkle trees. Changes to the HAMS contract need a new artifact, tests and an owner-signed deployment.

The garden and hamster are Canvas game assets. Do not treat the temporary Cloudflare tunnel as permanent hosting. Do not add a platform sign-in gate to previews; wallet authentication is part of the game itself.
