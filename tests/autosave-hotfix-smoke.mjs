import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
assert.match(app, /AUTOSAVE_DELAY = 1300/);
assert.match(app, /contentEditSeqRef/);
assert.match(app, /chapterEditSeqRef/);
assert.match(app, /chapterNoteEditSeqRef/);
assert.match(app, /const saveStartSeq = contentEditSeqRef\.current/);
assert.match(app, /const saveStartSeq = chapterEditSeqRef\.current/);
assert.match(app, /const saveStartSeq = chapterNoteEditSeqRef\.current/);
assert.match(app, /hasNewerEdits/);
assert.match(app, /currentEditor\.view\.composing/);
assert.match(app, /onCompositionEnd/);
assert.match(app, /syncVersion/);

const contentSaveStart = app.indexOf("const flushContentSave = useCallback");
const contentSaveEnd = app.indexOf("const flushNoteSave = useCallback", contentSaveStart);
assert.ok(contentSaveStart >= 0 && contentSaveEnd > contentSaveStart);
const contentSave = app.slice(contentSaveStart, contentSaveEnd);
assert.doesNotMatch(contentSave, /setContent\(/, "autosave success path never hydrates the active editor");
assert.doesNotMatch(contentSave, /setContentRecord\(result\.content\)/, "autosave success only updates metadata and revision");
assert.match(contentSave, /coreRevisionRef\.current = result\.knowledge_point\.core_revision/);
assert.match(contentSave, /contentSaveInFlightRef\.current = false/);

function virtualSerialSaveScenario(latency, chunks) {
  let server = "";
  let local = "";
  let localEditSeq = 0;
  let revision = 25;
  let inFlight = false;
  let queued = false;
  const requests = [];

  const edit = (chunk) => {
    local += chunk;
    localEditSeq += 1;
    if (inFlight) queued = true;
  };

  const save = () => {
    if (inFlight || local === server) return null;
    inFlight = true;
    const payload = local;
    const saveStartSeq = localEditSeq;
    const request = { latency, payload, saveStartSeq, resolve: null };
    request.promise = new Promise((resolve) => { request.resolve = resolve; });
    requests.push(request);
    return request.promise.then(() => {
      server = payload;
      revision += 1;
      inFlight = false;
      if (localEditSeq !== saveStartSeq || local !== payload) queued = true;
      if (queued) {
        queued = false;
        save();
      }
    });
  };

  edit(chunks[0]);
  const first = save();
  for (const chunk of chunks.slice(1)) edit(chunk);
  requests[0].resolve();
  return first.then(async () => {
    while (requests.some((request) => request.resolve && request.promise && !request.done)) {
      const next = requests.find((request) => !request.done);
      if (!next) break;
      next.done = true;
      next.resolve();
      await next.promise;
    }
    return { server, local, revision, requestCount: requests.length };
  });
}

for (const latency of [500, 1000, 2000, 3000]) {
  const result = await virtualSerialSaveScenario(latency, ["ABC", "DEF", "GHI"]);
  assert.equal(result.local, "ABCDEFGHI", `${latency}ms local input is preserved`);
  assert.equal(result.server, "ABCDEFGHI", `${latency}ms latest input reaches the server`);
  assert.equal(result.requestCount, 2, `${latency}ms saves remain serial`);
}

const continuous = await virtualSerialSaveScenario(3000, Array.from({ length: 120 }, (_, index) => `${index},`));
assert.equal(continuous.server, continuous.local, "long continuous input is eventually fully saved");
assert.equal(continuous.requestCount, 2, "continuous input does not create parallel saves");

console.log("Autosave input-overwrite hotfix smoke checks: PASS");
