import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
const directory = process.env.DATA_DIR || "data";
fs.mkdirSync(directory, { recursive: true });
export const db = new DatabaseSync(path.join(directory, "hammy.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS players(address TEXT PRIMARY KEY,coins INTEGER NOT NULL DEFAULT 0,best INTEGER NOT NULL DEFAULT 0,runs INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,address TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,address TEXT NOT NULL,seed INTEGER NOT NULL,started INTEGER NOT NULL,finished INTEGER,coins INTEGER,distance INTEGER,transcript TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roots(root TEXT PRIMARY KEY,tree TEXT NOT NULL,created INTEGER NOT NULL);`);
export const getSetting = (key) =>
  db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
export const setSetting = (key, value) =>
  db
    .prepare(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, value);
export function buildTree() {
  const rows = db
    .prepare("SELECT address,coins FROM players WHERE coins>0 ORDER BY address")
    .all();
  if (!rows.length) throw new Error("No verified points to publish yet.");
  const tree = StandardMerkleTree.of(
    rows.map((r) => [r.address, String(r.coins)]),
    ["address", "uint256"],
  );
  db.prepare("INSERT OR IGNORE INTO roots VALUES(?,?,?)").run(
    tree.root,
    JSON.stringify(tree.dump()),
    Date.now(),
  );
  return {
    root: tree.root,
    players: rows.length,
    points: rows.reduce((a, r) => a + r.coins, 0),
  };
}
export function proofFor(root, address) {
  const row = db.prepare("SELECT tree FROM roots WHERE root=?").get(root);
  if (!row) return null;
  const tree = StandardMerkleTree.load(JSON.parse(row.tree));
  for (const [i, v] of tree.entries())
    if (v[0].toLowerCase() === address.toLowerCase())
      return { cumulativePoints: v[1], proof: tree.getProof(i), root };
  return null;
}

// Published leaves contain cumulative totals. Report only the new delta and
// reject unchanged or regressing publications before asking an owner to sign.
export function publicationStatus(publishedRoot) {
  const current = new Map(
    db
      .prepare("SELECT address,coins FROM players WHERE coins>0")
      .all()
      .map((p) => [p.address.toLowerCase(), BigInt(p.coins)]),
  );
  const previous = new Map();
  if (publishedRoot !== "0x" + "0".repeat(64)) {
    const row = db
      .prepare("SELECT tree FROM roots WHERE root=?")
      .get(publishedRoot);
    if (!row)
      throw new Error(
        "The published points snapshot is unavailable. Restore its saved proof tree before publishing.",
      );
    for (const [, value] of StandardMerkleTree.load(
      JSON.parse(row.tree),
    ).entries())
      previous.set(value[0].toLowerCase(), BigInt(value[1]));
  }
  for (const [address, points] of previous) {
    if ((current.get(address) || 0n) < points)
      throw new Error(
        "Saved scores are behind published points. Restore the game ledger before publishing.",
      );
  }
  let newPoints = 0n,
    changedPlayers = 0;
  for (const [address, points] of current) {
    const delta = points - (previous.get(address) || 0n);
    if (delta > 0n) {
      newPoints += delta;
      changedPlayers++;
    }
  }
  return {
    previousRoot: publishedRoot,
    newPoints: newPoints.toString(),
    changedPlayers,
  };
}
export function buildPublication(publishedRoot) {
  const status = publicationStatus(publishedRoot);
  if (status.newPoints === "0")
    throw Object.assign(
      new Error(
        "All verified points are already published. Earn new points before publishing again.",
      ),
      { status: 409 },
    );
  return { ...buildTree(), ...status };
}
