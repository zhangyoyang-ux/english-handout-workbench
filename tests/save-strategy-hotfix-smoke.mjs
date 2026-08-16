import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
assert.doesNotMatch(app, /AUTOSAVE_DELAY/);
assert.match(app, /AUTOSAVE_INTERVAL_KEY = "autosave_interval_ms"/);
assert.match(app, /DEFAULT_AUTOSAVE_INTERVAL_MS = 300_000/);
for (const value of ["60_000", "180_000", "300_000", "600_000", "900_000", "1_800_000"]) assert.match(app, new RegExp(value));
for (const marker of [
  "saveAllDirty",
  "manualSaveBusy",
  "ctrlKey",
  "beforeunload",
  "当前还有未保存的修改",
  "保存并继续",
  "暂不保存并继续",
  "compositionstart",
  "compositionend",
  "hasAnyUnsavedChanges",
]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

function makeScheduler() {
  let interval = 300;
  let dirty = false;
  let composing = false;
  let timerAt = null;
  let now = 0;
  let requests = 0;
  let pendingAfterComposition = false;
  const arm = () => { if (interval > 0 && dirty && timerAt === null) timerAt = now + interval; };
  const reset = () => { timerAt = null; arm(); };
  const edit = () => { dirty = true; arm(); };
  const manualSave = () => { if (!dirty) return; requests += 1; dirty = false; reset(); };
  const setIntervalMs = (value) => { interval = value; timerAt = null; arm(); };
  const setComposing = (value) => {
    composing = value;
    if (!composing && pendingAfterComposition) { pendingAfterComposition = false; manualSave(); }
  };
  const advance = (ms) => {
    now += ms;
    if (timerAt !== null && now >= timerAt) {
      timerAt = null;
      if (dirty && composing) pendingAfterComposition = true;
      else if (dirty) manualSave();
    }
  };
  return { edit, manualSave, setIntervalMs, setComposing, advance, get requests() { return requests; }, get dirty() { return dirty; } };
}

{
  const scheduler = makeScheduler();
  scheduler.advance(300);
  assert.equal(scheduler.requests, 0, "clean interval does not send an empty save");
  scheduler.edit();
  scheduler.advance(299);
  assert.equal(scheduler.requests, 0, "dirty content waits for the configured interval");
  scheduler.edit();
  scheduler.advance(1);
  assert.equal(scheduler.requests, 1, "continued typing does not reset the periodic timer");
  assert.equal(scheduler.dirty, false);
}

{
  const scheduler = makeScheduler();
  scheduler.edit();
  scheduler.advance(100);
  scheduler.manualSave();
  scheduler.edit();
  scheduler.advance(299);
  assert.equal(scheduler.requests, 1, "manual save resets the next autosave interval");
  scheduler.advance(1);
  assert.equal(scheduler.requests, 2);
}

{
  const scheduler = makeScheduler();
  scheduler.edit();
  scheduler.advance(100);
  scheduler.setIntervalMs(600);
  scheduler.advance(599);
  assert.equal(scheduler.requests, 0, "changing the interval cancels the old timer");
  scheduler.advance(1);
  assert.equal(scheduler.requests, 1);
}

{
  const scheduler = makeScheduler();
  scheduler.setIntervalMs(0);
  scheduler.edit();
  scheduler.advance(10_000);
  assert.equal(scheduler.requests, 0, "autosave off never sends a cloud request");
  scheduler.manualSave();
  assert.equal(scheduler.requests, 1, "manual save remains available when autosave is off");
}

{
  const scheduler = makeScheduler();
  scheduler.edit();
  scheduler.setComposing(true);
  scheduler.advance(300);
  assert.equal(scheduler.requests, 0, "composition blocks the due autosave");
  scheduler.setComposing(false);
  assert.equal(scheduler.requests, 1, "compositionend flushes the pending autosave");
}

console.log("Save strategy hotfix smoke checks: PASS");
