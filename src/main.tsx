import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createRoot } from "react-dom/client";
import type { ExportContentInput, ExportSelection, ExportTreeInput } from "./wordExport";
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

type Tag = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type AccessItem = {
  item_type: "chapter" | "knowledge_point";
  item_id: string;
  title: string;
  status: PointStatus | null;
  updated_at: string | null;
  chapter_id: string | null;
  placement_id: string | null;
  path: string;
};

type PinItem = AccessItem & { id: string; sort_order: number; created_at: string };
type SearchContext = { type: string; text: string; path: string; chapter_id: string | null; placement_id: string | null };
type SearchResult = {
  id: string;
  title: string;
  status: PointStatus;
  updated_at: string;
  match_types: string[];
  context: SearchContext | null;
  paths: string[];
  tags: Tag[];
  chapter_id: string | null;
  placement_id: string | null;
};
type DiscoveryMeta = { tags: Tag[]; favorite: boolean; pinned: { id: string } | null };
type FastAccess = { recent: AccessItem[]; favorites: AccessItem[]; pins: PinItem[] };
type HistoryKind = "shared" | "placement";
type HistorySnapshot = { title: string; status: PointStatus; content: ContentDraft };
type HistoryVersion = {
  id: string;
  knowledge_point_id?: string;
  placement_id?: string;
  snapshot?: HistorySnapshot;
  chapter_note_snapshot?: RichDocument;
  content_hash: string;
  version_source: string;
  created_at: string;
};
type RecycleItem = {
  id: string;
  item_type: "chapter" | "knowledge_point";
  title: string;
  path: string;
  status?: PointStatus;
  deleted_at: string | null;
  deletion_batch_id?: string | null;
  parent_deleted?: boolean;
  placement_count?: number;
  active_placement_count?: number;
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

const loadWordExport = () => import("./wordExport");

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
function matchTypeLabel(type: string) { return ({ title: "标题命中", explanation: "知识讲解命中", exercises: "例题命中", supplement: "补充内容命中", inspiration: "灵感命中", chapter_note: "本章补充命中", tag: "标签命中" } as Record<string, string>)[type] ?? type; }
function sortByOrder<T extends { sort_order: number; created_at: string }>(items: T[]) { return [...items].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

function SaveBadge({ state }: { state: SaveState }) {
  return <span className={`save-badge save-badge--${state}`} role="status" aria-live="polite"><span className="save-badge__dot" aria-hidden="true" />{saveStateLabel(state)}</span>;
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return <div className="editor-toolbar" aria-label="简洁编辑工具栏">
    <button type="button" className={editor.isActive("heading", { level: 2 }) ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="二级标题" title="二级标题">H2</button>
    <button type="button" className={editor.isActive("heading", { level: 3 }) ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} aria-label="三级标题" title="三级标题">H3</button>
    <span className="editor-toolbar__divider" aria-hidden="true" />
    <button type="button" className={editor.isActive("bold") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="加粗" title="加粗"><strong>B</strong></button>
    <button type="button" className={editor.isActive("italic") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="斜体" title="斜体"><em>I</em></button>
    <button type="button" className={editor.isActive("bulletList") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="项目符号" title="项目符号">•≡</button>
    <button type="button" className={editor.isActive("orderedList") ? "editor-tool editor-tool--active" : "editor-tool"} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="编号" title="编号">1≡</button>
    <span className="editor-toolbar__spacer" />
    <button type="button" className="editor-tool" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} aria-label="撤销" title="撤销">↶</button>
    <button type="button" className="editor-tool" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} aria-label="重做" title="重做">↷</button>
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<"" | PointStatus>("");
  const [searchTagId, setSearchTagId] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [fastAccess, setFastAccess] = useState<FastAccess>({ recent: [], favorites: [], pins: [] });
  const [pointMeta, setPointMeta] = useState<DiscoveryMeta | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [customTagDraft, setCustomTagDraft] = useState("");
  const [fastAccessLoading, setFastAccessLoading] = useState(false);
  const [chapterEditMode, setChapterEditMode] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<"menu" | "new" | "chapter" | "point" | "placements" | "filters" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKind, setHistoryKind] = useState<HistoryKind>("shared");
  const [historyVersions, setHistoryVersions] = useState<HistoryVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<HistoryVersion | null>(null);
  const [historyConfirm, setHistoryConfirm] = useState<HistoryVersion | null>(null);
  const [historyRestoring, setHistoryRestoring] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [recycleFilter, setRecycleFilter] = useState<"all" | "chapter" | "knowledge_point">("all");
  const [recycleItems, setRecycleItems] = useState<RecycleItem[]>([]);
  const [recycleActiveChapters, setRecycleActiveChapters] = useState<Array<{ id: string; title: string; path: string }>>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleRestoreTarget, setRecycleRestoreTarget] = useState<RecycleItem | null>(null);
  const [recycleTargetChapterId, setRecycleTargetChapterId] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelectedItems, setExportSelectedItems] = useState<ExportSelection[]>([]);
  const [exportExpandedChapterIds, setExportExpandedChapterIds] = useState<Set<string>>(new Set());
  const [exportBusy, setExportBusy] = useState(false);
  const loadedChapterIdRef = useRef<string | null>(null);
  const pendingContentFieldsRef = useRef<Set<ContentSection>>(new Set());
  const contentVersionRef = useRef(0);
  const contentRequestRef = useRef(0);
  const noteContextRef = useRef<string | null>(null);
  const pointEditSessionRef = useRef<{ key: string; snapshot: HistorySnapshot; captured: boolean } | null>(null);
  const placementEditSessionRef = useRef<{ key: string; snapshot: RichDocument; captured: boolean } | null>(null);

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
      setSelectedKnowledgePointId(null);
      setSelectedChapterId(null);
    }
  }, []);

  const readFreshExportContext = useCallback(async (pointIds?: string[]) => {
    const result = await requestJson<TreeData & ApiResponse>(endpoint("tree"));
    const freshTree = { chapters: result.chapters ?? [], knowledge_points: result.knowledge_points ?? [], knowledge_point_placements: result.knowledge_point_placements ?? [] };
    const ids = pointIds ?? [...new Set(freshTree.knowledge_point_placements.map((placement) => placement.knowledge_point_id))];
    const contentResults = await Promise.all(ids.map(async (pointId) => {
      const contentResult = await requestJson<{ ok: true; content: KnowledgePointContent | null }>(endpoint("content", { id: pointId }));
      return [pointId, contentResult.content ? contentDraftFromRecord(contentResult.content) as ExportContentInput : null] as const;
    }));
    return { tree: freshTree as unknown as ExportTreeInput, contents: new Map<string, ExportContentInput | null>(contentResults) };
  }, []);

  const exportIsReady = () => {
    if (exportBusy) return false;
    if (saveState === "saving" || saveState === "dirty" || saveState === "error" || contentDirty || chapterNoteDirty) {
      setMessage("当前修改尚未成功保存，请先完成保存后再导出。");
      return false;
    }
    return true;
  };

  const exportKnowledgePoint = async () => {
    if (!selectedKnowledgePointId || !exportIsReady()) return;
    setExportBusy(true); setMessage("");
    try {
      const context = await readFreshExportContext([selectedKnowledgePointId]);
      const point = context.tree.knowledge_points.find((item) => item.id === selectedKnowledgePointId);
      const placement = context.tree.knowledge_point_placements.find((item) => item.knowledge_point_id === selectedKnowledgePointId && item.chapter_id === selectedChapterId)
        ?? context.tree.knowledge_point_placements.find((item) => item.knowledge_point_id === selectedKnowledgePointId);
      if (!point || !placement) throw new Error("知识点当前没有可导出的有效引用。");
      const { buildKnowledgePointExportModel, createDocxBlob, downloadDocx, safeDocxFilename } = await loadWordExport();
      const blob = await createDocxBlob(buildKnowledgePointExportModel(point, placement, context.contents.get(point.id)));
      downloadDocx(blob, safeDocxFilename(point.title));
      setMessage("Word 已生成并开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? `Word 生成失败，请重试：${error.message}` : "Word 生成失败，请重试。");
    } finally { setExportBusy(false); }
  };

  const exportChapter = async () => {
    if (!selectedChapterId || !exportIsReady()) return;
    setExportBusy(true); setMessage("");
    try {
      const context = await readFreshExportContext();
      const chapter = context.tree.chapters.find((item) => item.id === selectedChapterId);
      if (!chapter) throw new Error("章节不存在或已移入回收站。");
      const { buildChapterExportModel, createDocxBlob, downloadDocx, safeDocxFilename } = await loadWordExport();
      const blob = await createDocxBlob(buildChapterExportModel(chapter.id, context.tree, context.contents));
      downloadDocx(blob, safeDocxFilename(chapter.title));
      setMessage("章节 Word 已生成并开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? `Word 生成失败，请重试：${error.message}` : "Word 生成失败，请重试。");
    } finally { setExportBusy(false); }
  };

  const generateCombinedExport = async () => {
    if (exportSelectedItems.length === 0 || !exportIsReady()) return;
    setExportBusy(true); setMessage("");
    try {
      const ids = [...new Set(exportSelectedItems.map((item) => item.knowledgePointId))];
      const context = await readFreshExportContext(ids);
      const { buildCombinedExportModel, createDocxBlob, downloadDocx, safeDocxFilename } = await loadWordExport();
      const blob = await createDocxBlob(buildCombinedExportModel(exportSelectedItems, context.tree, context.contents));
      downloadDocx(blob, safeDocxFilename("英语讲义"));
      setExportOpen(false);
      setMessage("组合 Word 已生成并开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? `Word 生成失败，请重试：${error.message}` : "Word 生成失败，请重试。");
    } finally { setExportBusy(false); }
  };

  const loadFastAccess = useCallback(async () => {
    setFastAccessLoading(true);
    try {
      const [tagResult, accessResult] = await Promise.all([
        requestJson<{ ok: true; tags: Tag[] }>(endpoint("tags")),
        requestJson<{ ok: true } & FastAccess>(endpoint("fast_access")),
      ]);
      setTags(tagResult.tags ?? []);
      setFastAccess({ recent: accessResult.recent ?? [], favorites: accessResult.favorites ?? [], pins: accessResult.pins ?? [] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "快速访问内容读取失败。");
    } finally {
      setFastAccessLoading(false);
    }
  }, []);

  const refreshFastAccess = useCallback(() => { void loadFastAccess(); }, [loadFastAccess]);

  const refreshPointContent = useCallback(async (pointId: string) => {
    const result = await requestJson<{ ok: true; knowledge_point: KnowledgePoint; content: KnowledgePointContent | null }>(endpoint("content", { id: pointId }));
    setContentRecord(result.content);
    setContentDraft(contentDraftFromRecord(result.content));
    setTitleDraft(result.knowledge_point.title);
    setContentDirty(false);
    pendingContentFieldsRef.current.clear();
  }, []);

  const loadHistory = useCallback(async (kind: HistoryKind, id: string) => {
    setHistoryLoading(true);
    try {
      const params: Record<string, string> = kind === "shared" ? { kind, knowledge_point_id: id } : { kind, placement_id: id };
      const result = await requestJson<{ ok: true; versions: HistoryVersion[] }>(endpoint("history", params));
      setHistoryVersions(result.versions ?? []);
      setHistoryPreview(null);
    } catch (error) {
      setHistoryVersions([]);
      setMessage(error instanceof Error ? error.message : "历史版本读取失败。");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = (kind: HistoryKind = "shared") => {
    const id = kind === "shared" ? selectedKnowledgePointId : selectedPlacementId;
    if (!id) return;
    setHistoryKind(kind);
    setHistoryOpen(true);
    void loadHistory(kind, id);
  };

  const previewHistory = (version: HistoryVersion) => {
    void requestJson<{ ok: true; version: HistoryVersion }>(endpoint("history_version", { kind: historyKind, id: version.id }))
      .then((result) => setHistoryPreview(result.version))
      .catch((error) => setMessage(error instanceof Error ? error.message : "历史版本读取失败。"));
  };

  const restoreHistoryVersion = async () => {
    if (!historyConfirm) return;
    setHistoryRestoring(true);
    try {
      await requestJson(endpoint("restore_history"), { method: "POST", body: JSON.stringify({ kind: historyKind, version_id: historyConfirm.id }) });
      if (selectedKnowledgePointId) {
        await refreshPointContent(selectedKnowledgePointId);
        await loadTree({ chapterId: selectedChapterId ?? undefined, knowledgePointId: selectedKnowledgePointId });
      }
      setHistoryConfirm(null);
      setHistoryPreview(null);
      setHistoryOpen(false);
      setViewMode("read");
      setMessage("已恢复历史版本；恢复前内容也已保留为可恢复快照。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史版本恢复失败。");
    } finally {
      setHistoryRestoring(false);
    }
  };

  const loadRecycleBin = useCallback(async (kind: "all" | "chapter" | "knowledge_point" = recycleFilter) => {
    setRecycleLoading(true);
    try {
      const result = await requestJson<{ ok: true; items: RecycleItem[]; active_chapters: Array<{ id: string; title: string; path: string }> }>(endpoint("recycle_bin", { kind }));
      setRecycleItems(result.items ?? []);
      setRecycleActiveChapters(result.active_chapters ?? []);
    } catch (error) {
      setRecycleItems([]);
      setMessage(error instanceof Error ? error.message : "回收站读取失败。");
    } finally {
      setRecycleLoading(false);
    }
  }, [recycleFilter]);

  const openRecycleBin = (kind: "all" | "chapter" | "knowledge_point" = "all") => {
    setRecycleFilter(kind);
    setRecycleOpen(true);
    void loadRecycleBin(kind);
  };

  const restoreRecycleItem = async (item: RecycleItem, restoreParents = false, targetChapterId?: string) => {
    try {
      await requestJson(endpoint("restore_recycle"), {
        method: "POST",
        body: JSON.stringify({ kind: item.item_type, id: item.id, restore_parents: restoreParents, target_chapter_id: targetChapterId ?? null }),
      });
      await loadTree({ chapterId: selectedChapterId ?? undefined, knowledgePointId: selectedKnowledgePointId ?? undefined });
      await loadRecycleBin(recycleFilter);
      setRecycleRestoreTarget(null);
      setMessage(`${item.item_type === "chapter" ? "章节" : "知识点"}已恢复，原 UUID 与可用引用保持不变。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回收站恢复失败。");
    }
  };

  const requestRecycleRestore = (item: RecycleItem) => {
    if (item.item_type === "chapter" && item.parent_deleted) {
      if (!window.confirm("上级章节也在回收站中。是否同时恢复上级目录？")) return;
      void restoreRecycleItem(item, true);
      return;
    }
    if (item.item_type === "knowledge_point" && !item.active_placement_count) {
      setRecycleRestoreTarget(item);
      setRecycleTargetChapterId(recycleActiveChapters[0]?.id ?? "");
      return;
    }
    void restoreRecycleItem(item);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadTree().catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "目录读取失败。"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadTree]);
  useEffect(() => { void loadFastAccess(); }, [loadFastAccess]);
  useEffect(() => { try { window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedIds])); } catch { /* Optional UI state. */ } }, [expandedIds]);
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      const params: Record<string, string> = { q: query };
      if (searchStatus) params.status = searchStatus;
      if (searchTagId) params.tag_id = searchTagId;
      void requestJson<{ ok: true; results: SearchResult[] }>(endpoint("search", params))
        .then((result) => setSearchResults(result.results ?? []))
        .catch((error) => { setSearchResults([]); setSearchError(error instanceof Error ? error.message : "搜索失败，请稍后重试。"); })
        .finally(() => setSearchLoading(false));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchStatus, searchTagId]);
  useEffect(() => {
    if (!selectedChapterId) return;
    const ancestors = new Set<string>(); let current = chapterMap.get(selectedChapterId);
    while (current?.parent_id) { ancestors.add(current.parent_id); current = chapterMap.get(current.parent_id); }
    if (ancestors.size > 0) setExpandedIds((previous) => new Set([...previous, ...ancestors]));
  }, [chapterMap, selectedChapterId]);
  useEffect(() => { setChapterEditMode(false); }, [selectedChapterId]);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const updateViewport = () => setIsMobile(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener?.("change", updateViewport);
    return () => mediaQuery.removeEventListener?.("change", updateViewport);
  }, []);
  useEffect(() => { setMobileSheet(null); }, [selectedChapterId, selectedKnowledgePointId]);

  useEffect(() => {
    if (!selectedChapter || selectedKnowledgePointId) return;
    if (loadedChapterIdRef.current !== selectedChapter.id) { loadedChapterIdRef.current = selectedChapter.id; setSaveState("saved"); return; }
    const draftKey = `english-handout-workbench:phase2:chapter:${selectedChapter.id}`;
    try { window.localStorage.setItem(draftKey, JSON.stringify({ content: selectedChapter.content, savedAt: new Date().toISOString() })); } catch { /* Cloud remains the source of truth. */ }
    const timer = window.setTimeout(async () => {
      setSaveState("saving"); setMessage("");
      try {
        await requestJson(endpoint("chapter", { id: selectedChapter.id }), { method: "PATCH", body: JSON.stringify({ content: selectedChapter.content }) });
        setSaveState("saved"); setMessage("章节内容已保存到 Supabase PostgreSQL。"); refreshFastAccess();
        try { window.localStorage.removeItem(draftKey); } catch { /* Best-effort cleanup. */ }
      } catch (error) { setSaveState("error"); setMessage(`保存失败，章节内容已保留在本机临时草稿：${error instanceof Error ? error.message : "网络连接异常。"}`); }
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [selectedChapter, selectedKnowledgePointId, refreshFastAccess]);

  useEffect(() => {
    const pointId = selectedKnowledgePointId;
    pointEditSessionRef.current = null;
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
    const pointId = selectedKnowledgePointId;
    if (!pointId) { setPointMeta(null); setTagPickerOpen(false); return; }
    void requestJson<{ ok: true } & DiscoveryMeta>(endpoint("discovery_meta", { id: pointId }))
      .then((result) => setPointMeta({ tags: result.tags ?? [], favorite: result.favorite, pinned: result.pinned ?? null }))
      .catch((error) => setMessage(error instanceof Error ? error.message : "知识点快速访问信息读取失败。"));
  }, [selectedKnowledgePointId]);

  useEffect(() => {
    if (noteContextRef.current === selectedPlacementId) return;
    noteContextRef.current = selectedPlacementId;
    placementEditSessionRef.current = null;
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
        setContentRecord(result.content); pendingContentFieldsRef.current.clear(); setContentDirty(false); setSaveState(chapterNoteDirty ? "dirty" : "saved"); setMessage("共享核心已保存到 Supabase PostgreSQL。"); refreshFastAccess();
        try { window.localStorage.removeItem(draftKey); } catch { /* Best-effort cleanup. */ }
      }).catch((error) => { if (pointId === selectedKnowledgePointId) { setSaveState("error"); setMessage(`保存失败，当前输入已保留在本机临时草稿：${error instanceof Error ? error.message : "网络连接异常。"}`); } });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [contentDraft, contentDirty, selectedKnowledgePointId, chapterNoteDirty, refreshFastAccess]);

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
        refreshFastAccess();
        try { window.localStorage.removeItem(draftKey); } catch { /* Best-effort cleanup. */ }
      }).catch((error) => {
        if (selectedPlacementId !== placementId) return;
        setSaveState("error");
        setMessage(`保存失败，当前本章补充已保留在本机临时草稿：${error instanceof Error ? error.message : "网络连接异常。"}`);
      });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [chapterNoteDraft, chapterNoteDirty, selectedPlacementId, contentDirty, refreshFastAccess]);

  const childrenOf = (parentId: string | null) => sortByOrder(tree.chapters.filter((chapter) => chapter.parent_id === parentId));
  const placementsOf = (chapterId: string) => sortByOrder(tree.knowledge_point_placements.filter((placement) => placement.chapter_id === chapterId));
  const selectChapter = (chapterId: string) => { setSelectedChapterId(chapterId); setSelectedKnowledgePointId(null); setViewMode("read"); };
  const selectKnowledgePoint = (placement: Placement) => { setSelectedChapterId(placement.chapter_id); setSelectedKnowledgePointId(placement.knowledge_point_id); setViewMode("read"); };
  const openAccessItem = (item: Pick<AccessItem, "item_type" | "item_id" | "chapter_id" | "placement_id">) => {
    setSearchQuery("");
    setMobileSearchOpen(false);
    setMobileSheet(null);
    if (item.item_type === "chapter") {
      selectChapter(item.item_id);
      return;
    }
    const placement = tree.knowledge_point_placements.find((candidate) => candidate.id === item.placement_id)
      ?? tree.knowledge_point_placements.find((candidate) => candidate.knowledge_point_id === item.item_id && candidate.chapter_id === item.chapter_id)
      ?? tree.knowledge_point_placements.find((candidate) => candidate.knowledge_point_id === item.item_id);
    if (placement) selectKnowledgePoint(placement);
    else { setSelectedChapterId(item.chapter_id); setSelectedKnowledgePointId(item.item_id); setViewMode("read"); }
  };
  const openSearchResult = (result: SearchResult) => {
    const contextPlacementId = result.context?.placement_id ?? result.placement_id;
    openAccessItem({ item_type: "knowledge_point", item_id: result.id, chapter_id: result.context?.chapter_id ?? result.chapter_id, placement_id: contextPlacementId });
  };
  const toggleExpanded = (chapterId: string) => setExpandedIds((previous) => { const next = new Set(previous); if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId); return next; });
  const mutate = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。"); } finally { setBusy(false); } };

  const toggleFavorite = () => {
    if (!selectedKnowledgePoint || !pointMeta) return;
    void mutate(async () => {
      const favorite = !pointMeta.favorite;
      await requestJson(endpoint("favorite"), { method: "PATCH", body: JSON.stringify({ knowledge_point_id: selectedKnowledgePoint.id, favorite }) });
      setPointMeta((previous) => previous ? { ...previous, favorite } : previous);
      refreshFastAccess();
      setMessage(favorite ? "已加入收藏。" : "已取消收藏。");
    });
  };
  const isPinned = (itemType: "chapter" | "knowledge_point", itemId: string) => fastAccess.pins.some((pin) => pin.item_type === itemType && pin.item_id === itemId);
  const togglePin = (itemType: "chapter" | "knowledge_point", itemId: string) => void mutate(async () => {
    const current = fastAccess.pins.find((pin) => pin.item_type === itemType && pin.item_id === itemId);
    if (current) await requestJson(endpoint("pin", { id: current.id }), { method: "DELETE" });
    else await requestJson(endpoint("pin"), { method: "POST", body: JSON.stringify({ item_type: itemType, item_id: itemId }) });
    await loadFastAccess();
    if (itemType === "knowledge_point" && selectedKnowledgePointId === itemId) {
      const result = await requestJson<{ ok: true } & DiscoveryMeta>(endpoint("discovery_meta", { id: itemId }));
      setPointMeta({ tags: result.tags ?? [], favorite: result.favorite, pinned: result.pinned ?? null });
    }
    setMessage(current ? "已取消置顶。" : "已置顶。最多保留 4 个项目。");
  });
  const togglePointTag = (tag: Tag) => {
    if (!selectedKnowledgePoint || !pointMeta) return;
    void mutate(async () => {
      const attached = pointMeta.tags.some((item) => item.id === tag.id);
      const result = await requestJson<{ ok: true; tags: Tag[] }>(
        attached ? endpoint("knowledge_point_tag", { knowledge_point_id: selectedKnowledgePoint.id, tag_id: tag.id }) : endpoint("knowledge_point_tag"),
        attached
          ? { method: "DELETE" }
          : { method: "POST", body: JSON.stringify({ knowledge_point_id: selectedKnowledgePoint.id, tag_id: tag.id }) },
      );
      setPointMeta((previous) => previous ? { ...previous, tags: result.tags ?? [] } : previous);
      refreshFastAccess();
    });
  };
  const createCustomTag = () => {
    if (!selectedKnowledgePoint || !customTagDraft.trim()) return;
    void mutate(async () => {
      const result = await requestJson<{ ok: true; tag: Tag }>(endpoint("tag"), { method: "POST", body: JSON.stringify({ name: customTagDraft.trim() }) });
      setTags((previous) => previous.some((tag) => tag.id === result.tag.id) ? previous : [...previous, result.tag].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
      if (!pointMeta?.tags.some((tag) => tag.id === result.tag.id)) {
        const attached = await requestJson<{ ok: true; tags: Tag[] }>(endpoint("knowledge_point_tag"), { method: "POST", body: JSON.stringify({ knowledge_point_id: selectedKnowledgePoint.id, tag_id: result.tag.id }) });
        setPointMeta((previous) => previous ? { ...previous, tags: attached.tags ?? [] } : previous);
      }
      setCustomTagDraft("");
      setMessage("自定义标签已添加。");
    });
  };

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
    void mutate(async () => { capturePointHistory(); const result = await requestJson<{ ok: true; knowledge_point: KnowledgePoint }>(endpoint("knowledge_point", { id: point.id }), { method: "PATCH", body: JSON.stringify({ title: title.trim() }) }); setTree((previous) => ({ ...previous, knowledge_points: previous.knowledge_points.map((item) => item.id === point.id ? result.knowledge_point : item) })); setTitleDraft(result.knowledge_point.title); setMessage("知识点名称已更新。"); });
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

  const ensurePointEditSession = () => {
    if (!selectedKnowledgePoint || pointEditSessionRef.current?.key === selectedKnowledgePoint.id) return;
    pointEditSessionRef.current = {
      key: selectedKnowledgePoint.id,
      snapshot: JSON.parse(JSON.stringify({ title: selectedKnowledgePoint.title, status: selectedKnowledgePoint.status, content: contentDraft })) as HistorySnapshot,
      captured: false,
    };
  };
  const beginPointEdit = () => {
    if (!selectedKnowledgePoint) return;
    ensurePointEditSession();
    setTitleDraft(selectedKnowledgePoint.title);
    setViewMode("edit");
  };
  const capturePointHistory = () => {
    ensurePointEditSession();
    const session = pointEditSessionRef.current;
    if (!session || session.captured || !selectedKnowledgePointId || session.key !== selectedKnowledgePointId) return;
    session.captured = true;
    void requestJson(endpoint("history"), { method: "POST", body: JSON.stringify({ kind: "shared", knowledge_point_id: session.key, snapshot: session.snapshot }) })
      .catch((error) => setMessage(`历史快照保存失败，正文仍会继续保存：${error instanceof Error ? error.message : "网络连接异常。"}`));
  };
  const capturePlacementHistory = () => {
    const session = placementEditSessionRef.current;
    if (!session || session.captured || !selectedPlacementId || session.key !== selectedPlacementId) return;
    session.captured = true;
    void requestJson(endpoint("history"), { method: "POST", body: JSON.stringify({ kind: "placement", placement_id: session.key, snapshot: session.snapshot }) })
      .catch((error) => setMessage(`本章补充历史快照保存失败，正文仍会继续保存：${error instanceof Error ? error.message : "网络连接异常。"}`));
  };

  const updateChapterContent = (content: string) => { if (!selectedChapterId) return; setTree((previous) => ({ ...previous, chapters: previous.chapters.map((chapter) => chapter.id === selectedChapterId ? { ...chapter, content } : chapter) })); setSaveState("dirty"); };
  const updateContentSection = (section: ContentSection, value: RichDocument) => {
    capturePointHistory();
    setContentDraft((previous) => ({ ...previous, [section]: value })); pendingContentFieldsRef.current.add(section); contentVersionRef.current += 1; setContentDirty(true); setSaveState("dirty");
    try { window.localStorage.setItem(`${CONTENT_DRAFT_PREFIX}${selectedKnowledgePointId}`, JSON.stringify({ ...contentDraft, [section]: value, savedAt: new Date().toISOString() })); } catch { /* Temporary protection is best effort. */ }
  };
  const updateChapterNote = (value: RichDocument) => {
    if (!selectedPlacement) return;
    if (!placementEditSessionRef.current || placementEditSessionRef.current.key !== selectedPlacement.id) {
      placementEditSessionRef.current = { key: selectedPlacement.id, snapshot: JSON.parse(JSON.stringify(chapterNoteDraft)) as RichDocument, captured: false };
    }
    capturePlacementHistory();
    setChapterNoteDraft(value); setChapterNoteDirty(true); setSaveState("dirty");
    try { window.localStorage.setItem(`${CHAPTER_NOTE_DRAFT_PREFIX}${selectedPlacement.id}`, JSON.stringify({ value, savedAt: new Date().toISOString() })); } catch { /* Temporary protection is best effort. */ }
  };
  const savePointMetadata = async (patch: Partial<Pick<KnowledgePoint, "title" | "status">>) => {
    if (!selectedKnowledgePoint) return; setSaveState("saving"); setMessage("");
    capturePointHistory();
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

  const renderAccessButton = (item: AccessItem, label?: string) => <button type="button" className="access-item" key={`${item.item_type}-${item.item_id}`} onClick={() => openAccessItem(item)}><span className="access-item__type">{label ?? (item.item_type === "chapter" ? "章节" : "知识点")}</span><span className="access-item__title">{item.title}</span>{item.path && <span className="access-item__path">{item.path}</span>}{item.status && <span className="status-pill">{pointStatusLabel(item.status)}</span>}</button>;

  const renderHomeContent = () => {
    const continueItem = fastAccess.recent[0];
    const rootChapters = childrenOf(null);
    return <div className="home-panel">
      <div className="content-heading home-heading"><div><h2>我的讲义</h2><p className="content-hint">整理、阅读与维护你的英语知识体系</p></div><button type="button" className="text-link" onClick={() => { setExportSelectedItems([]); setExportExpandedChapterIds(new Set()); setExportOpen(true); }}>组合导出 →</button></div>
      {fastAccessLoading && <p className="empty-line">正在读取快速访问……</p>}
      {!fastAccessLoading && continueItem && <section className="fast-section fast-section--continue"><div className="fast-section__heading"><h3>继续整理</h3><span>最近一次真实编辑</span></div>{renderAccessButton(continueItem, "继续")}</section>}
      <section className="fast-section fast-section--pins"><div className="fast-section__heading"><h3>置顶</h3><span>最多 4 个</span></div>{fastAccess.pins.length === 0 ? <p className="empty-line">还没有置顶项目。</p> : <div className="access-list access-list--pins">{fastAccess.pins.map((item) => renderAccessButton(item, "置顶"))}</div>}</section>
      <section className="fast-section chapter-section"><div className="fast-section__heading"><h3>章节</h3><span>{rootChapters.length} 个一级章节</span></div>{rootChapters.length === 0 ? <div className="empty-state-inline"><strong>暂无章节</strong><span>从这里开始整理你的知识体系。</span><button type="button" className="secondary-button" onClick={() => createChapter(null)}>＋ 新建章节</button></div> : <div className="chapter-grid">{rootChapters.map((chapter) => { const childCount = childrenOf(chapter.id).length; const pointCount = placementsOf(chapter.id).length; return <button type="button" className="chapter-card" key={chapter.id} onClick={() => selectChapter(chapter.id)}><strong>{chapter.title}</strong><span>{childCount > 0 ? `${childCount} 个子章节 · ` : ""}{pointCount > 0 ? `${pointCount} 个知识点` : "进入章节"}</span></button>; })}</div>}</section>
      <section className="fast-section"><div className="fast-section__heading"><h3>最近编辑</h3><span>最多 6 条</span></div>{fastAccess.recent.length === 0 ? <p className="empty-line">还没有最近编辑记录。</p> : <div className="access-list access-list--recent">{fastAccess.recent.map((item) => renderAccessButton(item))}</div>}</section>
      <section className="fast-section fast-section--favorites"><div className="fast-section__heading"><h3>收藏</h3><div className="fast-section__actions"><button type="button" className="text-link" onClick={() => setShowFavorites((value) => !value)}>{showFavorites ? "收起" : `查看全部（${fastAccess.favorites.length}）`} <span aria-hidden="true">→</span></button><button type="button" className="text-link" onClick={() => openRecycleBin()}>回收站 →</button></div></div>{showFavorites && (fastAccess.favorites.length === 0 ? <p className="empty-line">暂无收藏。收藏常用知识点后，会显示在这里。</p> : <div className="access-list">{fastAccess.favorites.map((item) => renderAccessButton(item, "收藏"))}</div>)}</section>
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
    const hasOverview = Boolean(selectedChapter.content.trim());
    return <div className="chapter-page"><div className="content-heading chapter-heading"><div><p className="content-kicker">章节</p><h2>{selectedChapter.title}</h2></div><div className="content-heading__tools"><SaveBadge state={saveState} /><details className="more-menu"><summary aria-label="章节更多操作">···</summary><div className="more-menu__content"><button type="button" disabled={exportBusy} onClick={() => void exportChapter()}>导出本章 Word</button><button type="button" onClick={() => togglePin("chapter", selectedChapter.id)}>{isPinned("chapter", selectedChapter.id) ? "取消置顶" : "置顶章节"}</button>{organizeMode && <><button type="button" onClick={() => renameChapter(selectedChapter)}>重命名</button><button type="button" onClick={() => deleteChapter(selectedChapter)} className="more-menu__danger">删除章节</button></>}</div></details></div></div>
      <div className="action-row chapter-actions"><details className="new-menu"><summary>＋ 新建</summary><div className="more-menu__content"><button type="button" disabled={busy} onClick={() => createChapter(selectedChapter.id)}>新建子章节</button><button type="button" disabled={busy} onClick={() => createKnowledgePoint(selectedChapter.id)}>新建知识点</button></div></details>{organizeMode && <span className="organize-context">整理模式已开启</span>}</div>
      {organizeMode && <div className="move-panel"><label htmlFor="chapter-move">移动章节到</label><select id="chapter-move" value={selectedChapter.parent_id ?? ""} disabled={busy} onChange={(event) => moveChapter(selectedChapter.id, event.target.value)}><option value="">一级目录</option>{possibleParents(selectedChapter).map((parent) => <option key={parent.id} value={parent.id}>{chapterPath(parent.id)}</option>)}</select></div>}
      <section className="chapter-overview"><div className="section-heading"><h3>章节总览</h3>{hasOverview && !chapterEditMode && <button type="button" className="text-link" onClick={() => setChapterEditMode(true)}>编辑</button>}</div>{chapterEditMode ? <><textarea id="chapter-content" className="chapter-content-input" value={selectedChapter.content} onChange={(event) => updateChapterContent(event.target.value)} placeholder="写下本章节的总览、学习顺序或注意事项……" /><button type="button" className="quiet-button overview-done" onClick={() => setChapterEditMode(false)}>完成</button></> : hasOverview ? <div className="chapter-overview__text">{selectedChapter.content}</div> : <button type="button" className="add-overview" onClick={() => setChapterEditMode(true)}>＋ 添加章节说明</button>}</section>
      <div className="subsection-grid"><section className="subsection-card"><div className="subsection-card__header"><h3>子章节</h3><span>{children.length}</span></div>{children.length === 0 ? <div className="empty-state-inline"><strong>暂无子章节</strong><span>从这里开始整理这个章节。</span></div> : <div className="content-list">{children.map((child) => <button key={child.id} onClick={() => selectChapter(child.id)}><span>›</span>{child.title}</button>)}</div>}</section><section className="subsection-card"><div className="subsection-card__header"><h3>知识点</h3><span>{placements.length}</span></div>{placements.length === 0 ? <div className="empty-state-inline"><strong>暂无知识点</strong><span>从这里开始整理这个章节。</span><button type="button" className="text-link" onClick={() => createKnowledgePoint(selectedChapter.id)}>＋ 新建知识点</button></div> : <div className="content-list">{placements.map((placement) => { const point = pointMap.get(placement.knowledge_point_id); return point ? <button key={placement.id} onClick={() => selectKnowledgePoint(placement)}><span>•</span><span className="content-list__title">{point.title}</span><em>{pointStatusLabel(point.status)}</em></button> : null; })}</div>}</section></div></div>;
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
      <div className="action-row point-actions"><span className="large-status-pill">{pointStatusLabel(selectedKnowledgePoint.status)}</span><button className="quiet-button favorite-action" disabled={busy || !pointMeta} onClick={toggleFavorite}>{pointMeta?.favorite ? "★ 已收藏" : "☆ 收藏"}</button>{viewMode === "read" ? <button className="primary-button" onClick={beginPointEdit}>编辑</button> : <><label className="status-select-label" htmlFor="point-status">状态</label><select id="point-status" className="status-select" value={selectedKnowledgePoint.status} onChange={(event) => void savePointMetadata({ status: event.target.value as PointStatus })}><option value="draft">草稿</option><option value="needs_improvement">待完善</option><option value="organized">已整理</option></select><button className="quiet-button" onClick={() => setViewMode("read")}>完成</button></>}<details className="more-menu"><summary aria-label="知识点更多操作">···</summary><div className="more-menu__content"><button type="button" disabled={exportBusy} onClick={() => void exportKnowledgePoint()}>导出 Word</button><button type="button" disabled={busy} onClick={() => togglePin("knowledge_point", selectedKnowledgePoint.id)}>{isPinned("knowledge_point", selectedKnowledgePoint.id) ? "取消置顶" : "置顶知识点"}</button><button type="button" disabled={referenceBusy} onClick={() => setShowReferencePicker((value) => !value)}>添加到其他章节</button><button type="button" onClick={() => openHistory("shared")}>历史版本</button>{selectedPlacement && <button type="button" onClick={() => openHistory("placement")}>本章补充历史</button>}{organizeMode && <button type="button" disabled={busy} onClick={() => renameKnowledgePoint(selectedKnowledgePoint)}>重命名</button>}<button type="button" disabled={busy || !selectedPlacement} onClick={removeCurrentPlacement}>从当前章节移除</button><button type="button" className="more-menu__danger" disabled={busy} onClick={() => deleteKnowledgePoint(selectedKnowledgePoint)}>删除知识点</button></div></details></div>
      <div className="tag-strip"><span className="tag-strip__label">标签</span>{(pointMeta?.tags ?? []).map((tag) => <span className="tag-chip" key={tag.id}>{tag.name}</span>)}{(pointMeta?.tags ?? []).length === 0 && <span className="empty-line">暂无标签</span>}{viewMode === "edit" && <button type="button" className="quiet-button tag-edit-button" onClick={() => setTagPickerOpen((value) => !value)}>{tagPickerOpen ? "收起标签" : "编辑标签"}</button>}</div>
      {tagPickerOpen && viewMode === "edit" && <div className="tag-picker"><div className="tag-picker__options">{tags.map((tag) => <label className="tag-option" key={tag.id}><input type="checkbox" checked={pointMeta?.tags.some((item) => item.id === tag.id) ?? false} onChange={() => togglePointTag(tag)} />{tag.name}</label>)}</div><div className="tag-create"><input value={customTagDraft} onChange={(event) => setCustomTagDraft(event.target.value)} placeholder="新增自定义标签" maxLength={80} /><button type="button" className="secondary-button" disabled={busy || !customTagDraft.trim()} onClick={createCustomTag}>添加</button></div></div>}
      {showReferencePicker && <div className="reference-picker"><div className="reference-picker__header"><div><strong>选择目标章节</strong><span>只新增 placement，共享核心不复制。</span></div><button type="button" className="quiet-button" onClick={() => setShowReferencePicker(false)}>取消</button></div><div className="reference-picker__tree">{childrenOf(null).map((chapter) => renderChapterChoice(chapter))}</div></div>}
      <details className="placements-disclosure"><summary><span>所在章节</span><strong>{pointPlacements.length} 个位置</strong></summary><div className="placements-panel"><div className="placement-links">{pointPlacements.map((placement) => <button type="button" className={placement.id === selectedPlacement?.id ? "placement-link placement-link--current" : "placement-link"} key={placement.id} onClick={() => selectKnowledgePoint(placement)}>{chapterPath(placement.chapter_id)}</button>)}</div></div></details>
      {organizeMode && selectedPlacement && <div className="move-panel"><label htmlFor="point-move">移动当前引用到章节</label><select id="point-move" value={selectedPlacement.chapter_id} disabled={busy} onChange={(event) => moveKnowledgePoint(selectedPlacement.id, event.target.value)}>{tree.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapterPath(chapter.id)}</option>)}</select></div>}
      {contentLoading ? <div className="content-loading content-loading--compact">正在读取知识点内容……</div> : viewMode === "edit" ? <div className="content-edit-stack"><div className="content-group-heading"><div><h3>共享核心</h3><span>修改后会同步到所有引用位置</span></div></div>{CONTENT_SECTIONS.map((section) => <section className={`content-section content-section--${section}`} key={section}><div className="content-section__heading"><h3>{SECTION_LABELS[section]}</h3><span>共享内容</span></div><RichTextEditor value={contentDraft[section]} onChange={(value) => updateContentSection(section, value)} /></section>)}<div className="content-group-heading content-group-heading--chapter"><div><h3>本章补充</h3><span>仅当前章节可见</span></div></div><section className="content-section content-section--chapter-note"><div className="content-section__heading"><h3>本章补充</h3><span>自动保存</span></div><RichTextEditor value={chapterNoteDraft} onChange={updateChapterNote} /></section></div> : <div className="content-read-stack">{!hasReadableContent ? <div className="no-content-state"><span>○</span><p>{contentRecord ? "暂无内容" : "暂无内容，点击“编辑”开始整理。"}</p></div> : <><div className="content-group-heading content-group-heading--read"><div><h3>共享核心</h3><span>所有引用位置共同使用</span></div></div>{CONTENT_SECTIONS.filter((section) => documentHasText(contentDraft[section])).map((section) => <section className={`content-section content-section--read content-section--${section}`} key={section}><h3>{SECTION_LABELS[section]}</h3><RichTextViewer value={contentDraft[section]} /></section>)}</>}{hasChapterNote && <><div className="content-group-heading content-group-heading--chapter content-group-heading--read"><div><h3>本章补充</h3><span>仅当前章节可见</span></div></div><section className="content-section content-section--read content-section--chapter-note"><RichTextViewer value={chapterNoteDraft} /></section></>}</div>}
      <nav className="point-navigation" aria-label="知识点阅读导航"><button className="quiet-button" disabled={currentIndex <= 0} onClick={() => navigateKnowledgePoint(-1)}>上一篇</button><button className="secondary-button" onClick={() => selectChapter(selectedChapterId ?? "")}>返回目录</button><button className="quiet-button" disabled={currentIndex < 0 || currentIndex >= placements.length - 1} onClick={() => navigateKnowledgePoint(1)}>下一篇</button></nav>
    </div>;
  };

  const renderHistoryDrawer = () => {
    if (!historyOpen) return null;
    const previewSnapshot = historyPreview?.snapshot;
    return <div className="phase8-overlay-backdrop" role="presentation" onMouseDown={() => { if (!historyRestoring) setHistoryOpen(false); }}>
      <section className="phase8-panel phase8-history" role="dialog" aria-modal="true" aria-label="历史版本" onMouseDown={(event) => event.stopPropagation()}>
        <header className="phase8-panel__header"><div><p className="content-kicker">可逆编辑记录</p><h2>历史版本</h2><span>按一次编辑会话记录，不会把每次自动保存都拆成一条。</span></div><button type="button" className="quiet-button" onClick={() => setHistoryOpen(false)}>关闭</button></header>
        <div className="phase8-tabs"><button type="button" className={historyKind === "shared" ? "phase8-tab phase8-tab--active" : "phase8-tab"} onClick={() => { if (selectedKnowledgePointId) { setHistoryKind("shared"); void loadHistory("shared", selectedKnowledgePointId); } }}>共享核心</button>{selectedPlacementId && <button type="button" className={historyKind === "placement" ? "phase8-tab phase8-tab--active" : "phase8-tab"} onClick={() => { setHistoryKind("placement"); void loadHistory("placement", selectedPlacementId); }}>本章补充</button>}</div>
        <div className="phase8-history__body">
          <div className="phase8-history__list">{historyLoading ? <p className="empty-line">正在读取历史版本……</p> : historyVersions.length === 0 ? <div className="phase8-empty"><strong>暂无历史版本</strong><span>下一次进入编辑并产生变化时，会保存一个可恢复快照。</span></div> : historyVersions.map((version) => <article className={historyPreview?.id === version.id ? "phase8-history-item phase8-history-item--active" : "phase8-history-item"} key={version.id}><div><strong>{formatDateTime(version.created_at)}</strong><span>{version.version_source === "before_restore" ? "恢复前当前版本" : "编辑前版本"}</span></div><div className="phase8-history-item__actions"><button type="button" className="quiet-button" onClick={() => previewHistory(version)}>查看预览</button><button type="button" className="secondary-button" onClick={() => setHistoryConfirm(version)}>恢复此版本</button></div></article>)}</div>
          {historyPreview && <aside className="phase8-history__preview"><div className="phase8-preview-heading"><div><p className="content-kicker">只读预览</p><h3>{historyKind === "shared" ? previewSnapshot?.title ?? "共享核心" : "本章补充"}</h3><span>{formatDateTime(historyPreview.created_at)}</span></div><button type="button" className="quiet-button" onClick={() => setHistoryPreview(null)}>收起</button></div>{historyKind === "shared" && previewSnapshot ? <div className="phase8-preview-sections">{CONTENT_SECTIONS.map((section) => <section key={section}><h4>{SECTION_LABELS[section]}</h4><RichTextViewer value={previewSnapshot.content[section]} /></section>)}</div> : historyPreview.chapter_note_snapshot ? <RichTextViewer value={historyPreview.chapter_note_snapshot} /> : <p className="empty-line">此版本没有可预览内容。</p>}<button type="button" className="primary-button" onClick={() => setHistoryConfirm(historyPreview)}>恢复此版本</button></aside>}
        </div>
      </section>
      {historyConfirm && <div className="phase8-confirm-backdrop" role="presentation"><section className="phase8-confirm" role="dialog" aria-modal="true" aria-label="确认恢复历史版本" onMouseDown={(event) => event.stopPropagation()}><h3>恢复这个历史版本？</h3><p>恢复前的当前内容会先保存为新的“恢复前当前版本”，之后仍然可以撤回。</p><div className="phase8-confirm__actions"><button type="button" className="quiet-button" disabled={historyRestoring} onClick={() => setHistoryConfirm(null)}>取消</button><button type="button" className="primary-button" disabled={historyRestoring} onClick={() => void restoreHistoryVersion()}>{historyRestoring ? "恢复中……" : "确认恢复"}</button></div></section></div>}
    </div>;
  };

  const renderRecycleBin = () => {
    if (!recycleOpen) return null;
    const filterLabel = recycleFilter === "all" ? "全部" : recycleFilter === "chapter" ? "章节" : "知识点";
    return <div className="phase8-overlay-backdrop" role="presentation" onMouseDown={() => setRecycleOpen(false)}>
      <section className="phase8-panel phase8-recycle" role="dialog" aria-modal="true" aria-label="回收站" onMouseDown={(event) => event.stopPropagation()}>
        <header className="phase8-panel__header"><div><p className="content-kicker">可逆删除</p><h2>回收站</h2><span>这里不会永久删除内容；恢复会保留原 UUID。</span></div><button type="button" className="quiet-button" onClick={() => setRecycleOpen(false)}>关闭</button></header>
        <div className="phase8-tabs">{(["all", "chapter", "knowledge_point"] as const).map((kind) => <button type="button" key={kind} className={recycleFilter === kind ? "phase8-tab phase8-tab--active" : "phase8-tab"} onClick={() => { setRecycleFilter(kind); void loadRecycleBin(kind); }}>{kind === "all" ? "全部" : kind === "chapter" ? "章节" : "知识点"}</button>)}</div>
        {recycleLoading ? <p className="empty-line">正在读取回收站……</p> : recycleItems.length === 0 ? <div className="phase8-empty"><strong>{filterLabel}回收站为空</strong><span>被软删除的章节和知识点会保留在这里，等待恢复。</span></div> : <div className="phase8-recycle__list">{recycleItems.map((item) => <article className="phase8-recycle-item" key={`${item.item_type}-${item.id}`}><div className="phase8-recycle-item__main"><strong>{item.title}</strong><span>{item.item_type === "chapter" ? "章节" : "知识点"} · {item.path}</span>{item.item_type === "knowledge_point" && <small>{item.placement_count ?? 0} 个原引用 · {item.active_placement_count ?? 0} 个当前可用引用</small>}<small>移入回收站 · {item.deleted_at ? formatDateTime(item.deleted_at) : "—"}</small></div><button type="button" className="secondary-button" onClick={() => requestRecycleRestore(item)}>恢复</button></article>)}</div>}
        <p className="phase8-note">不提供永久删除和自动清理；回收站只用于可逆恢复。</p>
      </section>
      {recycleRestoreTarget && <div className="phase8-confirm-backdrop" role="presentation"><section className="phase8-confirm" role="dialog" aria-modal="true" aria-label="选择知识点恢复位置" onMouseDown={(event) => event.stopPropagation()}><h3>选择恢复位置</h3><p>原来的章节引用都不可用，请选择一个当前章节作为新的引用位置。</p><select className="phase8-target-select" value={recycleTargetChapterId} onChange={(event) => setRecycleTargetChapterId(event.target.value)}><option value="">请选择当前章节</option>{recycleActiveChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.path || chapter.title}</option>)}</select><div className="phase8-confirm__actions"><button type="button" className="quiet-button" onClick={() => setRecycleRestoreTarget(null)}>取消</button><button type="button" className="primary-button" disabled={!recycleTargetChapterId} onClick={() => void restoreRecycleItem(recycleRestoreTarget, false, recycleTargetChapterId)}>恢复到此章节</button></div></section></div>}
    </div>;
  };

  const toggleExportChapter = (chapterId: string) => setExportExpandedChapterIds((previous) => {
    const next = new Set(previous);
    if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId);
    return next;
  });
  const toggleExportPlacement = (placement: Placement) => {
    const point = pointMap.get(placement.knowledge_point_id);
    if (!point) return;
    const item: ExportSelection = { placementId: placement.id, knowledgePointId: point.id, chapterId: placement.chapter_id, title: point.title, path: chapterPath(placement.chapter_id) };
    setExportSelectedItems((previous) => previous.some((selected) => selected.placementId === item.placementId)
      ? previous.filter((selected) => selected.placementId !== item.placementId)
      : [...previous, item]);
  };
  const moveExportSelection = (index: number, direction: -1 | 1) => setExportSelectedItems((previous) => {
    const target = index + direction;
    if (target < 0 || target >= previous.length) return previous;
    const next = [...previous]; const [item] = next.splice(index, 1); next.splice(target, 0, item); return next;
  });
  const removeExportSelection = (placementId: string) => setExportSelectedItems((previous) => previous.filter((item) => item.placementId !== placementId));
  const renderExportChapter = (chapter: Chapter, depth = 0): ReactNode => {
    const children = childrenOf(chapter.id);
    const placements = placementsOf(chapter.id);
    const expanded = exportExpandedChapterIds.has(chapter.id);
    const hasChildren = children.length > 0 || placements.length > 0;
    return <div className="phase9-export-branch" key={chapter.id}>
      <div className="phase9-export-chapter-row" style={{ "--tree-depth": depth } as CSSProperties}>
        <button type="button" className={`tree-toggle ${hasChildren ? "" : "tree-toggle--empty"}`} aria-label={expanded ? "折叠导出章节" : "展开导出章节"} onClick={() => hasChildren && toggleExportChapter(chapter.id)}>{hasChildren ? (expanded ? "⌄" : ">") : "·"}</button>
        <span>{chapter.title}</span>
      </div>
      {expanded && <div className="phase9-export-branch__children">
        {placements.map((placement) => { const point = pointMap.get(placement.knowledge_point_id); if (!point) return null; const checked = exportSelectedItems.some((item) => item.placementId === placement.id); return <label className="phase9-export-point" key={placement.id}><input type="checkbox" checked={checked} onChange={() => toggleExportPlacement(placement)} /><span>{point.title}</span></label>; })}
        {children.map((child) => renderExportChapter(child, depth + 1))}
      </div>}
    </div>;
  };
  const renderExportDrawer = () => {
    if (!exportOpen) return null;
    return <div className="phase9-overlay-backdrop" role="presentation" onMouseDown={() => !exportBusy && setExportOpen(false)}>
      <section className="phase9-panel" role="dialog" aria-modal="true" aria-label="组合导出" onMouseDown={(event) => event.stopPropagation()}>
        <header className="phase9-panel__header"><div><p className="content-kicker">即时生成 DOCX</p><h2>组合导出</h2><span>按目录逐层选择知识点；同一知识点的不同章节引用可以分别选择。</span></div><button type="button" className="quiet-button" disabled={exportBusy} onClick={() => setExportOpen(false)}>关闭</button></header>
        <div className="phase9-export-body">
          <div className="phase9-export-browser"><div className="phase9-export-subheading"><strong>按章节选择</strong><span>已软删除的内容不会显示</span></div>{childrenOf(null).map((chapter) => renderExportChapter(chapter))}</div>
          <aside className="phase9-export-selected"><div className="phase9-export-subheading"><strong>已选内容</strong><span>{exportSelectedItems.length} 个知识点</span></div>{exportSelectedItems.length === 0 ? <p className="empty-line">从左侧章节中勾选知识点。</p> : <div className="phase9-export-selected-list">{exportSelectedItems.map((item, index) => <div className="phase9-export-selected-item" key={item.placementId}><span><strong>{item.title}</strong><small>{item.path}</small></span><span className="phase9-export-order"><button type="button" aria-label="上移导出项" disabled={index === 0} onClick={() => moveExportSelection(index, -1)}>↑</button><button type="button" aria-label="下移导出项" disabled={index === exportSelectedItems.length - 1} onClick={() => moveExportSelection(index, 1)}>↓</button><button type="button" aria-label="移除导出项" onClick={() => removeExportSelection(item.placementId)}>×</button></span></div>)}</div>}</aside>
        </div>
        <footer className="phase9-export-footer"><span>只导出当前正式内容，不包含标签、状态、历史版本或回收站项目。</span><button type="button" className="primary-button" disabled={exportBusy || exportSelectedItems.length === 0} onClick={() => void generateCombinedExport()}>{exportBusy ? "正在生成……" : "生成 Word"}</button></footer>
      </section>
    </div>;
  };

  const mobileGoHome = () => {
    setSelectedChapterId(null);
    setSelectedKnowledgePointId(null);
    setOrganizeMode(false);
    setMobileSearchOpen(false);
    setMobileSheet(null);
  };
  const renderMobileAccessRow = (item: AccessItem, label?: string) => <button type="button" className="mobile-access-row" key={`${item.item_type}-${item.item_id}-${item.placement_id ?? ""}`} onClick={() => openAccessItem(item)}>
    <span className="mobile-access-row__main"><strong>{item.title}</strong><span>{item.path || label || (item.item_type === "chapter" ? "章节" : "知识点")}</span></span>
    <span className="mobile-access-row__meta">{item.status ? pointStatusLabel(item.status) : label ?? "›"}<span aria-hidden="true">›</span></span>
  </button>;
  const renderMobileMessage = () => message && <div className={`mobile-message ${saveState === "error" ? "mobile-message--error" : ""}`} role="status">{message}</div>;

  const renderMobileHome = () => {
    const continueItem = fastAccess.recent[0];
    const rootChapters = childrenOf(null);
    return <div className="mobile-page mobile-home-page">
      <header className="mobile-header mobile-header--home">
        <h1 id="mobile-page-title">我的讲义</h1>
        <div className="mobile-header__actions"><button type="button" className="mobile-icon-button" aria-label="搜索讲义" onClick={() => setMobileSearchOpen(true)}>⌕</button><button type="button" className="mobile-icon-button" aria-label="更多操作" onClick={() => setMobileSheet("menu")}>···</button></div>
      </header>
      {renderMobileMessage()}
      {loading ? <p className="mobile-loading">正在读取目录……</p> : <div className="mobile-home-content">
        {fastAccessLoading && <p className="mobile-loading">正在读取快速访问……</p>}
        {continueItem && <section className="mobile-home-section mobile-home-section--continue"><div className="mobile-section-heading"><div><h2>继续整理</h2><span>最近一次编辑</span></div></div>{renderMobileAccessRow(continueItem, "继续")}</section>}
        <section className="mobile-home-section"><div className="mobile-section-heading"><div><h2>置顶</h2><span>最多 4 个</span></div></div>{fastAccess.pins.length === 0 ? <p className="mobile-empty">还没有置顶项目。</p> : <div className="mobile-pin-list">{fastAccess.pins.slice(0, 4).map((item) => renderMobileAccessRow(item, "置顶"))}</div>}</section>
        <section className="mobile-home-section"><div className="mobile-section-heading"><div><h2>章节</h2><span>{rootChapters.length} 个一级章节</span></div></div>{rootChapters.length === 0 ? <p className="mobile-empty">还没有章节，从这里开始整理你的知识体系。</p> : <div className="mobile-chapter-list">{rootChapters.map((chapter) => <button type="button" className="mobile-list-row" key={chapter.id} onClick={() => selectChapter(chapter.id)}><span>{chapter.title}</span><span aria-hidden="true">›</span></button>)}</div>}</section>
        <section className="mobile-home-section"><div className="mobile-section-heading"><div><h2>最近编辑</h2><span>最多 6 条</span></div></div>{fastAccess.recent.length === 0 ? <p className="mobile-empty">还没有最近编辑记录。</p> : <div className="mobile-access-list">{fastAccess.recent.slice(0, 6).map((item) => renderMobileAccessRow(item))}</div>}</section>
        <section className="mobile-home-section mobile-home-section--favorites"><button type="button" className="mobile-light-link" onClick={() => setShowFavorites((value) => !value)}>收藏 <span>（{fastAccess.favorites.length}）</span><b aria-hidden="true">›</b></button><button type="button" className="mobile-light-link" onClick={() => openRecycleBin()}>回收站 <b aria-hidden="true">›</b></button>{showFavorites && (fastAccess.favorites.length === 0 ? <p className="mobile-empty">暂无收藏。收藏常用知识点后，会显示在这里。</p> : <div className="mobile-access-list">{fastAccess.favorites.map((item) => renderMobileAccessRow(item, "收藏"))}</div>)}</section>
      </div>}
    </div>;
  };

  const renderMobileOrganize = () => <div className="mobile-page mobile-organize-page">
    <header className="mobile-header"><button type="button" className="mobile-back-button" onClick={() => setOrganizeMode(false)}>‹ 我的讲义</button><h1>整理目录</h1><button type="button" className="mobile-text-button" onClick={() => setOrganizeMode(false)}>完成</button></header>
    {renderMobileMessage()}
    <p className="mobile-page-intro">在这里调整章节层级与顺序。完成后返回正常阅读。</p>
    <div className="mobile-organize-tree">{loading ? <p className="mobile-loading">正在读取目录……</p> : childrenOf(null).map((chapter) => renderChapter(chapter))}</div>
  </div>;

  const renderMobileChapter = () => {
    if (!selectedChapter) return renderMobileHome();
    const children = childrenOf(selectedChapter.id);
    const placements = placementsOf(selectedChapter.id);
    const hasOverview = Boolean(selectedChapter.content.trim());
    return <div className="mobile-page mobile-chapter-page">
      <header className="mobile-header mobile-header--detail"><button type="button" className="mobile-back-button" onClick={mobileGoHome}>‹ 我的讲义</button><h1>{selectedChapter.title}</h1><div className="mobile-header__actions"><button type="button" className="mobile-icon-button" aria-label="新建" onClick={() => setMobileSheet("new")}>＋</button><button type="button" className="mobile-icon-button" aria-label="章节更多操作" onClick={() => setMobileSheet("chapter")}>···</button></div></header>
      {renderMobileMessage()}
      {selectedChapter.parent_id && <p className="mobile-path">{chapterPath(selectedChapter.id)}</p>}
      <section className="mobile-chapter-overview"><div className="mobile-section-heading"><div><h2>章节总览</h2><span>{hasOverview ? "" : "还没有章节说明"}</span></div>{hasOverview && !chapterEditMode && <button type="button" className="mobile-inline-link" onClick={() => setChapterEditMode(true)}>编辑</button>}</div>{chapterEditMode ? <><textarea className="mobile-textarea" value={selectedChapter.content} onChange={(event) => updateChapterContent(event.target.value)} placeholder="写下本章节的总览、学习顺序或注意事项……" /><div className="mobile-edit-actions"><SaveBadge state={saveState} /><button type="button" className="mobile-text-button" onClick={() => setChapterEditMode(false)}>完成</button></div></> : hasOverview ? <p className="mobile-overview-text">{selectedChapter.content}</p> : <button type="button" className="mobile-add-note" onClick={() => setChapterEditMode(true)}>＋ 添加章节说明</button>}</section>
      <section className="mobile-chapter-section"><div className="mobile-section-heading"><div><h2>子章节</h2><span>{children.length} 个</span></div></div>{children.length === 0 ? <p className="mobile-empty">暂无子章节</p> : <div className="mobile-chapter-list">{children.map((child) => <button type="button" className="mobile-list-row" key={child.id} onClick={() => selectChapter(child.id)}><span>{child.title}</span><span aria-hidden="true">›</span></button>)}</div>}</section>
      <section className="mobile-chapter-section"><div className="mobile-section-heading"><div><h2>知识点</h2><span>{placements.length} 个</span></div></div>{placements.length === 0 ? <p className="mobile-empty">暂无知识点</p> : <div className="mobile-point-list">{placements.map((placement) => { const point = pointMap.get(placement.knowledge_point_id); return point ? <button type="button" className="mobile-list-row mobile-list-row--point" key={placement.id} onClick={() => selectKnowledgePoint(placement)}><span><strong>{point.title}</strong><small>{pointStatusLabel(point.status)}</small></span><span aria-hidden="true">›</span></button> : null; })}</div>}</section>
    </div>;
  };

  const renderMobileKnowledgePoint = () => {
    if (!selectedKnowledgePoint) return renderMobileHome();
    const placements = selectedChapterId ? placementsOf(selectedChapterId) : [];
    const pointPlacements = sortByOrder(tree.knowledge_point_placements.filter((placement) => placement.knowledge_point_id === selectedKnowledgePoint.id));
    const currentIndex = placements.findIndex((placement) => placement.knowledge_point_id === selectedKnowledgePoint.id);
    const hasReadableContent = CONTENT_SECTIONS.some((section) => documentHasText(contentDraft[section]));
    const hasChapterNote = documentHasText(chapterNoteDraft);
    return <div className="mobile-page mobile-knowledge-point">
      <header className="mobile-header mobile-header--detail"><button type="button" className="mobile-back-button" onClick={() => selectedChapterId ? selectChapter(selectedChapterId) : mobileGoHome()}>‹ {selectedChapter?.title ?? "我的讲义"}</button><div className="mobile-header__actions"><SaveBadge state={saveState} /><button type="button" className="mobile-icon-button" aria-label="知识点更多操作" onClick={() => setMobileSheet("point")}>···</button></div></header>
      {renderMobileMessage()}
      <div className="mobile-point-heading">{viewMode === "edit" ? <input className="mobile-point-title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => { if (titleDraft.trim() && titleDraft.trim() !== selectedKnowledgePoint.title) void savePointMetadata({ title: titleDraft.trim() }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label="知识点标题" /> : <h1>{selectedKnowledgePoint.title}</h1>}<div className="mobile-point-meta"><span className="mobile-status-pill">{pointStatusLabel(selectedKnowledgePoint.status)}</span>{(pointMeta?.tags ?? []).slice(0, 3).map((tag) => <span className="mobile-tag" key={tag.id}>{tag.name}</span>)}{(pointMeta?.tags ?? []).length > 3 && <button type="button" className="mobile-inline-link" onClick={() => setTagPickerOpen((value) => !value)}>更多</button>}</div></div>
      <div className="mobile-point-actions">{viewMode === "read" ? <button type="button" className="mobile-primary-button" onClick={beginPointEdit}>编辑</button> : <><label className="mobile-status-select-label" htmlFor="mobile-point-status">状态</label><select id="mobile-point-status" className="mobile-status-select" value={selectedKnowledgePoint.status} onChange={(event) => void savePointMetadata({ status: event.target.value as PointStatus })}><option value="draft">草稿</option><option value="needs_improvement">待完善</option><option value="organized">已整理</option></select><button type="button" className="mobile-text-button" onClick={() => setViewMode("read")}>完成</button></>}{pointPlacements.length > 0 && <button type="button" className="mobile-placement-link" onClick={() => setMobileSheet("placements")}>所在章节 · {pointPlacements.length} 个位置</button>}</div>
      {tagPickerOpen && viewMode === "edit" && <div className="mobile-tag-picker"><div className="mobile-tag-options">{tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={pointMeta?.tags.some((item) => item.id === tag.id) ?? false} onChange={() => togglePointTag(tag)} />{tag.name}</label>)}</div><div className="mobile-tag-create"><input value={customTagDraft} onChange={(event) => setCustomTagDraft(event.target.value)} placeholder="新增自定义标签" maxLength={80} /><button type="button" className="mobile-secondary-button" disabled={busy || !customTagDraft.trim()} onClick={createCustomTag}>添加</button></div></div>}
      {showReferencePicker && <div className="mobile-reference-picker"><div className="mobile-reference-picker__header"><strong>选择目标章节</strong><button type="button" className="mobile-text-button" onClick={() => setShowReferencePicker(false)}>取消</button></div><p>只新增引用，共享核心不复制。</p><div className="mobile-reference-tree">{childrenOf(null).map((chapter) => renderChapterChoice(chapter))}</div></div>}
      {organizeMode && selectedPlacement && <div className="mobile-move-panel"><label htmlFor="mobile-point-move">移动当前引用到章节</label><select id="mobile-point-move" value={selectedPlacement.chapter_id} disabled={busy} onChange={(event) => moveKnowledgePoint(selectedPlacement.id, event.target.value)}>{tree.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapterPath(chapter.id)}</option>)}</select></div>}
      {contentLoading ? <p className="mobile-loading">正在读取知识点内容……</p> : viewMode === "edit" ? <div className="content-edit-stack mobile-content-stack"><div className="content-group-heading"><div><h2>共享核心</h2><span>修改后会同步到所有引用位置</span></div></div>{CONTENT_SECTIONS.map((section) => <section className={`content-section content-section--${section}`} key={section}><div className="content-section__heading"><h3>{SECTION_LABELS[section]}</h3><span>共享内容</span></div><RichTextEditor value={contentDraft[section]} onChange={(value) => updateContentSection(section, value)} /></section>)}<div className="content-group-heading content-group-heading--chapter"><div><h2>本章补充</h2><span>仅当前章节可见</span></div></div><section className="content-section content-section--chapter-note"><div className="content-section__heading"><h3>本章补充</h3><span>自动保存</span></div><RichTextEditor value={chapterNoteDraft} onChange={updateChapterNote} /></section></div> : <div className="content-read-stack mobile-content-stack">{!hasReadableContent ? <div className="no-content-state"><p>暂无内容，点击“编辑”开始整理。</p></div> : <><div className="content-group-heading content-group-heading--read"><div><h2>共享核心</h2><span>所有引用位置共同使用</span></div></div>{CONTENT_SECTIONS.filter((section) => documentHasText(contentDraft[section])).map((section) => <section className={`content-section content-section--read content-section--${section}`} key={section}><h3>{SECTION_LABELS[section]}</h3><RichTextViewer value={contentDraft[section]} /></section>)}</>}{hasChapterNote && <><div className="content-group-heading content-group-heading--chapter content-group-heading--read"><div><h2>本章补充</h2><span>仅当前章节可见</span></div></div><section className="content-section content-section--read content-section--chapter-note"><RichTextViewer value={chapterNoteDraft} /></section></>}</div>}
      <nav className="mobile-point-navigation" aria-label="知识点阅读导航"><button type="button" disabled={currentIndex <= 0} onClick={() => navigateKnowledgePoint(-1)}>← {currentIndex > 0 ? pointMap.get(placements[currentIndex - 1]?.knowledge_point_id)?.title ?? "上一篇" : "上一篇"}</button><button type="button" onClick={() => selectedChapterId && selectChapter(selectedChapterId)}>返回目录</button><button type="button" disabled={currentIndex < 0 || currentIndex >= placements.length - 1} onClick={() => navigateKnowledgePoint(1)}>{currentIndex >= 0 && currentIndex < placements.length - 1 ? pointMap.get(placements[currentIndex + 1]?.knowledge_point_id)?.title ?? "下一篇" : "下一篇"} →</button></nav>
    </div>;
  };

  const renderMobileSearch = () => <div className="mobile-page mobile-search-page">
    <header className="mobile-header"><button type="button" className="mobile-back-button" onClick={() => { setMobileSearchOpen(false); setSearchQuery(""); }}>‹ 我的讲义</button><h1>搜索讲义</h1><button type="button" className="mobile-icon-button" aria-label="搜索筛选" onClick={() => setMobileSheet("filters")}>···</button></header>
    <label className="mobile-search-box"><span aria-hidden="true">⌕</span><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索知识点、例题、灵感……" aria-label="搜索讲义" /></label>
    <div className="mobile-filter-chips"><button type="button" className={!searchStatus ? "mobile-filter-chip mobile-filter-chip--active" : "mobile-filter-chip"} onClick={() => setSearchStatus("")}>全部</button>{(["draft", "needs_improvement", "organized"] as PointStatus[]).map((status) => <button type="button" className={searchStatus === status ? "mobile-filter-chip mobile-filter-chip--active" : "mobile-filter-chip"} key={status} onClick={() => setSearchStatus(status)}>{pointStatusLabel(status)}</button>)}<button type="button" className={searchTagId ? "mobile-filter-chip mobile-filter-chip--active" : "mobile-filter-chip"} onClick={() => setMobileSheet("filters")}>{searchTagId ? tags.find((tag) => tag.id === searchTagId)?.name ?? "标签" : "标签"}</button></div>
    {!searchQuery.trim() ? <p className="mobile-search-empty">输入关键词开始搜索。</p> : searchLoading ? <p className="mobile-loading">正在搜索……</p> : searchError ? <p className="mobile-search-error">{searchError}</p> : searchResults.length === 0 ? <p className="mobile-search-empty">没有搜索结果，换一个关键词试试。</p> : <div className="mobile-search-results">{searchResults.map((result) => <button type="button" className="mobile-search-result" key={result.id} onClick={() => openSearchResult(result)}><strong>{result.title}</strong><span>{result.context?.path ?? result.paths[0] ?? "知识点"}</span><small>{result.match_types.map(matchTypeLabel).join(" · ")}{result.tags.length > 0 ? ` · ${result.tags.map((tag) => tag.name).join(" · ")}` : ""}</small>{result.context?.text && <p>{result.context.text}</p>}</button>)}</div>}
  </div>;

  const renderMobileSheet = () => {
    if (!mobileSheet) return null;
    const sheetTitle = mobileSheet === "menu" ? "更多" : mobileSheet === "new" ? "新建" : mobileSheet === "chapter" ? "章节操作" : mobileSheet === "point" ? "知识点操作" : mobileSheet === "placements" ? "所在章节" : "筛选";
    return <div className="mobile-sheet-backdrop" role="presentation" onClick={() => setMobileSheet(null)}><section className="mobile-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle} onClick={(event) => event.stopPropagation()}><div className="mobile-sheet__handle" aria-hidden="true" /><div className="mobile-sheet__header"><h2>{sheetTitle}</h2><button type="button" className="mobile-text-button" onClick={() => setMobileSheet(null)}>关闭</button></div><div className="mobile-sheet__items">
      {mobileSheet === "menu" && <>{<button type="button" onClick={() => { setMobileSheet(null); setOrganizeMode(true); }}>整理目录</button>}<button type="button" onClick={() => { setMobileSheet(null); setExportSelectedItems([]); setExportExpandedChapterIds(new Set()); setExportOpen(true); }}>组合导出</button><button type="button" onClick={() => { setMobileSheet(null); createChapter(null); }}>新建一级章节</button><button type="button" onClick={() => { setMobileSheet(null); setShowFavorites(true); }}>查看收藏</button><button type="button" onClick={() => { setMobileSheet(null); openRecycleBin(); }}>回收站</button></>}
      {mobileSheet === "new" && selectedChapter && <><button type="button" onClick={() => { setMobileSheet(null); createChapter(selectedChapter.id); }}>新建子章节</button><button type="button" onClick={() => { setMobileSheet(null); createKnowledgePoint(selectedChapter.id); }}>新建知识点</button></>}
      {mobileSheet === "chapter" && selectedChapter && <><button type="button" disabled={exportBusy} onClick={() => { setMobileSheet(null); void exportChapter(); }}>导出本章 Word</button><button type="button" onClick={() => { setMobileSheet(null); togglePin("chapter", selectedChapter.id); }}>{isPinned("chapter", selectedChapter.id) ? "取消置顶章节" : "置顶章节"}</button><button type="button" onClick={() => { setMobileSheet(null); renameChapter(selectedChapter); }}>重命名章节</button><button type="button" onClick={() => { setMobileSheet(null); setOrganizeMode(true); }}>整理目录</button><button type="button" className="mobile-sheet__danger" onClick={() => { setMobileSheet(null); deleteChapter(selectedChapter); }}>删除章节</button></>}
      {mobileSheet === "point" && selectedKnowledgePoint && <><button type="button" disabled={exportBusy} onClick={() => { setMobileSheet(null); void exportKnowledgePoint(); }}>导出 Word</button><button type="button" onClick={() => { setMobileSheet(null); toggleFavorite(); }}>{pointMeta?.favorite ? "取消收藏" : "加入收藏"}</button><button type="button" onClick={() => { setMobileSheet(null); togglePin("knowledge_point", selectedKnowledgePoint.id); }}>{isPinned("knowledge_point", selectedKnowledgePoint.id) ? "取消置顶知识点" : "置顶知识点"}</button><button type="button" onClick={() => { setMobileSheet(null); setShowReferencePicker(true); }}>添加到其他章节</button><button type="button" onClick={() => { setMobileSheet(null); beginPointEdit(); }}>编辑知识点</button><button type="button" onClick={() => { setMobileSheet(null); openHistory("shared"); }}>历史版本</button>{selectedPlacement && <button type="button" onClick={() => { setMobileSheet(null); openHistory("placement"); }}>本章补充历史</button>}<button type="button" onClick={() => { setMobileSheet(null); renameKnowledgePoint(selectedKnowledgePoint); }}>重命名知识点</button><button type="button" onClick={() => { setMobileSheet(null); removeCurrentPlacement(); }}>从当前章节移除</button><button type="button" className="mobile-sheet__danger" onClick={() => { setMobileSheet(null); deleteKnowledgePoint(selectedKnowledgePoint); }}>删除知识点</button></>}
      {mobileSheet === "placements" && (selectedKnowledgePoint ? pointPlacementsForMobile(selectedKnowledgePoint) : []).map((placement) => <button type="button" key={placement.id} onClick={() => { setMobileSheet(null); selectKnowledgePoint(placement); }}>{chapterPath(placement.chapter_id)}{placement.id === selectedPlacement?.id ? " · 当前" : ""}</button>)}
      {mobileSheet === "filters" && <><button type="button" onClick={() => { setSearchTagId(""); setMobileSheet(null); }}>全部标签</button>{tags.map((tag) => <button type="button" key={tag.id} onClick={() => { setSearchTagId(tag.id); setMobileSheet(null); }}>{tag.name}{searchTagId === tag.id ? " · 当前" : ""}</button>)}</>}
    </div></section></div>;
  };

  const pointPlacementsForMobile = (point: KnowledgePoint) => sortByOrder(tree.knowledge_point_placements.filter((placement) => placement.knowledge_point_id === point.id));
  const renderMobileShell = () => mobileSearchOpen ? <main className="mobile-shell"><section className="mobile-workbench">{renderMobileSearch()}{renderMobileSheet()}{renderHistoryDrawer()}{renderRecycleBin()}{renderExportDrawer()}</section></main> : <main className="mobile-shell"><section className="mobile-workbench">{organizeMode ? renderMobileOrganize() : selectedKnowledgePoint ? renderMobileKnowledgePoint() : selectedChapter ? renderMobileChapter() : renderMobileHome()}{renderMobileSheet()}{renderHistoryDrawer()}{renderRecycleBin()}{renderExportDrawer()}</section></main>;

  if (isMobile) return renderMobileShell();
  return <main className="app-shell"><section className="workbench-card" aria-labelledby="page-title"><header className="page-header"><div><p className="eyebrow">PERSONAL ENGLISH HANDOUTS</p><h1 id="page-title">个人英语讲义工作台</h1><p className="subtitle">整理、阅读与维护你的英语知识体系。</p></div><div className="header-actions"><button className={`organize-toggle ${organizeMode ? "organize-toggle--active" : ""}`} onClick={() => setOrganizeMode((current) => !current)}>{organizeMode ? "完成整理" : "整理目录"}</button></div></header>
    <section className="search-panel" aria-label="全局搜索"><div className="search-row"><label className="search-box"><span aria-hidden="true">⌕</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索标题、正文、例题、灵感或标签……" aria-label="全局搜索" /></label><select className="status-select" value={searchStatus} onChange={(event) => setSearchStatus(event.target.value as "" | PointStatus)} aria-label="按状态筛选"><option value="">全部状态</option><option value="draft">草稿</option><option value="needs_improvement">待完善</option><option value="organized">已整理</option></select><select className="status-select" value={searchTagId} onChange={(event) => setSearchTagId(event.target.value)} aria-label="按标签筛选"><option value="">全部标签</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>{searchQuery.trim() && <div className="search-results" aria-live="polite">{searchLoading ? <p className="empty-line">正在搜索……</p> : searchError ? <p className="search-error">{searchError}</p> : searchResults.length === 0 ? <p className="empty-line">没有找到匹配的知识点。</p> : <>{searchResults.map((result) => <button type="button" className="search-result" key={result.id} onClick={() => openSearchResult(result)}><span className="search-result__heading"><strong>{result.title}</strong><span className="status-pill">{pointStatusLabel(result.status)}</span></span><span className="search-result__meta">{result.match_types.map(matchTypeLabel).join(" · ")}{result.paths.length > 0 ? ` · ${result.paths.join(" ｜ ")}` : ""}</span>{result.context?.text && <span className="search-result__context">{result.context.text}</span>}{result.tags.length > 0 && <span className="search-result__tags">{result.tags.map((tag) => tag.name).join(" · ")}</span>}</button>)}</>}</div>}</section>
    {message && <div className={`message-bar ${saveState === "error" ? "message-bar--error" : ""}`} role="status">{message}</div>}
    <div className="workbench-layout"><aside className="tree-sidebar" aria-label="章节目录"><div className="tree-sidebar__header"><div><p className="content-kicker">目录</p><h2>讲义</h2></div><button className="icon-button" aria-label="新建一级章节" disabled={busy} onClick={() => createChapter(null)}>＋</button></div>{organizeMode && <p className="organize-tip">整理模式：可以拖动同级项目，或使用上下箭头调整顺序。</p>}<div className="tree-list">{loading ? <div className="tree-loading">正在读取目录……</div> : tree.chapters.length === 0 ? <div className="tree-empty">还没有章节。<button onClick={() => createChapter(null)}>新建一级章节</button></div> : childrenOf(null).map((chapter) => renderChapter(chapter))}</div></aside><section className="content-panel" aria-live="polite">{loading ? <div className="content-loading">正在读取云端目录……</div> : selectedKnowledgePoint ? renderKnowledgePointContent() : selectedChapter ? renderChapterContent() : renderHomeContent()}</section></div>
    <footer className="page-footer"><span><span className="connection-note__mark" aria-hidden="true" />正式数据源：Supabase PostgreSQL</span><span>个人英语讲义工作台</span></footer>{renderHistoryDrawer()}{renderRecycleBin()}{renderExportDrawer()}</section></main>;
}

function EmptyState({ onCreateRoot }: { onCreateRoot: () => void }) { return <div className="empty-state"><span className="empty-state__icon">✦</span><h2>这里还没有内容</h2><p>先创建一个一级章节，开始搭建你的英语讲义。</p><button className="primary-button" onClick={onCreateRoot}>＋ 新建一级章节</button></div>; }

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
