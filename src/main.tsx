import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type PointStatus = "draft" | "needs_improvement" | "organized";
type ContentSection = "explanation" | "exercises" | "supplement" | "inspiration";
type RichDocument = JSONContent;

type Chapter = {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type KnowledgePoint = {
  id: string;
  title: string;
  status: PointStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type Placement = {
  id: string;
  knowledge_point_id: string;
  chapter_id: string;
  sort_order: number;
  chapter_note: RichDocument;
  created_at: string;
  deleted_at: string | null;
};

type TreeData = {
  chapters: Chapter[];
  knowledge_points: KnowledgePoint[];
  knowledge_point_placements: Placement[];
};

type KnowledgePointContent = {
  id: string;
  knowledge_point_id: string;
  explanation: RichDocument;
  exercises: RichDocument;
  supplement: RichDocument;
  inspiration: RichDocument;
  created_at: string;
  updated_at: string;
};

type ContentDraft = Record<ContentSection, RichDocument>;

type ApiErrorPayload = {
  code?: string;
  message?: string;
  child_count?: number;
  knowledge_point_count?: number;
  placement_count?: number;
};

type ApiResponse = {
  ok: boolean;
  error?: ApiErrorPayload;
};

type Selection = {
  chapterId?: string;
  knowledgePointId?: string;
};

const EMPTY_TREE: TreeData = { chapters: [], knowledge_points: [], knowledge_point_placements: [] };
const AUTOSAVE_DELAY = 800;
const EXPANDED_KEY = "english-handout-workbench:phase2:expanded";
const NOTES_FUNCTION_URL = import.meta.env.VITE_NOTES_FUNCTION_URL ?? "https://dtcrxkdjzrklrhtxosxn.supabase.co/functions/v1/notes";
const CONTENT_DRAFT_PREFIX = "english-handout-workbench:phase3:content:";
const CHAPTER_NOTE_DRAFT_PREFIX = "english-handout-workbench:phase4:chapter-note:";
const CONTENT_SECTIONS: ContentSection[] = ["explanation", "exercises", "supplement", "inspiration"];
const SECTION_LABELS: Record<ContentSection, string> = {
  explanation: "知识讲解",
  exercises: "例题练习",
  supplement: "补充内容",
  inspiration: "💡 灵感",
};
const POINT_STATUS_LABELS: Record<PointStatus, string> = { draft: "草稿", needs_improvement: "待完善", organized: "已整理" };
const EDITOR_EXTENSIONS = [StarterKit.configure({
  blockquote: false,
  code: false,
  codeBlock: false,
  hardBreak: false,
  horizontalRule: false,
  strike: false,
  heading: { levels: [2, 3] },
})];

class ApiRequestError extends Error {
  code?: string;
  details?: ApiErrorPayload;
  constructor(message: string, code?: string, details?: ApiErrorPayload) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
  }
}

function emptyDocument(): RichDocument { return { type: "doc", content: [{ type: "paragraph" }] }; }
function isDocument(value: unknown): value is RichDocument { return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "doc"); }
function normaliseDocument(value: unknown): RichDocument { return isDocument(value) ? value : emptyDocument(); }
function emptyContentDraft(): ContentDraft { return { explanation: emptyDocument(), exercises: emptyDocument(), supplement: emptyDocument(), inspiration: emptyDocument() }; }
function contentDraftFromRecord(record: KnowledgePointContent | null): ContentDraft {
  return { explanation: normaliseDocument(record?.explanation), exercises: normaliseDocument(record?.exercises), supplement: normaliseDocument(record?.supplement), inspiration: normaliseDocument(record?.inspiration) };
}
function documentHasText(document: RichDocument): boolean {
  if (typeof document.text === "string" && document.text.trim()) return true;
  return Array.isArray(document.content) && document.content.some((node) => documentHasText(node));
}
function documentsEqual(left: RichDocument, right: RichDocument) { return JSON.stringify(left) === JSON.stringify(right); }

function endpoint(resource: string, params: Record<string, string> = {}) {
  const url = new URL(NOTES_FUNCTION_URL);
  url.searchParams.set("resource", resource);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function requestJson<T extends ApiResponse>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch (error) {
    throw new ApiRequestError(error instanceof Error ? error.message : "网络连接异常，请稍后重试。", "NETWORK_ERROR");
  }
  let body: T;
  try { body = await response.json() as T; } catch { throw new ApiRequestError(`服务器返回异常（${response.status}）。`, "INVALID_RESPONSE"); }
  if (!response.ok || !body.ok) throw new ApiRequestError(body.error?.message ?? `请求失败（${response.status}）。`, body.error?.code, body.error);
  return body;
}

function readExpandedIds() {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch { return new Set<string>(); }
}
function saveStateLabel(state: SaveState) { return { idle: "等待编辑", dirty: "待保存", saving: "保存中", saved: "已保存", error: "保存失败" }[state]; }
function pointStatusLabel(status: PointStatus) { return POINT_STATUS_LABELS[status]; }
function sortByOrder<T extends { sort_order: number; created_at: string }>(items: T[]) { return [...items].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)); }

function SaveBadge({ state }: { state: SaveState }) {
  return <span className={`save-badge save-badge--${state}`} role="status" aria-live="polite"><span className="save-badge__dot" aria-hidden="true" />{saveStateLabel(state)}</span>;
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return <div className="editor-toolbar" aria-label="简洁编辑工具栏">
    <button type="button" className={editor.isActive("heading", { level: 2 }) ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="二级标题">H2</button>
    <button type="button" className={editor.isActive("heading", { level: 3 }) ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} aria-label="三级标题">H3</button>
    <span className="editor-toolbar__divider" aria-hidden="true" />
    <button type="button" className={editor.isActive("bold") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="加粗"><strong>B</strong></button>
    <button type="button" className={editor.isActive("italic") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="斜体"><em>I</em></button>
    <button type="button" className={editor.isActive("bulletList") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="项目符号">•≡</button>
    <button type="button" className={editor.isActive("orderedList") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="编号">1≡</button>
    <span className="editor-toolbar__spacer" />
    <button type="button" className="editor-tool" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} aria-label="撤销">↶</button>
    <button type="button" className="editor-tool" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} aria-label="重做">↷</button>
  </div>;
}

function RichTextEditor({ value, onChange }: { value: RichDocument; onChange: (value: RichDocument) => void }) {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: value, immediatelyRender: false, onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getJSON()) });
  useEffect(() => {
    if (!editor || documentsEqual(editor.getJSON(), value)) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return <div className="editor-loading">正在打开编辑器……</div>;
  return <div className="rich-editor"><EditorToolbar editor={editor} /><EditorContent editor={editor} /></div>;
}

function RichTextViewer({ value }: { value: RichDocument }) {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: value, editable: false, immediatelyRender: false });
  useEffect(() => {
    if (!editor || documentsEqual(editor.getJSON(), value)) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return <div className="editor-loading">正在读取内容……</div>;
  return <div className="rich-viewer"><EditorContent editor={editor} /></div>;
}

function App() {
  const [tree, setTree] = useState<TreeData>(EMPTY_TREE);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedKnowledgePointId, setSelectedKnowledgePointId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(readExpandedIds);
  const [organizeMode, setOrganizeMode] = useState(false);
  const [viewMode, setViewMode] = useState<"read" | "edit">("read");
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [contentRecord, setContentRecord] = useState<KnowledgePointContent | null>(null);
  const [contentDraft, setContentDraft] = useState<ContentDraft>(emptyContentDraft);
  const [contentDirty, setContentDirty] = useState(false);
  const [chapterNoteDraft, setChapterNoteDraft] = useState<RichDocument>(emptyDocument);
  const [chapterNoteDirty, setChapterNoteDirty] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [pickerExpandedIds, setPickerExpandedIds] = useState<Set<string>>(new Set());
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null);
  const [draggedPlacementId, setDraggedPlacementId] = useState<string | null>(null);
  const loadedChapterIdRef = useRef<string | null>(null);
  const pendingContentFieldsRef = useRef<Set<ContentSection>>(new Set());
  const contentVersionRef = useRef(0);
  const contentRequestRef = useRef(0);
  const noteContextRef = useRef<string | null>(null);

  const selectedChapter = tree.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const selectedKnowledgePoint = tree.knowledge_points.find((point) => point.id === selectedKnowledgePointId) ?? null;
  const selectedPlacement = tree.knowledge_point_placements.find((placement) => placement.knowledge_point_id === selectedKnowledgePointId && placement.chapter_id === selectedChapterId) ?? null;
  const selectedPlacementId = selectedPlacement?.id ?? null;
  const selectedPlacementNote = selectedPlacement?.chapter_note;
  const chapterMap = useMemo(() => new Map(tree.chapters.map((chapter) => [chapter.id, chapter])), [tree.chapters]);
  const pointMap = useMemo(() => new Map(tree.knowledge_points.map((point) => [point.id, point])), [tree.knowledge_points]);

  const loadTree = useCallback(async (selection?: Selection) => {
    const result = await requestJson<TreeData & ApiResponse>(endpoint("tree"));
    setTree({ chapters: result.chapters ?? [], knowledge_points: result.knowledge_points ?? [], knowledge_point_placements: result.knowledge_point_placements ?? [] });
    if (selection?.knowledgePointId) {
      setSelectedKnowledgePointId(selection.knowledgePointId); setSelectedChapterId(selection.chapterId ?? null);
    } else if (selection?.chapterId) {
      setSelectedKnowledgePointId(null); setSelectedChapterId(selection.chapterId);
    } else {
      setSelectedChapterId((current) => current && result.chapters.some((chapter) => chapter.id === current) ? current : result.chapters.find((chapter) => chapter.parent_id === null)?.id ?? result.chapters[0]?.id ?? null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadTree().catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "目录读取失败。"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadTree]);
  useEffect(() => { try { window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedIds])); } catch { /* Optional UI state. */ } }, [expandedIds]);
  useEffect(() => {
    if (!selectedChapterId) return;
    const ancestors = new Set<string>(); let current = chapterMap.get(selectedChapterId);
    while (current?.parent_id) { ancestors.add(current.parent_id); current = chapterMap.get(current.parent_id); }
    if (ancestors.size > 0) setExpandedIds((previous) => new Set([...previous, ...ancestors]));
  }, [chapterMap, selectedChapterId]);

  useEffect(() => {
    if (!selectedChapter || selectedKnowledgePointId) return;
    if (loadedChapterIdRef.current !== selectedChapter.id) { loadedChapterIdRef.current = selectedChapter.id; setSaveState("saved"); return; }
    const draftKey = `english-handout-workbench:phase2:chapter:${selectedChapter.id}`;
    try { window.localStorage.setItem(draftKey, JSON.stringify({ content: selectedChapter.content, savedAt: new Date().toISOString() })); } catch { /* Cloud remains the source of truth. */ }
    const timer = window.setTimeout(async () => {
      setSaveState("saving"); setMessage("");
      try {
        await requestJson(endpoint("chapter", { id: selectedChapter.id }), { method: "PATCH", body: JSON.stringify({ content: selectedChapter.content }) });
        setSaveState("saved"); setMessage("章节内容已保存到 Supabase PostgreSQL。");
        try { window.localStorage.removeItem(draftKey); } catch { /* Best-effort cleanup. */ }
      } catch (error) { setSaveState("error"); setMessage(`保存失败，章节内容已保留在本机临时草稿：${error instanceof Error ? error.message : "网络连接异常。"}`); }
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [selectedChapter, selectedKnowledgePointId]);

  useEffect(() => {
    const pointId = selectedKnowledgePointId;
    if (!pointId) {
      setContentRecord(null); setContentDraft(emptyContentDraft()); setContentDirty(false); setTitleDraft(""); pendingContentFieldsRef.current.clear(); return;
    }
    const requestId = ++contentRequestRef.current;
    contentVersionRef.current += 1; pendingContentFieldsRef.current.clear(); setViewMode("read"); setContentLoading(true); setContentDirty(false); setContentRecord(null); setContentDraft(emptyContentDraft()); setTitleDraft(""); setSaveState("saved"); setMessage("");
    void requestJson<{ ok: true; knowledge_point: KnowledgePoint; content: KnowledgePointContent | null }>(endpoint("content", { id: pointId }))
      .then((result) => { if (requestId !== contentRequestRef.current) return; setContentRecord(result.content); setContentDraft(contentDraftFromRecord(result.content)); setTitleDraft(result.knowledge_point.title); })
      .catch((error) => { if (requestId !== contentRequestRef.current) return; setSaveState("error"); setMessage(`知识点内容读取失败：${error instanceof Error ? error.message : "网络连接异常。"}`); })
      .finally(() => { if (requestId === contentRequestRef.current) setContentLoading(false); });
  }, [selectedKnowledgePointId]);

  useEffect(() => {
    if (noteContextRef.current === selectedPlacementId) return;
    noteContextRef.current = selectedPlacementId;
    if (!selectedPlacementId) {
      setChapterNoteDraft(emptyDocument());
      setChapterNoteDirty(false);
      return;
    }
    setChapterNoteDraft(normaliseDocument(selectedPlacementNote));
    setChapterNoteDirty(false);
  }, [selectedPlacementId, selectedPlacementNote]);

  useEffect(() => {
    const pointId = selectedKnowledgePointId;
    if (!pointId || !contentDirty || pendingContentFieldsRef.current.size === 0) return;
    const versionAtSchedule = contentVersionRef.current; const fieldsAtSchedule = [...pendingContentFieldsRef.current]; const payload = Object.fromEntries(fieldsAtSchedule.map((field) => [field, contentDraft[field]])); const draftKey = `${CONTENT_DRAFT_PREFIX}${pointId}`;
    const timer = window.setTimeout(() => {
      setSaveState("saving"); setMessage("");
      void requestJson<{ ok: true; content: KnowledgePointContent }>(endpoint("content", { id: pointId }), { method: "PATCH", body: JSON.stringify(payload) }).then((result) => {
        if (pointId !== selectedKnowledgePointId || versionAtSchedule !== contentVersionRef.current) return;
        setContentRecord(result.content); pendingContentFieldsRef.current.clear(); setContentDirty(false); setSaveState(chapterNoteDirty ? "dirty" : "saved"); setMessage("共享核心已保存到 Supabase PostgreSQL。");
        try { window.localStorage.removeItem(draftKey); } catch { /* Best-effort cleanup. */ }
      }).catch((error) => { if (pointId === selectedKnowledgePointId) { setSaveState("error"); setMessage(`保存失败，当前输入已保留在本机临时草稿：${error instanceof Error ? error.message : "网络连接异常。"}`); } });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [contentDraft, contentDirty, selectedKnowledgePointId, chapterNoteDirty]);

  useEffect(() => {
    const placementId = selectedPlacementId;
    if (!placementId || !chapterNoteDirty) return;
    const draftKey = `${CHAPTER_NOTE_DRAFT_PREFIX}${placementId}`;
    const noteAtSchedule = chapterNoteDraft;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      setMessage("");
      void requestJson<{ ok: true; placement: Placement }>(endpoint("placement", { id: placementId }), {
        method: "PATCH",
        body: JSON.stringify({ chapter_note: noteAtSchedule }),
      }).then((result) => {
        if (selectedPlacementId !== placementId) return;
        setTree((previous) => ({
          ...previous,
          knowledge_point_placements: previous.knowledge_point_placements.map((placement) => placement.id === placementId ? result.placement : placement),
        }));
        setChapterNoteDirty(false);
        setSaveState(contentDirty ? "dirty" : "saved");
        setMessage("本章补充已保存到 Supabase PostgreSQL。");
        try { window.localStorage.removeItem(draftKey); } catch { /* Best-effort cleanup. */ }
      }).catch((error) => {
        if (selectedPlacementId !== placementId) return;
        setSaveState("error");
        setMessage(`保存失败，当前本章补充已保留在本机临时草稿：${error instanceof Error ? error.message : "网络连接异常。"}`);
      });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [chapterNoteDraft, chapterNoteDirty, selectedPlacementId, contentDirty]);

  const childrenOf = (parentId: string | null) => sortByOrder(tree.chapters.filter((chapter) => chapter.parent_id === parentId));
  const placementsOf = (chapterId: string) => sortByOrder(tree.knowledge_point_placements.filter((placement) => placement.chapter_id === chapterId));
  const selectChapter = (chapterId: string) => { setSelectedChapterId(chapterId); setSelectedKnowledgePointId(null); setViewMode("read"); };
  const selectKnowledgePoint = (placement: Placement) => { setSelectedChapterId(placement.chapter_id); setSelectedKnowledgePointId(placement.knowledge_point_id); setViewMode("read"); };
  const toggleExpanded = (chapterId: string) => setExpandedIds((previous) => { const next = new Set(previous); if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId); return next; });
  const mutate = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。"); } finally { setBusy(false); } };

  const createChapter = (parentId: string | null) => {
    const title = window.prompt(parentId ? "新建子章节名称" : "新建一级章节名称", ""); if (title === null || !title.trim()) return;
    void mutate(async () => { const result = await requestJson<{ ok: true; chapter: Chapter }>(endpoint("chapter"), { method: "POST", body: JSON.stringify({ title: title.trim(), parent_id: parentId }) }); await loadTree({ chapterId: result.chapter.id }); if (parentId) setExpandedIds((previous) => new Set([...previous, parentId])); setMessage("章节已创建。"); });
  };
  const createKnowledgePoint = (chapterId: string) => {
    const title = window.prompt("新建知识点名称", ""); if (title === null || !title.trim()) return;
    void mutate(async () => { const result = await requestJson<{ ok: true; point: KnowledgePoint; placement: Placement }>(endpoint("knowledge_point"), { method: "POST", body: JSON.stringify({ title: title.trim(), chapter_id: chapterId }) }); await loadTree({ chapterId, knowledgePointId: result.point.id }); setExpandedIds((previous) => new Set([...previous, chapterId])); setMessage("知识点已创建，默认状态为草稿。"); });
  };
  const renameChapter = (chapter: Chapter) => {
    const title = window.prompt("重命名章节", chapter.title); if (title === null || !title.trim() || title.trim() === chapter.title) return;
    void mutate(async () => { await requestJson(endpoint("chapter", { id: chapter.id }), { method: "PATCH", body: JSON.stringify({ title: title.trim() }) }); await loadTree({ chapterId: chapter.id }); setMessage("章节名称已更新。"); });
  };
  const deleteChapter = (chapter: Chapter) => void mutate(async () => {
    try { await requestJson(endpoint("chapter", { id: chapter.id }), { method: "DELETE" }); await loadTree(); setMessage("章节已移入软删除状态。"); }
    catch (error) { if (!(error instanceof ApiRequestError) || error.code !== "CHAPTER_NOT_EMPTY") throw error; if (!window.confirm(`${error.message}\n\n确认软删除这个章节及其子章节吗？`)) return; await requestJson(endpoint("chapter", { id: chapter.id, confirm: "true" }), { method: "DELETE" }); await loadTree(); setMessage("章节树已移入软删除状态。"); }
  });
  const renameKnowledgePoint = (point: KnowledgePoint) => {
    const title = window.prompt("重命名知识点", point.title); if (title === null || !title.trim() || title.trim() === point.title) return;
    void mutate(async () => { const result = await requestJson<{ ok: true; knowledge_point: KnowledgePoint }>(endpoint("knowledge_point", { id: point.id }), { method: "PATCH", body: JSON.stringify({ title: title.trim() }) }); setTree((previous) => ({ ...previous, knowledge_points: previous.knowledge_points.map((item) => item.id === point.id ? result.knowledge_point : item) })); setTitleDraft(result.knowledge_point.title); setMessage("知识点名称已更新。"); });
  };
  const deleteKnowledgePoint = (point: KnowledgePoint) => {
    const placementCount = tree.knowledge_point_placements.filter((placement) => placement.knowledge_point_id === point.id).length;
    const warning = placementCount > 1
      ? `该知识点目前存在于 ${placementCount} 个章节中。\n\n确认彻底删除知识点本体及所有引用吗？`
      : `确认彻底删除“${point.title}”吗？\n\n知识点本体和所有引用将进入软删除状态。`;
    if (!window.confirm(warning)) return;
    void mutate(async () => { await requestJson(endpoint("knowledge_point", { id: point.id, confirm: "true" }), { method: "DELETE" }); await loadTree({ chapterId: selectedChapterId ?? undefined }); setMessage("知识点已移入软删除状态。"); });
  };
  const removeCurrentPlacement = () => {
    if (!selectedPlacement || !selectedKnowledgePoint) return;
    if (!window.confirm("将从当前章节移除此知识点，共享知识点本身不会被删除。\n\n确认移除当前引用吗？")) return;
    void mutate(async () => { await requestJson(endpoint("placement", { id: selectedPlacement.id }), { method: "DELETE" }); await loadTree({ chapterId: selectedChapterId ?? undefined }); setMessage("已从当前章节移除引用，共享知识点仍然保留。"); });
  };
  const addReferenceToChapter = (chapterId: string) => {
    if (!selectedKnowledgePointId || referenceBusy) return;
    setReferenceBusy(true); setMessage("");
    void requestJson<{ ok: true; placement: Placement }>(endpoint("placement"), { method: "POST", body: JSON.stringify({ knowledge_point_id: selectedKnowledgePointId, chapter_id: chapterId }) })
      .then(async () => { await loadTree({ chapterId: selectedChapterId ?? undefined, knowledgePointId: selectedKnowledgePointId }); setShowReferencePicker(false); setMessage("已添加到其他章节，共享核心内容保持同一份。"); })
      .catch((error) => { setMessage(`添加失败：${error instanceof Error ? error.message : "网络连接异常。"}`); })
      .finally(() => setReferenceBusy(false));
  };
  const moveChapter = (chapterId: string, parentValue: string) => void mutate(async () => { await requestJson(endpoint("chapter", { id: chapterId }), { method: "PATCH", body: JSON.stringify({ operation: "move", parent_id: parentValue || null }) }); await loadTree({ chapterId }); setMessage("章节位置已更新。"); });
  const moveKnowledgePoint = (placementId: string, chapterId: string) => void mutate(async () => { await requestJson(endpoint("placement", { id: placementId }), { method: "PATCH", body: JSON.stringify({ chapter_id: chapterId }) }); await loadTree({ chapterId, knowledgePointId: selectedKnowledgePointId ?? undefined }); setExpandedIds((previous) => new Set([...previous, chapterId])); setMessage("知识点位置已更新。"); });

  const reorderSiblings = (sourceId: string, targetId: string, parentId: string | null) => {
    const siblings = childrenOf(parentId).map((chapter) => chapter.id); const sourceIndex = siblings.indexOf(sourceId); const targetIndex = siblings.indexOf(targetId); if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return; siblings.splice(sourceIndex, 1); siblings.splice(targetIndex, 0, sourceId);
    void mutate(async () => { await requestJson(endpoint("chapters"), { method: "PATCH", body: JSON.stringify({ parent_id: parentId, ids: siblings }) }); await loadTree({ chapterId: selectedChapterId ?? undefined }); setMessage("章节顺序已保存。"); });
  };
  const reorderKnowledgePoints = (sourceId: string, targetId: string, chapterId: string) => {
    const ids = placementsOf(chapterId).map((placement) => placement.id); const sourceIndex = ids.indexOf(sourceId); const targetIndex = ids.indexOf(targetId); if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return; ids.splice(sourceIndex, 1); ids.splice(targetIndex, 0, sourceId);
    void mutate(async () => { await requestJson(endpoint("knowledge_points"), { method: "PATCH", body: JSON.stringify({ chapter_id: chapterId, ids }) }); await loadTree({ chapterId, knowledgePointId: selectedKnowledgePointId ?? undefined }); setMessage("知识点顺序已保存。"); });
  };
  const shiftChapter = (chapter: Chapter, direction: -1 | 1) => { const siblings = childrenOf(chapter.parent_id); const index = siblings.findIndex((item) => item.id === chapter.id); const target = siblings[index + direction]; if (target) reorderSiblings(chapter.id, target.id, chapter.parent_id); };
  const shiftKnowledgePoint = (placement: Placement, direction: -1 | 1) => { const siblings = placementsOf(placement.chapter_id); const index = siblings.findIndex((item) => item.id === placement.id); const target = siblings[index + direction]; if (target) reorderKnowledgePoints(placement.id, target.id, placement.chapter_id); };
  const chapterCanMoveTo = (chapter: Chapter, targetId: string | null) => {
    if (targetId === null) return true; if (targetId === chapter.id) return false; let current = chapterMap.get(targetId); while (current) { if (current.id === chapter.id) return false; current = current.parent_id ? chapterMap.get(current.parent_id) : undefined; } return true;
  };
  const possibleParents = (chapter: Chapter) => tree.chapters.filter((item) => item.id !== chapter.id && chapterCanMoveTo(chapter, item.id)).sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  const handleChapterDrop = (event: DragEvent<HTMLDivElement>, target: Chapter) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("chapter-id") || draggedChapterId; setDraggedChapterId(null); if (!organizeMode || !sourceId) return; const source = chapterMap.get(sourceId); if (source && source.parent_id === target.parent_id) reorderSiblings(source.id, target.id, target.parent_id); };
  const handlePointDrop = (event: DragEvent<HTMLDivElement>, target: Placement) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("placement-id") || draggedPlacementId; setDraggedPlacementId(null); if (!organizeMode || !sourceId) return; const source = tree.knowledge_point_placements.find((item) => item.id === sourceId); if (source && source.chapter_id === target.chapter_id) reorderKnowledgePoints(source.id, target.id, target.chapter_id); };

  const updateChapterContent = (content: string) => { if (!selectedChapterId) return; setTree((previous) => ({ ...previous, chapters: previous.chapters.map((chapter) => chapter.id === selectedChapterId ? { ...chapter, content } : chapter) })); setSaveState("dirty"); };
  const updateContentSection = (section: ContentSection, value: RichDocument) => {
    setContentDraft((previous) => ({ ...previous, [section]: value })); pendingContentFieldsRef.current.add(section); contentVersionRef.current += 1; setContentDirty(true); setSaveState("dirty");
    try { window.localStorage.setItem(`${CONTENT_DRAFT_PREFIX}${selectedKnowledgePointId}`, JSON.stringify({ ...contentDraft, [section]: value, savedAt: new Date().toISOString() })); } catch { /* Temporary protection is best effort. */ }
  };
  const updateChapterNote = (value: RichDocument) => {
    if (!selectedPlacement) return;
    setChapterNoteDraft(value); setChapterNoteDirty(true); setSaveState("dirty");
    try { window.localStorage.setItem(`${CHAPTER_NOTE_DRAFT_PREFIX}${selectedPlacement.id}`, JSON.stringify({ value, savedAt: new Date().toISOString() })); } catch { /* Temporary protection is best effort. */ }
  };
  const savePointMetadata = async (patch: Partial<Pick<KnowledgePoint, "title" | "status">>) => {
    if (!selectedKnowledgePoint) return; setSaveState("saving"); setMessage("");
    try {
      const result = await requestJson<{ ok: true; knowledge_point: KnowledgePoint }>(endpoint("knowledge_point", { id: selectedKnowledgePoint.id }), { method: "PATCH", body: JSON.stringify(patch) });
      setTree((previous) => ({ ...previous, knowledge_points: previous.knowledge_points.map((point) => point.id === result.knowledge_point.id ? result.knowledge_point : point) })); setTitleDraft(result.knowledge_point.title); setSaveState(contentDirty || chapterNoteDirty ? "dirty" : "saved"); setMessage("知识点信息已保存。");
    } catch (error) { setSaveState("error"); setMessage(`保存失败，当前输入仍保留：${error instanceof Error ? error.message : "网络连接异常。"}`); }
  };
  const navigateKnowledgePoint = (offset: -1 | 1) => {
    if (!selectedChapterId || !selectedKnowledgePointId) return; const placements = placementsOf(selectedChapterId); const index = placements.findIndex((placement) => placement.knowledge_point_id === selectedKnowledgePointId); const target = placements[index + offset]; if (target) selectKnowledgePoint(target);
  };

  const chapterPath = (chapterId: string) => {
    const path: string[] = [];
    let current = chapterMap.get(chapterId);
    while (current) { path.unshift(current.title); current = current.parent_id ? chapterMap.get(current.parent_id) : undefined; }
    return path.join(" / ");
  };
  const togglePickerChapter = (chapterId: string) => setPickerExpandedIds((previous) => {
    const next = new Set(previous); if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId); return next;
  });
  const renderChapterChoice = (chapter: Chapter, depth = 0): ReactNode => {
    const children = childrenOf(chapter.id);
    const expanded = pickerExpandedIds.has(chapter.id);
    const alreadyPlaced = tree.knowledge_point_placements.some((placement) => placement.knowledge_point_id === selectedKnowledgePointId && placement.chapter_id === chapter.id);
    return <div className="chapter-choice-branch" key={chapter.id}>
      <div className="chapter-choice-row" style={{ "--tree-depth": depth } as CSSProperties}>
        <button type="button" className={`tree-toggle ${children.length > 0 ? "" : "tree-toggle--empty"}`} onClick={() => children.length > 0 && togglePickerChapter(chapter.id)} aria-label={expanded ? "折叠目标章节" : "展开目标章节"}>{children.length > 0 ? (expanded ? "⌄" : ">") : "·"}</button>
        <button type="button" className={`chapter-choice-button ${alreadyPlaced ? "chapter-choice-button--existing" : ""}`} disabled={referenceBusy} onClick={() => addReferenceToChapter(chapter.id)}><span>{chapter.title}</span>{alreadyPlaced && <em>已存在</em>}</button>
      </div>
      {expanded && <div>{children.map((child) => renderChapterChoice(child, depth + 1))}</div>}
    </div>;
  };

  const renderPoint = (placement: Placement) => {
    const point = pointMap.get(placement.knowledge_point_id); if (!point) return null;
    return <div className={`tree-point ${selectedKnowledgePointId === point.id ? "tree-point--selected" : ""}`} key={placement.id} draggable={organizeMode} onDragStart={(event) => { setDraggedPlacementId(placement.id); event.dataTransfer.setData("placement-id", placement.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handlePointDrop(event, placement)}>
      <button className="tree-point__button" onClick={() => selectKnowledgePoint(placement)}><span className="tree-point__bullet" aria-hidden="true" /><span className="tree-point__title">{point.title}</span><span className="status-pill">{pointStatusLabel(point.status)}</span></button>
      {organizeMode && <span className="sort-buttons"><button aria-label="知识点上移" onClick={() => shiftKnowledgePoint(placement, -1)}>↑</button><button aria-label="知识点下移" onClick={() => shiftKnowledgePoint(placement, 1)}>↓</button></span>}
    </div>;
  };
  const renderChapter = (chapter: Chapter, depth = 0): ReactNode => {
    const children = childrenOf(chapter.id); const placements = placementsOf(chapter.id); const expanded = expandedIds.has(chapter.id); const hasChildren = children.length > 0 || placements.length > 0;
    return <div className="tree-branch" key={chapter.id}><div className={`tree-row ${selectedChapterId === chapter.id && !selectedKnowledgePointId ? "tree-row--selected" : ""}`} style={{ "--tree-depth": depth } as CSSProperties} draggable={organizeMode} onDragStart={(event) => { setDraggedChapterId(chapter.id); event.dataTransfer.setData("chapter-id", chapter.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleChapterDrop(event, chapter)}>
      <button className={`tree-toggle ${hasChildren ? "" : "tree-toggle--empty"}`} aria-label={expanded ? "折叠章节" : "展开章节"} onClick={() => hasChildren && toggleExpanded(chapter.id)}>{hasChildren ? (expanded ? "⌄" : ">") : "·"}</button><button className="tree-row__button" onClick={() => selectChapter(chapter.id)}><span className="tree-row__title">{chapter.title}</span>{(children.length > 0 || placements.length > 0) && <span className="tree-count">{children.length + placements.length}</span>}</button>
      {organizeMode && <span className="sort-buttons"><button aria-label="章节上移" onClick={() => shiftChapter(chapter, -1)}>↑</button><button aria-label="章节下移" onClick={() => shiftChapter(chapter, 1)}>↓</button></span>}
    </div>{expanded && <div className="tree-children">{children.map((child) => renderChapter(child, depth + 1))}{placements.map(renderPoint)}</div>}</div>;
  };

  const renderChapterContent = () => {
    if (!selectedChapter) return <EmptyState onCreateRoot={() => createChapter(null)} />;
    const children = childrenOf(selectedChapter.id); const placements = placementsOf(selectedChapter.id);
    return <><div className="content-heading"><div><p className="content-kicker">章节</p><h2>{selectedChapter.title}</h2><p className="content-hint">章节可以拥有自己的总览内容，也可以继续包含任意层级的子章节。</p></div><SaveBadge state={saveState} /></div>
      <div className="action-row"><button className="primary-button" disabled={busy} onClick={() => createChapter(selectedChapter.id)}>＋ 新建子章节</button><button className="secondary-button" disabled={busy} onClick={() => createKnowledgePoint(selectedChapter.id)}>＋ 新建知识点</button>{organizeMode && <><button className="quiet-button" disabled={busy} onClick={() => renameChapter(selectedChapter)}>重命名</button><button className="danger-button" disabled={busy} onClick={() => deleteChapter(selectedChapter)}>删除</button></>}</div>
      {organizeMode && <div className="move-panel"><label htmlFor="chapter-move">移动章节到</label><select id="chapter-move" value={selectedChapter.parent_id ?? ""} disabled={busy} onChange={(event) => moveChapter(selectedChapter.id, event.target.value)}><option value="">一级目录</option>{possibleParents(selectedChapter).map((parent) => <option key={parent.id} value={parent.id}>{parent.title}</option>)}</select></div>}
      <label className="section-label" htmlFor="chapter-content">章节内容</label><textarea id="chapter-content" className="chapter-content-input" value={selectedChapter.content} onChange={(event) => updateChapterContent(event.target.value)} placeholder="在这里写下本章节的总览、学习顺序或注意事项……" />
      <div className="subsection-grid"><section className="subsection-card"><div className="subsection-card__header"><h3>子章节</h3><span>{children.length}</span></div>{children.length === 0 ? <p className="empty-line">这里还没有子章节。</p> : <div className="content-list">{children.map((child) => <button key={child.id} onClick={() => selectChapter(child.id)}><span>›</span>{child.title}</button>)}</div>}</section><section className="subsection-card"><div className="subsection-card__header"><h3>知识点</h3><span>{placements.length}</span></div>{placements.length === 0 ? <p className="empty-line">这里还没有知识点。</p> : <div className="content-list">{placements.map((placement) => { const point = pointMap.get(placement.knowledge_point_id); return point ? <button key={placement.id} onClick={() => selectKnowledgePoint(placement)}><span>•</span>{point.title}<em>{pointStatusLabel(point.status)}</em></button> : null; })}</div>}</section></div></>;
  };

  const renderKnowledgePointContent = () => {
    if (!selectedKnowledgePoint) return <EmptyState onCreateRoot={() => createChapter(null)} />;
    const placements = selectedChapterId ? placementsOf(selectedChapterId) : [];
    const pointPlacements = sortByOrder(tree.knowledge_point_placements.filter((placement) => placement.knowledge_point_id === selectedKnowledgePoint.id));
    const currentIndex = placements.findIndex((placement) => placement.knowledge_point_id === selectedKnowledgePoint.id);
    const hasReadableContent = CONTENT_SECTIONS.some((section) => documentHasText(contentDraft[section]));
    const hasChapterNote = documentHasText(chapterNoteDraft);
    return <div className="knowledge-point-page">
      <div className="content-heading"><div>{viewMode === "edit" ? <><p className="content-kicker">知识点 · 编辑</p><input className="point-title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => { if (titleDraft.trim() && titleDraft.trim() !== selectedKnowledgePoint.title) void savePointMetadata({ title: titleDraft.trim() }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label="知识点标题" /></> : <><p className="content-kicker">知识点 · 阅读</p><h2>{selectedKnowledgePoint.title}</h2></>}<p className="content-hint">当前 placement：{selectedChapter ? chapterPath(selectedChapter.id) : "当前目录"}</p></div><SaveBadge state={saveState} /></div>
      <div className="action-row"><span className="large-status-pill">{pointStatusLabel(selectedKnowledgePoint.status)}</span>{viewMode === "read" ? <button className="primary-button" onClick={() => { setTitleDraft(selectedKnowledgePoint.title); setViewMode("edit"); }}>编辑</button> : <><label className="status-select-label" htmlFor="point-status">状态</label><select id="point-status" className="status-select" value={selectedKnowledgePoint.status} onChange={(event) => void savePointMetadata({ status: event.target.value as PointStatus })}><option value="draft">草稿</option><option value="needs_improvement">待完善</option><option value="organized">已整理</option></select><button className="quiet-button" onClick={() => setViewMode("read")}>完成</button></>}{organizeMode && <button className="quiet-button" disabled={busy} onClick={() => renameKnowledgePoint(selectedKnowledgePoint)}>重命名</button>}<button className="secondary-button" disabled={referenceBusy} onClick={() => setShowReferencePicker((value) => !value)}>添加到其他章节</button><button className="quiet-button" disabled={busy || !selectedPlacement} onClick={removeCurrentPlacement}>从当前章节移除</button><button className="danger-button" disabled={busy} onClick={() => deleteKnowledgePoint(selectedKnowledgePoint)}>删除知识点</button></div>
      {showReferencePicker && <div className="reference-picker"><div className="reference-picker__header"><div><strong>选择目标章节</strong><span>只新增 placement，共享核心不复制。</span></div><button type="button" className="quiet-button" onClick={() => setShowReferencePicker(false)}>取消</button></div><div className="reference-picker__tree">{childrenOf(null).map((chapter) => renderChapterChoice(chapter))}</div></div>}
      <section className="placements-panel"><div className="placements-panel__heading"><h3>所在章节</h3><span>{pointPlacements.length} 处</span></div><div className="placement-links">{pointPlacements.map((placement) => <button type="button" className={placement.id === selectedPlacement?.id ? "placement-link placement-link--current" : "placement-link"} key={placement.id} onClick={() => selectKnowledgePoint(placement)}>{chapterPath(placement.chapter_id)}</button>)}</div></section>
      {organizeMode && selectedPlacement && <div className="move-panel"><label htmlFor="point-move">移动当前引用到章节</label><select id="point-move" value={selectedPlacement.chapter_id} disabled={busy} onChange={(event) => moveKnowledgePoint(selectedPlacement.id, event.target.value)}>{tree.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapterPath(chapter.id)}</option>)}</select></div>}
      {contentLoading ? <div className="content-loading content-loading--compact">正在读取知识点内容……</div> : viewMode === "edit" ? <div className="content-edit-stack"><div className="content-group-heading"><div><h3>共享核心</h3><span>修改后会同步到所有引用位置</span></div></div>{CONTENT_SECTIONS.map((section) => <section className={`content-section content-section--${section}`} key={section}><div className="content-section__heading"><h3>{SECTION_LABELS[section]}</h3><span>共享内容</span></div><RichTextEditor value={contentDraft[section]} onChange={(value) => updateContentSection(section, value)} /></section>)}<div className="content-group-heading content-group-heading--chapter"><div><h3>本章补充</h3><span>仅当前章节可见</span></div></div><section className="content-section content-section--chapter-note"><div className="content-section__heading"><h3>本章补充</h3><span>自动保存</span></div><RichTextEditor value={chapterNoteDraft} onChange={updateChapterNote} /></section></div> : <div className="content-read-stack">{!hasReadableContent ? <div className="no-content-state"><span>○</span><p>{contentRecord ? "暂无内容" : "暂无内容，点击“编辑”开始整理。"}</p></div> : <><div className="content-group-heading content-group-heading--read"><div><h3>共享核心</h3><span>所有引用位置共同使用</span></div></div>{CONTENT_SECTIONS.filter((section) => documentHasText(contentDraft[section])).map((section) => <section className={`content-section content-section--read content-section--${section}`} key={section}><h3>{SECTION_LABELS[section]}</h3><RichTextViewer value={contentDraft[section]} /></section>)}</>}{hasChapterNote && <><div className="content-group-heading content-group-heading--chapter content-group-heading--read"><div><h3>本章补充</h3><span>仅当前章节可见</span></div></div><section className="content-section content-section--read content-section--chapter-note"><RichTextViewer value={chapterNoteDraft} /></section></>}</div>}
      <nav className="point-navigation" aria-label="知识点阅读导航"><button className="quiet-button" disabled={currentIndex <= 0} onClick={() => navigateKnowledgePoint(-1)}>上一篇</button><button className="secondary-button" onClick={() => selectChapter(selectedChapterId ?? "")}>返回目录</button><button className="quiet-button" disabled={currentIndex < 0 || currentIndex >= placements.length - 1} onClick={() => navigateKnowledgePoint(1)}>下一篇</button></nav>
    </div>;
  };

  return <main className="app-shell"><section className="workbench-card" aria-labelledby="page-title"><header className="page-header"><div><p className="eyebrow">ENGLISH HANDOUT WORKBENCH · PHASE 4</p><h1 id="page-title">个人英语讲义工作台</h1><p className="subtitle">章节目录、共享核心与每个章节自己的补充，都在这里安静地保存。</p></div><div className="header-actions"><button className={`organize-toggle ${organizeMode ? "organize-toggle--active" : ""}`} onClick={() => setOrganizeMode((current) => !current)}>{organizeMode ? "完成整理" : "整理目录"}</button></div></header>
    {message && <div className={`message-bar ${saveState === "error" ? "message-bar--error" : ""}`} role="status">{message}</div>}
    <div className="workbench-layout"><aside className="tree-sidebar" aria-label="章节目录"><div className="tree-sidebar__header"><div><p className="content-kicker">目录</p><h2>我的讲义</h2></div><button className="icon-button" aria-label="新建一级章节" disabled={busy} onClick={() => createChapter(null)}>＋</button></div>{organizeMode && <p className="organize-tip">整理模式：可以拖动同级项目，或使用上下箭头调整顺序。</p>}<div className="tree-list">{loading ? <div className="tree-loading">正在读取目录……</div> : tree.chapters.length === 0 ? <div className="tree-empty">还没有章节。<button onClick={() => createChapter(null)}>新建一级章节</button></div> : childrenOf(null).map((chapter) => renderChapter(chapter))}</div></aside><section className="content-panel" aria-live="polite">{loading ? <div className="content-loading">正在读取云端目录……</div> : selectedKnowledgePoint ? renderKnowledgePointContent() : renderChapterContent()}</section></div>
    <footer className="page-footer"><span><span className="connection-note__mark" aria-hidden="true" />正式数据源：Supabase PostgreSQL</span><span>第四阶段：知识点引用与本章补充</span></footer></section></main>;
}

function EmptyState({ onCreateRoot }: { onCreateRoot: () => void }) { return <div className="empty-state"><span className="empty-state__icon">✦</span><h2>这里还没有内容</h2><p>先创建一个一级章节，开始搭建你的英语讲义。</p><button className="primary-button" onClick={onCreateRoot}>＋ 新建一级章节</button></div>; }

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
