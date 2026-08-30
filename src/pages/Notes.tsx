import { useEffect, useMemo, useRef, useState } from "react";
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

export default function Notes() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [showArchived, setShowArchived] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  // 每张便签的本地草稿和防抖计时器
  const drafts = useRef<Record<number, string>>({});
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const { data: notes, isLoading: notesLoading } = trpc.notes.list.useQuery(
    { archived: showArchived },
    { enabled: isAuthenticated }
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

  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => utils.notes.list.invalidate(),
  });

  useEffect(() => {
    if (!saveStatus) return;
    const t = setTimeout(() => setSaveStatus(""), 2000);
    return () => clearTimeout(t);
  }, [saveStatus]);

  // 卸载时清除所有防抖计时器
  useEffect(() => {
    const timers = saveTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const handleEdit = (id: number, content: string) => {
    drafts.current[id] = content;
    clearTimeout(saveTimers.current[id]);
    setSaveStatus("保存中…");
    saveTimers.current[id] = setTimeout(() => {
      updateNote.mutate({ id, content });
      delete drafts.current[id];
    }, 1200);
  };

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
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const colorClass =
    COLOR_STYLES[(note.color as NoteColor)] ?? COLOR_STYLES.yellow;
  // 有本地草稿（尚未保存）时显示草稿，否则显示数据库内容
  const [value, setValue] = useState(draft ?? note.content);

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

  // 数据库内容更新且没有未保存草稿时，同步到本地
  useEffect(() => {
    setValue((current) => (draft !== undefined ? current : note.content));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.content]);

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
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onEdit(note.id, e.target.value);
        }}
        placeholder="写点什么…"
        className="flex-1 bg-transparent border-none resize-none outline-none text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 min-h-[120px]"
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
