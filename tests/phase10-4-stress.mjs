import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const started = performance.now();
const doc = (label) => ({
  type: "doc",
  content: Array.from({ length: 8 }, (_, index) => ({
    type: index % 3 === 0 ? "heading" : "paragraph",
    ...(index % 3 === 0 ? { attrs: { level: 2 } } : {}),
    content: [{ type: "text", text: `${label} ${"English 中文 hardly when ".repeat(18)}` }],
  })),
});

const chapters = Array.from({ length: 300 }, (_, index) => ({
  id: `chapter-${index}`,
  title: `压力测试章节 ${index}`,
  parent_id: index === 0 ? null : `chapter-${Math.max(0, index - (index < 8 ? 1 : 8))}`,
  sort_order: index,
  content: `章节说明 ${index}`,
  deleted_at: null,
}));
const points = Array.from({ length: 1000 }, (_, index) => ({
  id: `point-${index}`,
  title: `压力测试知识点 ${index}`,
  status: index % 3 === 0 ? "draft" : index % 3 === 1 ? "needs_improvement" : "organized",
  deleted_at: null,
}));
const placements = Array.from({ length: 1500 }, (_, index) => ({
  id: `placement-${index}`,
  knowledge_point_id: `point-${index % 1000}`,
  chapter_id: `chapter-${index % 300}`,
  sort_order: index,
  chapter_note: doc(`本章补充 ${index}`),
  deleted_at: null,
}));
const contents = Object.fromEntries(points.map((point) => [point.id, {
  id: `content-${point.id}`,
  knowledge_point_id: point.id,
  explanation: doc(`${point.id} explanation`),
  exercises: doc(`${point.id} exercises`),
  supplement: doc(`${point.id} supplement`),
  inspiration: doc(`${point.id} inspiration`),
}]));

const chapterIds = new Set(chapters.map((chapter) => chapter.id));
const pointIds = new Set(points.map((point) => point.id));
assert.equal(chapters.length, 300);
assert.equal(points.length, 1000);
assert.equal(placements.length, 1500);
assert.equal(new Set(chapters.map((chapter) => chapter.id)).size, chapters.length);
assert.equal(new Set(points.map((point) => point.id)).size, points.length);
for (const chapter of chapters) {
  const seen = new Set([chapter.id]);
  let parent = chapter.parent_id;
  while (parent) {
    assert.ok(chapterIds.has(parent), "deep tree parent exists");
    assert.equal(seen.has(parent), false, "deep tree has no cycle");
    seen.add(parent);
    parent = chapters.find((candidate) => candidate.id === parent)?.parent_id ?? null;
  }
}
for (const placement of placements) {
  assert.ok(pointIds.has(placement.knowledge_point_id), "placement point exists");
  assert.ok(chapterIds.has(placement.chapter_id), "placement chapter exists");
  assert.equal(placement.chapter_note.type, "doc");
}
for (const point of points) {
  const content = contents[point.id];
  assert.ok(content, "every point has content");
  assert.deepEqual(Object.keys(content).sort(), ["exercises", "explanation", "id", "inspiration", "knowledge_point_id", "supplement"]);
}

const serialized = JSON.stringify({ chapters, points, placements, contents });
assert.ok(serialized.length > 1_000_000, "stress fixture contains long rich text");
assert.ok(performance.now() - started < 5000, "synthetic stress fixture validates promptly");
console.log(`Phase 10.4 synthetic stress checks: PASS (${serialized.length} bytes, ${(performance.now() - started).toFixed(0)}ms)`);
