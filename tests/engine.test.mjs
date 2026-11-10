import test from "node:test";
import assert from "node:assert/strict";
import { createRun, step, replay } from "../shared/engine.mjs";
test("score verification reproduces coin collection and collisions from inputs", () => {
  const run = createRun(98231),
    jumps = [];
  while (!run.dead && run.tick < 1800) {
    const obstacle = run.objects.find(
      (o) => o.kind !== "seed" && o.x > 150 && o.x < 275,
    );
    const jump = !!obstacle && run.jumps === 0;
    if (jump) jumps.push(run.tick);
    step(run, jump);
  }
  const result = replay(98231, jumps, run.tick);
  assert.equal(result.coins, run.coins);
  assert.equal(result.distance, Math.floor(run.distance));
  assert.ok(result.coins > 0);
  assert.ok(result.distance > 100);
});
test("forged, unordered and post-collision transcripts are rejected", () => {
  assert.throws(() => replay(1, [10, 10], 100));
  assert.throws(() => replay(1, [-1], 100));
  assert.throws(() => replay(1, [100], 100));
  assert.throws(() => replay(1, [], 18001));
  assert.throws(() => replay(1, [], 500));
});
test("double jump cannot become an unlimited mid-air jump", () => {
  const run = createRun(1);
  step(run, true);
  step(run, true);
  const v = run.vy;
  step(run, true);
  assert.equal(run.jumps, 2);
  assert.ok(run.vy > v);
});
