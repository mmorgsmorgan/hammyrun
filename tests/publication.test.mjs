import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "hammy-publication-"),
);
const { db, buildPublication } = await import("../server/store.mjs");
const zeroRoot = "0x" + "0".repeat(64),
  account = "0x0000000000000000000000000000000000000001";
test("publications reject duplicates, expose only new points, and never reduce old totals", () => {
  db.prepare("INSERT INTO players(address,coins) VALUES(?,?)").run(
    account,
    291,
  );
  const first = buildPublication(zeroRoot);
  assert.equal(first.newPoints, "291");
  assert.throws(() => buildPublication(first.root), /already published/);
  db.prepare("UPDATE players SET coins=? WHERE address=?").run(300, account);
  const next = buildPublication(first.root);
  assert.equal(next.newPoints, "9");
  assert.equal(next.points, 300);
  assert.equal(next.previousRoot, first.root);
  assert.throws(() => buildPublication(next.root), /already published/);
  db.prepare("UPDATE players SET coins=? WHERE address=?").run(250, account);
  assert.throws(() => buildPublication(next.root), /behind published/);
  assert.throws(
    () => buildPublication("0x" + "1".repeat(64)),
    /snapshot is unavailable/,
  );
  db.close();
});
