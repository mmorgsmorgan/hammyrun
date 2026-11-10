import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, getAddress, verifyMessage, keccak256 } from "viem";
import {
  db,
  setSetting,
  buildPublication,
  publicationStatus,
  proofFor,
} from "./store.mjs";
import { replay, RULES } from "../shared/engine.mjs";
import {
  client,
  same,
  squeekSnapshot,
  prepareSqueek,
  record,
} from "./chain.mjs";
import { gameAddress, gameContract } from "./game-chain.mjs";
import {
  poolAddress,
  poolSnapshot,
  preparePool,
  preparePoolDeployment,
  registerPool,
} from "./hams-pool.mjs";

const app = express(),
  production = process.env.NODE_ENV === "production";
const ADMIN = getAddress(
  process.env.ADMIN_ADDRESS || "0xB804d506d5446b1A3BeBEfC903D84F754973C2D2",
);
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: [
              "'self'",
              "https://ethereum-sepolia-rpc.publicnode.com",
              "https://sepolia.drpc.org",
            ],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
  }),
);
app.use(express.json({ limit: "100kb" }));
app.set("json replacer", (_, v) => (typeof v === "bigint" ? v.toString() : v));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    req.method === "POST" &&
    req.headers.origin &&
    req.headers.origin !== `${req.protocol}://${req.get("host")}`
  )
    return res.status(403).json({ error: "Origin mismatch." });
  next();
});
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const cleanAddress = (a) => {
  if (!isAddress(a || "")) throw fail("A valid wallet address is required.");
  return getAddress(a).toLowerCase();
};
const sha = (t) => createHash("sha256").update(t).digest("hex");
function auth(req, res, next) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("hammy_session="))
    ?.slice(14);
  const session =
    token &&
    db
      .prepare("SELECT address FROM sessions WHERE token=? AND expires>?")
      .get(sha(token), Date.now());
  if (!session)
    return res
      .status(401)
      .json({ error: "Connect your wallet and sign in to continue." });
  req.account = session.address;
  next();
}
function admin(req, res, next) {
  if (!same(req.account, ADMIN))
    return res
      .status(403)
      .json({ error: "Only the configured reward administrator can do this." });
  next();
}
const artifact = () =>
  JSON.parse(fs.readFileSync("src/generated/HammyRewards.json", "utf8"));

app.get("/api/health", (_, res) => res.json({ ok: true, game: "Hammy Run" }));
app.get("/api/config", (_, res) =>
  res.json({
    chainId: record.chainId,
    admin: ADMIN,
    rewardContract: gameAddress(),
    hamsPool: poolAddress(),
    lockSeconds: 600,
    pointsPerToken: 100,
    squeek: record.contracts.SqueekStaking.address,
  }),
);
app.post(
  "/api/auth/challenge",
  rateLimit({ windowMs: 60000, limit: 12 }),
  asyncRoute(async (req, res) => {
    const address = cleanAddress(req.body.address),
      id = randomUUID(),
      expires = Date.now() + 300000;
    const origin =
      process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`;
    const message = `${new URL(origin).host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nSign in to Hammy Run to save verified game scores. This does not authorize any transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: 11155111\nNonce: ${randomBytes(16).toString("hex")}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
    db.prepare("INSERT INTO challenges VALUES(?,?,?,?)").run(
      id,
      address,
      message,
      expires,
    );
    res.json({ id, message });
  }),
);
app.post(
  "/api/auth/verify",
  rateLimit({ windowMs: 60000, limit: 12 }),
  asyncRoute(async (req, res) => {
    const challenge = db
      .prepare("DELETE FROM challenges WHERE id=? AND expires>? RETURNING *")
      .get(String(req.body.id), Date.now());
    if (!challenge)
      throw fail("Sign-in request expired or was already used.", 401);
    if (
      typeof req.body.signature !== "string" ||
      !(await verifyMessage({
        address: challenge.address,
        message: challenge.message,
        signature: req.body.signature,
      }))
    )
      throw fail("Wallet signature could not be verified.", 401);
    const token = randomBytes(32).toString("hex"),
      expires = Date.now() + 86400000;
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      sha(token),
      challenge.address,
      expires,
    );
    db.prepare("INSERT OR IGNORE INTO players(address) VALUES(?)").run(
      challenge.address,
    );
    res.cookie("hammy_session", token, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge: 86400000,
      path: "/",
    });
    res.json({ address: challenge.address });
  }),
);
app.post("/api/auth/logout", auth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE address=?").run(req.account);
  res.clearCookie("hammy_session", { path: "/" }).json({ ok: true });
});
app.get("/api/me", auth, (req, res) => {
  const player = db
    .prepare("SELECT * FROM players WHERE address=?")
    .get(req.account);
  const recent = db
    .prepare(
      "SELECT coins,distance,finished FROM runs WHERE address=? AND finished IS NOT NULL ORDER BY finished DESC LIMIT 5",
    )
    .all(req.account);
  res.json({ ...player, recent });
});
app.get("/api/leaderboard", (_, res) =>
  res.json(
    db
      .prepare(
        "SELECT address,best,coins,runs FROM players WHERE runs>0 ORDER BY best DESC,coins DESC LIMIT 25",
      )
      .all(),
  ),
);
app.post(
  "/api/runs",
  auth,
  rateLimit({ windowMs: 60000, limit: 20 }),
  (req, res) => {
    // A new run invalidates unfinished runs, preventing overlapping sessions.
    db.prepare("DELETE FROM runs WHERE address=? AND finished IS NULL").run(
      req.account,
    );
    const id = randomUUID(),
      seed = randomBytes(4).readUInt32LE(0),
      started = Date.now();
    db.prepare("INSERT INTO runs(id,address,seed,started) VALUES(?,?,?,?)").run(
      id,
      req.account,
      seed,
      started,
    );
    res.json({ id, seed, maxTicks: RULES.maxTicks });
  },
);
app.post(
  "/api/runs/:id/finish",
  auth,
  asyncRoute(async (req, res) => {
    const row = db
      .prepare("SELECT * FROM runs WHERE id=? AND address=?")
      .get(req.params.id, req.account);
    if (!row) throw fail("Run was not found.");
    if (row.finished !== null)
      return res.json({
        coins: row.coins,
        distance: row.distance,
        alreadySaved: true,
      });
    const elapsed = Date.now() - row.started;
    if (elapsed > 20 * 60000) throw fail("This run expired. Start a new run.");
    if ((req.body.ticks / 60) * 1000 > elapsed + 1200)
      throw fail("Run playback was faster than real time.");
    const result = replay(row.seed, req.body.jumps, req.body.ticks);
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db
        .prepare(
          "UPDATE runs SET finished=?,coins=?,distance=?,transcript=? WHERE id=? AND finished IS NULL",
        )
        .run(
          Date.now(),
          result.coins,
          result.distance,
          JSON.stringify({ jumps: req.body.jumps, ticks: req.body.ticks }),
          row.id,
        );
      if (changed.changes)
        db.prepare(
          "UPDATE players SET coins=coins+?,best=MAX(best,?),runs=runs+1 WHERE address=?",
        ).run(result.coins, result.distance, req.account);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json(result);
  }),
);
app.get(
  "/api/rewards",
  auth,
  asyncRoute(async (req, res) => {
    if (!gameAddress())
      return res.json({
        active: false,
        positions: [],
        proof: null,
        balance: "0",
      });
    const blockNumber = (await client.getBlockNumber()) - 2n,
      block = await client.getBlock({ blockNumber }),
      address = await gameContract(blockNumber),
      abi = artifact().abi;
    const rd = (functionName, args = []) =>
      client.readContract({ address, abi, functionName, args, blockNumber });
    const [root, balance, used, count, owner] = await Promise.all([
      rd("pointsRoot"),
      rd("balanceOf", [req.account]),
      rd("usedPoints", [req.account]),
      rd("positionCount", [req.account]),
      rd("owner"),
    ]);
    const positions = await Promise.all(
      Array.from(
        { length: Number(count > 100n ? 100n : count) },
        async (_, i) => {
          const id = Number(count) - 1 - i;
          const p = await rd("positions", [req.account, BigInt(id)]);
          return { id, points: p[0], unlockAt: p[1], claimed: p[2] };
        },
      ),
    );
    if ((await client.getBlock({ blockNumber })).hash !== block.hash)
      throw fail("Chain changed during reward reads. Refresh.");
    res.json({
      active: true,
      address,
      balance,
      used,
      positions,
      proof: proofFor(root, req.account),
      publishedRoot: root,
      publicationOwner: owner,
      canPublish: same(owner, req.account) && same(req.account, ADMIN),
      publication:
        same(owner, req.account) && same(req.account, ADMIN)
          ? (() => {
              try {
                return publicationStatus(root);
              } catch (e) {
                return { error: e.message };
              }
            })()
          : null,
      blockTimestamp: block.timestamp,
    });
  }),
);
app.get(
  "/api/hams-pool",
  auth,
  asyncRoute(async (req, res) =>
    res.json(await poolSnapshot(req.account, ADMIN)),
  ),
);
app.post(
  "/api/hams-pool/prepare",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await preparePool(
        req.account,
        req.body.action,
        req.body.amount,
        req.body.duration,
      ),
    ),
  ),
);
app.post(
  "/api/admin/hams-pool/deploy",
  auth,
  admin,
  asyncRoute(async (req, res) =>
    res.json(await preparePoolDeployment(req.account, ADMIN)),
  ),
);
app.post(
  "/api/admin/hams-pool/register",
  auth,
  admin,
  asyncRoute(async (req, res) =>
    res.json(await registerPool(req.account, ADMIN, req.body.hash)),
  ),
);
app.get(
  "/api/squeek",
  auth,
  asyncRoute(async (req, res) => res.json(await squeekSnapshot(req.account))),
);
app.post(
  "/api/squeek/prepare",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prepareSqueek(req.account, req.body.action, req.body.amount),
    ),
  ),
);
app.get(
  "/api/admin/snapshot",
  auth,
  admin,
  asyncRoute(async (req, res) => {
    const blockNumber = await client.getBlockNumber(),
      block = await client.getBlock({ blockNumber }),
      address = await gameContract(blockNumber),
      abi = artifact().abi;
    const [owner, root] = await Promise.all(
      ["owner", "pointsRoot"].map((functionName) =>
        client.readContract({ address, abi, functionName, blockNumber }),
      ),
    );
    if (!same(owner, req.account))
      throw fail("Only the current contract owner may publish points.", 403);
    const snapshot = buildPublication(root);
    if ((await client.getBlock({ blockNumber })).hash !== block.hash)
      throw fail("Chain changed during publication preparation. Refresh.");
    res.json(snapshot);
  }),
);
app.post(
  "/api/admin/register",
  auth,
  admin,
  asyncRoute(async (req, res) => {
    if (gameAddress()) throw fail("A reward contract is already registered.");
    if (!/^0x[a-fA-F0-9]{64}$/.test(req.body.hash || ""))
      throw fail("Supply the confirmed deployment transaction hash.");
    const receipt = await client.getTransactionReceipt({ hash: req.body.hash }),
      tx = await client.getTransaction({ hash: req.body.hash });
    if (
      receipt.status !== "success" ||
      !receipt.contractAddress ||
      !same(tx.from, ADMIN) ||
      tx.to !== null
    )
      throw fail("Transaction is not a successful administrator deployment.");
    if ((await client.getBlockNumber()) < receipt.blockNumber + 2n)
      throw fail(
        "Wait for two confirmations before registering this deployment.",
      );
    const code = await client.getCode({ address: receipt.contractAddress });
    if (!code || keccak256(code) !== keccak256(artifact().runtime))
      throw fail("Deployed code does not match HammyRewards.");
    const owner = await client.readContract({
      address: receipt.contractAddress,
      abi: artifact().abi,
      functionName: "owner",
    });
    if (!same(owner, ADMIN)) throw fail("Reward administrator mismatch.");
    setSetting("rewardContract", receipt.contractAddress);
    res.json({ address: receipt.contractAddress });
  }),
);
app.get("/api/contract-artifact", auth, admin, (_, res) =>
  res.json(artifact()),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
app.use((err, req, res, next) => {
  const message = err.shortMessage || err.message || "Request failed.";
  res.status(err.status || 400).json({ error: message });
});
if (production) {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, allowedHosts: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.get("/{*path}", async (req, res, next) => {
    try {
      const html = await vite.transformIndexHtml(
        req.originalUrl,
        fs.readFileSync("index.html", "utf8"),
      );
      res.status(200).type("html").send(html);
    } catch (e) {
      next(e);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  app.listen(Number(process.env.PORT) || 4187, "0.0.0.0", (err) => {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }
    console.log("Hammy Run listening on port " + (process.env.PORT || 4187));
  });
export default app;
