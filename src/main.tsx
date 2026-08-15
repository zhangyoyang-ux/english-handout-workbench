import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Stage1Note = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type SaveState = "loading" | "idle" | "dirty" | "saving" | "saved" | "error";

type ApiResponse = {
  ok: boolean;
  note?: Stage1Note | null;
  error?: { code?: string; message?: string };
};

const DRAFT_KEY = "english-handout-workbench:stage1:unsaved-draft";
const AUTOSAVE_DELAY = 800;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "网络连接异常，请稍后重试。";
}

async function requestJson(url: string, options?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });

  let body: ApiResponse;
  try {
    body = (await response.json()) as ApiResponse;
  } catch {
    throw new Error(`服务器返回异常（${response.status}）。`);
  }

  if (!response.ok || !body.ok) {
    throw new Error(body.error?.message ?? `请求失败（${response.status}）。`);
  }

  return body;
}

function readLocalDraft() {
  try {
    const rawDraft = window.localStorage.getItem(DRAFT_KEY);
    if (!rawDraft) return null;

    const draft = JSON.parse(rawDraft) as { title?: unknown; content?: unknown };
    if (typeof draft.title !== "string" || typeof draft.content !== "string") {
      return null;
    }

    return { title: draft.title, content: draft.content };
  } catch {
    return null;
  }
}

function writeLocalDraft(title: string, content: string) {
  try {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ title, content, savedAt: new Date().toISOString() }),
    );
  } catch {
    // LocalStorage is only a best-effort recovery layer.
  }
}

function clearLocalDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // LocalStorage is optional and must never block cloud saving.
  }
}

function SaveBadge({ state }: { state: SaveState }) {
  const labels: Record<SaveState, string> = {
    loading: "读取中",
    idle: "等待编辑",
    dirty: "待保存",
    saving: "保存中",
    saved: "已保存",
    error: "保存失败",
  };

  return (
    <span className={`save-badge save-badge--${state}`} role="status" aria-live="polite">
      <span className="save-badge__dot" aria-hidden="true" />
      {labels[state]}
    </span>
  );
}

function App() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("");
  const [isReady, setIsReady] = useState(false);
  const revisionRef = useRef(0);
  const noteIdRef = useRef<string | undefined>(undefined);
  const skipAutosaveRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function loadNote() {
      try {
        const result = await requestJson("/api/notes");
        if (cancelled) return;

        if (result.note) {
          setTitle(result.note.title);
          setContent(result.note.content);
          noteIdRef.current = result.note.id;
          clearLocalDraft();
          setSaveState("saved");
          setMessage("已从 Supabase 读取正式内容。");
        } else {
          const localDraft = readLocalDraft();
          if (localDraft) {
            setTitle(localDraft.title);
            setContent(localDraft.content);
            skipAutosaveRef.current = false;
            setSaveState("dirty");
            setMessage("云端暂时没有内容，已载入未上传的临时草稿。");
          } else {
            setSaveState("idle");
            setMessage("还没有测试记录，输入内容后会自动创建。");
          }
        }
      } catch (error) {
        if (cancelled) return;

        const localDraft = readLocalDraft();
        if (localDraft) {
          setTitle(localDraft.title);
          setContent(localDraft.content);
          setMessage(`云端读取失败，已保留本地临时草稿：${getErrorMessage(error)}`);
        } else {
          setMessage(`云端读取失败，当前仍可编辑：${getErrorMessage(error)}`);
        }
        setSaveState("error");
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    void loadNote();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    writeLocalDraft(title, content);
    setSaveState((current) => (current === "saving" ? current : "dirty"));

    const revision = ++revisionRef.current;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      setMessage("");

      try {
        const result = await requestJson("/api/notes", {
          method: "PUT",
          body: JSON.stringify({ id: noteIdRef.current, title, content }),
        });

        if (!result.note) return;

        if (!noteIdRef.current) {
          noteIdRef.current = result.note.id;
        }

        if (revision !== revisionRef.current) return;

        setSaveState("saved");
        setMessage("内容已写入 Supabase PostgreSQL。");
        clearLocalDraft();
      } catch (error) {
        if (revision !== revisionRef.current) return;

        writeLocalDraft(title, content);
        setSaveState("error");
        setMessage(`保存失败，输入内容已保留在本机临时草稿：${getErrorMessage(error)}`);
      }
    }, AUTOSAVE_DELAY);

    return () => window.clearTimeout(timer);
  }, [content, isReady, title]);

  const updateTitle = (value: string) => {
    setTitle(value);
  };

  const updateContent = (value: string) => {
    setContent(value);
  };

  return (
    <main className="app-shell">
      <section className="workbench-card" aria-labelledby="page-title">
        <header className="page-header">
          <div>
            <p className="eyebrow">ENGLISH HANDOUT WORKBENCH · PHASE 1</p>
            <h1 id="page-title">个人英语讲义工作台</h1>
            <p className="subtitle">先把最重要的一件事做稳：文字保存到云端，随时都能继续。</p>
          </div>
          <SaveBadge state={saveState} />
        </header>

        <div className="test-strip">
          <span className="test-strip__icon" aria-hidden="true">✦</span>
          <div>
            <strong>第一阶段数据保存测试</strong>
            <span>标题和正文会在停止输入约 0.8 秒后自动保存。</span>
          </div>
        </div>

        <form className="note-form" onSubmit={(event) => event.preventDefault()}>
          <label className="field-label" htmlFor="note-title">标题</label>
          <input
            id="note-title"
            className="title-input"
            type="text"
            value={title}
            onChange={(event) => updateTitle(event.target.value)}
            placeholder="例如：一般现在时测试"
            maxLength={200}
            autoComplete="off"
          />

          <label className="field-label field-label--content" htmlFor="note-content">正文</label>
          <textarea
            id="note-content"
            className="content-input"
            value={content}
            onChange={(event) => updateContent(event.target.value)}
            placeholder="在这里输入一段讲义内容……"
            spellCheck="false"
          />
        </form>

        <footer className="page-footer">
          <div className="connection-note">
            <span className="connection-note__mark" aria-hidden="true" />
            <span>{message || "正式数据源：Supabase PostgreSQL"}</span>
          </div>
          <span className="phase-note">当前只验证文字保存链路</span>
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
