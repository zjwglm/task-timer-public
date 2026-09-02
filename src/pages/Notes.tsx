import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  LogOut,
  Plus,
  Archive,
  ArchiveRestore,
  Trash2,
  Clock,
  User,
  RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router";

type NoteColor = "yellow" | "green" | "blue" | "pink";

const COLOR_STYLES: Record<NoteColor, string> = {
  yellow: "bg-yellow-100",
  green: "bg-green-100",
  blue: "bg-blue-100",
  pink: "bg-pink-100",
};

const COLOR_ORDER: NoteColor[] = ["yellow", "green", "blue", "pink"];

/* ---- 富文本（仅加粗）辅助函数 ---- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 数据库内容格式：
//   新格式 = 纯文本（\n 换行，**文字** 表示加粗）
//   旧格式 = HTML 片段（<b>/<br>/<div>），早期版本写入，读取时兼容
function toHtml(content: string): string {
  if (/<(?:b|br|div|strong)(?:\s|\/|>)/i.test(content)) return sanitizeHtml(content);
  return escapeHtml(content)
    .replace(/\n/g, "<br>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}

// 只保留 <b>/<strong>/<br>/<div>，其余标签剥离但保留文字
function sanitizeHtml(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (["script", "style", "iframe", "object", "embed", "img"].includes(tag)) {
          el.remove();
          continue;
        }
        walk(el);
        if (!["b", "strong", "br", "div"].includes(tag)) {
          el.replaceWith(...Array.from(el.childNodes));
        } else {
          for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
        }
      }
    }
  };
  walk(tmp);
  return tmp.innerHTML;
}

// 序列化为纯文本存储格式：\n 换行，**文字** 表示加粗。
// 任何意外混入编辑区的元素（按钮、时间戳等）都不会被保存；
// 浏览器对 <br>/<div> 的各种结构差异在这里被统一消解
function serializeEditor(root: HTMLElement): string {
  const walk = (node: Node, isFirstChild: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "b" || tag === "strong") {
      const inner = Array.from(el.childNodes)
        .map((c, i) => walk(c, i === 0))
        .join("");
      return `**${inner}**`;
    }
    if (tag === "div") {
      // Chrome 会在行尾 div 里塞一个多余的 <br>（bogus br），剥掉避免产生空行
      const kids = Array.from(el.childNodes);
      const last = kids[kids.length - 1];
      if (last && last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
        kids.pop();
      }
      const inner = kids.map((c, i) => walk(c, i === 0)).join("");
      return (isFirstChild ? "" : "\n") + inner;
    }
    // 其他元素只保留文字内容
    return Array.from(el.childNodes)
      .map((c, i) => walk(c, i === 0))
      .join("");
  };
  return Array.from(root.childNodes)
    .map((n, i) => walk(n, i === 0))
    .join("");
}

/* ---- 便签编辑器：React 只在挂载时初始化一次，之后绝不重新渲染，
   避免框架与浏览器富文本编辑的 DOM 冲突 ---- */
const NoteEditor = memo(
  function NoteEditor({
    initialHtml,
    onInput,
    register,
  }: {
    initialHtml: string;
    onInput: (html: string) => void;
    register: (el: HTMLDivElement | null) => void;
  }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = ref.current;
      if (el) el.innerHTML = initialHtml;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleInput = () => {
      const el = ref.current;
      if (el) onInput(serializeEditor(el));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      // Ctrl+B / Cmd+B 加粗选中文字
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        document.execCommand("bold");
        handleInput();
      }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
    };

    return (
      <div
        ref={(el) => {
          ref.current = el;
          register(el);
        }}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        data-placeholder="写点什么…"
        className="note-editor flex-1 min-h-[120px] overflow-y-auto bg-transparent border-none outline-none text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words"
      />
    );
  },
  () => true // 永不因 props 变化重新渲染，DOM 完全交给浏览器
);

export default function Notes() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [showArchived, setShowArchived] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  // 每张便签的本地草稿和防抖计时器
  const drafts = useRef<Record<number, string>>({});
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  // 便签 id → 编辑器 DOM 元素（用于跨设备同步时直接更新内容）
  const editors = useRef(new Map<number, HTMLDivElement>());
  // 每张便签最近一次确认与云端一致的内容（避免重复写入 DOM）
  const lastSynced = useRef<Record<number, string>>({});

  const { data: notes, isLoading: notesLoading } = trpc.notes.list.useQuery(
    { archived: showArchived },
    { enabled: isAuthenticated, refetchInterval: 10000 }
  );

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => utils.notes.list.invalidate(),
  });

  const updateNote = trpc.notes.update.useMutation({
    onSuccess: () => {
      setSaveStatus("已保存");
      utils.notes.list.invalidate();
    },
    onError: () => setSaveStatus("保存失败"),
  });
  const updateNoteRef = useRef(updateNote);
  updateNoteRef.current = updateNote;

  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => utils.notes.list.invalidate(),
  });

  useEffect(() => {
    if (!saveStatus) return;
    const t = setTimeout(() => setSaveStatus(""), 500);
    return () => clearTimeout(t);
  }, [saveStatus]);

  // 某张便签是否有"尚未送达云端"的本地修改
  const hasPending = (id: number) =>
    drafts.current[id] !== undefined || saveTimers.current[id] !== undefined;

  // 立刻把所有待保存的修改发出去（切走页面/关闭页面时调用，不再等防抖）
  const flushPendingSaves = useCallback(() => {
    for (const idStr of Object.keys(saveTimers.current)) {
      const id = Number(idStr);
      clearTimeout(saveTimers.current[id]);
      delete saveTimers.current[id];
      const content = drafts.current[id];
      if (content !== undefined) {
        updateNoteRef.current.mutate({ id, content });
        delete drafts.current[id];
      }
    }
  }, []);

  // 从云端拉取最新数据（先冲刷本地待保存内容，再拉取）
  const syncFromCloud = useCallback(() => {
    flushPendingSaves();
    utils.notes.list
      .invalidate()
      .then(() => setSaveStatus("已从云端同步"))
      .catch(() => setSaveStatus("同步失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushPendingSaves]);

  // 卸载时清除所有防抖计时器
  useEffect(() => {
    const timers = saveTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  // 首次打开页面：数据加载完成后提示一次
  const firstLoadDone = useRef(false);
  useEffect(() => {
    if (!firstLoadDone.current && !notesLoading && notes) {
      firstLoadDone.current = true;
      setSaveStatus("已从云端同步");
    }
  }, [notesLoading, notes]);

  // 页面变为活动状态（切回标签页/PWA 窗口获得焦点）时，自动从云端拉取最新数据；
  // 页面被切走/关闭时，立刻把未保存的修改发出去
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") syncFromCloud();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushPendingSaves();
    };
    const onPageHide = () => flushPendingSaves();
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("focus", syncFromCloud);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("focus", syncFromCloud);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [syncFromCloud, flushPendingSaves]);

  // 跨设备同步：数据变化时，直接更新编辑器内容。
  // 唯一跳过条件：这张便签有"还没送达云端"的本地修改（避免覆盖正在输入的内容）。
  // 注意：不再因为"光标在便签里"而跳过——否则只要点过某张便签，
  // 焦点滞留会导致它永远收不到其他设备的更新。
  useEffect(() => {
    if (!notes) return;
    for (const n of notes) {
      const el = editors.current.get(n.id);
      if (!el) continue;
      if (hasPending(n.id)) continue;
      if (lastSynced.current[n.id] === n.content) continue;
      // 双保险：编辑器当前序列化结果与云端一致时也无需触碰 DOM
      if (serializeEditor(el) === n.content) {
        lastSynced.current[n.id] = n.content;
        continue;
      }
      el.innerHTML = toHtml(n.content);
      lastSynced.current[n.id] = n.content;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const handleEdit = useCallback((id: number, content: string) => {
    drafts.current[id] = content;
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      delete saveTimers.current[id];
      const c = drafts.current[id];
      delete drafts.current[id];
      if (c !== undefined) updateNoteRef.current.mutate({ id, content: c });
    }, 1200);
  }, []);

  const handleCreate = () => {
    const count = notes?.length ?? 0;
    createNote.mutate({ color: COLOR_ORDER[count % COLOR_ORDER.length] });
  };

  const noteCountLabel = useMemo(() => {
    if (!notes) return "";
    return showArchived ? `已归档 ${notes.length} 张` : `使用中 ${notes.length} 张`;
  }, [notes, showArchived]);

  // 未登录
  if (!isAuthenticated && !authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-6">
          <h1 className="text-3xl font-semibold text-gray-800">便签</h1>
          <p className="text-gray-500 text-sm">登录后同步你的便签</p>
          <Button size="lg" className="w-48" onClick={() => navigate("/login")}>
            去登录
          </Button>
        </div>
      </div>
    );
  }

  if (authLoading || notesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶栏 */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-medium text-gray-800">便签</h1>
          <button
            onClick={() => navigate("/")}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
          >
            <Clock className="w-3.5 h-3.5" />
            打卡
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{saveStatus}</span>
          <button
            onClick={syncFromCloud}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="立即从云端同步"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center">
              <User className="w-4 h-4 text-gray-500" />
            </div>
          )}
          <span className="text-sm text-gray-700">{user?.name ?? "User"}</span>
          <button
            onClick={logout}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* 工具栏 */}
        <div className="flex items-center gap-3 mb-5">
          <Button onClick={handleCreate} disabled={createNote.isPending} size="sm">
            {createNote.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Plus className="w-4 h-4 mr-1" />
            )}
            新建便签
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "返回使用中" : "查看已归档"}
          </Button>
          <span className="text-xs text-gray-400 ml-auto">{noteCountLabel}</span>
        </div>

        {/* 便签网格 */}
        {notes && notes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                draft={drafts.current[note.id]}
                onEdit={handleEdit}
                registerEditor={(el) => {
                  if (el) {
                    editors.current.set(note.id, el);
                    lastSynced.current[note.id] = note.content;
                  } else {
                    editors.current.delete(note.id);
                    delete lastSynced.current[note.id];
                  }
                }}
                onToggleArchive={() =>
                  updateNote.mutate({ id: note.id, archived: !note.archived })
                }
                onDelete={() => {
                  if (window.confirm("确定删除这张便签吗？删除后无法恢复。")) {
                    deleteNote.mutate({ id: note.id });
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-400 text-sm py-16">
            {showArchived
              ? "暂无已归档便签。"
              : '暂无便签，点击"新建便签"开始记录。'}
          </p>
        )}
      </div>
    </div>
  );
}

function NoteCard({
  note,
  draft,
  onEdit,
  registerEditor,
  onToggleArchive,
  onDelete,
}: {
  note: {
    id: number;
    content: string;
    color: string;
    archived: boolean;
    updatedAt: Date | string;
  };
  draft: string | undefined;
  onEdit: (id: number, content: string) => void;
  registerEditor: (el: HTMLDivElement | null) => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const colorClass =
    COLOR_STYLES[(note.color as NoteColor)] ?? COLOR_STYLES.yellow;

  // 卡片高度：可拖拽调整，记住在本设备上
  const heightKey = `note_height_${note.id}`;
  const [height, setHeight] = useState<number | null>(() => {
    const saved = localStorage.getItem(heightKey);
    return saved ? parseInt(saved, 10) : null;
  });

  const saveHeight = (el: HTMLDivElement) => {
    const h = el.offsetHeight;
    if (h && h !== height) {
      setHeight(h);
      localStorage.setItem(heightKey, String(h));
    }
  };

  // 初始内容只在挂载时计算一次（之后编辑器 DOM 由浏览器接管，
  // 跨设备同步由父组件通过 registerEditor 拿到的元素直接更新）
  const [initialHtml] = useState(() => toHtml(draft ?? note.content));
  const handleEditorInput = useCallback(
    (html: string) => onEdit(note.id, html),
    [onEdit, note.id]
  );

  return (
    <div
      className={`${colorClass} rounded-lg shadow-sm hover:shadow-md transition-shadow p-3 flex flex-col resize-y overflow-auto`}
      style={{
        minHeight: 180,
        height: height ?? undefined,
        maxHeight: "80vh",
      }}
      onMouseUp={(e) => saveHeight(e.currentTarget)}
      onTouchEnd={(e) => saveHeight(e.currentTarget)}
    >
      <NoteEditor
        initialHtml={initialHtml}
        onInput={handleEditorInput}
        register={registerEditor}
      />
      <div className="flex items-center justify-between mt-2 pt-1">
        <span className="text-[11px] text-gray-500/70 tabular-nums">
          {new Date(note.updatedAt).toLocaleString("zh-CN", { hour12: false })}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleArchive}
            className="p-1.5 rounded text-gray-500/70 hover:text-gray-700 hover:bg-black/5 transition-colors"
            title={note.archived ? "恢复" : "归档"}
          >
            {note.archived ? (
              <ArchiveRestore className="w-3.5 h-3.5" />
            ) : (
              <Archive className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded text-gray-500/70 hover:text-red-600 hover:bg-black/5 transition-colors"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
