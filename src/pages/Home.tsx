import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User, Clock, Loader2, StickyNote } from "lucide-react";
import { useNavigate } from "react-router";
import Notes from "./Notes";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 宽屏（>=1024px）时把便签并排显示在左侧，这样一个 PWA 窗口就够用，
// 不必同时开"打卡"和"便签"两个进程（每个都是一套完整的浏览器内核，很占内存）。
// 用 matchMedia 监听而不是纯 CSS 隐藏：窄屏时便签组件干脆不挂载，
// 它的轮询、编辑器 DOM 都不会产生，手机上零额外开销。
function useIsWideScreen() {
  const [isWide, setIsWide] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isWide;
}

// 打卡记录会不断累积（目前已经 800+ 条），全部渲染成 DOM 会拖慢页面、
// 占内存。只在页面上显示最近 100 条，更早的记录仍完整保存在云端数据库。
const MAX_VISIBLE_CHECKINS = 100;

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const isWide = useIsWideScreen();

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: timer, isLoading: timerLoading } = trpc.timer.get.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const { data: checkIns, isLoading: checkInsLoading } =
    trpc.checkIn.list.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30000 });

  const createTimer = trpc.timer.create.useMutation({
    onSuccess: () => utils.timer.get.invalidate(),
  });

  const [saveStatus, setSaveStatus] = useState("");

  const createCheckIn = trpc.checkIn.create.useMutation({
    onSuccess: () => {
      utils.checkIn.list.invalidate();
      setSaveStatus("已保存");
    },
    onError: () => setSaveStatus("保存失败"),
  });

  useEffect(() => {
    if (!saveStatus) return;
    const t = setTimeout(() => setSaveStatus(""), 500);
    return () => clearTimeout(t);
  }, [saveStatus]);

  // 首次打开页面：数据加载完成后提示一次
  const firstLoadDone = useRef(false);
  useEffect(() => {
    if (!firstLoadDone.current && !checkInsLoading && checkIns) {
      firstLoadDone.current = true;
      setSaveStatus("已从云端同步");
    }
  }, [checkInsLoading, checkIns]);

  // 页面变为活动状态时，自动从云端拉取最新打卡数据
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      Promise.all([
        utils.checkIn.list.invalidate(),
        utils.timer.get.invalidate(),
      ])
        .then(() => setSaveStatus("已从云端同步"))
        .catch(() => setSaveStatus("同步失败"));
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer tick effect
  useEffect(() => {
    if (!timer) {
      setElapsed(0);
      return;
    }

    const start = new Date(timer.startTime).getTime();

    const tick = () => {
      setElapsed(Date.now() - start);
    };

    tick(); // initial
    timerRef.current = setInterval(tick, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timer]);

  const handleMark = useCallback(() => {
    if (!timer) {
      // First check-in: create timer then check-in
      const now = new Date().toISOString();
      createTimer.mutate(
        { startTime: now },
        {
          onSuccess: (timerResult) => {
            createCheckIn.mutate({
              timerId: timerResult.id,
              timestamp: now,
            });
          },
        }
      );
    } else {
      createCheckIn.mutate({
        timerId: timer.id,
        timestamp: new Date().toISOString(),
      });
    }
  }, [timer, createTimer, createCheckIn]);

  const isMarking = createTimer.isPending || createCheckIn.isPending;

  // Not authenticated view
  if (!isAuthenticated && !authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-gray-800">
              Task Timer
            </h1>
            <p className="text-gray-500 text-sm">
              Track your tasks with precise timestamps
            </p>
          </div>

          <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center">
            <Clock className="w-8 h-8 text-gray-400" />
          </div>

          <Button
            size="lg"
            className="w-48"
            onClick={() => navigate("/login")}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (authLoading || timerLoading || checkInsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Authenticated view
  return (
    <div className="min-h-screen bg-white lg:h-screen lg:flex lg:flex-col">
      {/* Auth Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        {isWide ? (
          <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Task Timer
          </span>
        ) : (
          <button
            onClick={() => navigate("/notes")}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
          >
            <StickyNote className="w-3.5 h-3.5" />
            便签
          </button>
        )}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{saveStatus}</span>
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center">
              <User className="w-4 h-4 text-gray-500" />
            </div>
          )}
          <span className="text-sm text-gray-700">{user?.name ?? "User"}</span>
          <button
            onClick={logout}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 宽屏：左便签 + 右打卡 并排，各自独立滚动；窄屏：只有打卡 */}
      <div className="lg:flex-1 lg:min-h-0 lg:flex">
        {isWide && (
          <div className="lg:w-1/2 lg:border-r lg:border-gray-100 lg:overflow-y-auto bg-gray-50">
            <Notes embedded />
          </div>
        )}

        {/* Main Content */}
        <div className="lg:w-1/2 lg:overflow-y-auto">
          <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
            {/* Timer Display */}
            <div className="text-center space-y-4">
              <div className="text-4xl font-light text-gray-800 tabular-nums tracking-wide">
                {formatDuration(elapsed)}
              </div>

              <Button
                onClick={handleMark}
                disabled={isMarking}
                size="lg"
                variant="outline"
                className="px-8 py-5 text-base border-gray-300 hover:bg-gray-50 transition-all active:scale-95"
              >
                {isMarking ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Mark Task
              </Button>
            </div>

            {/* Check-in List */}
            <div>
              <h2 className="text-lg font-medium text-gray-800 text-center mb-4">
                Task Markers
              </h2>

              {checkIns && checkIns.length > 0 ? (
                <>
                  <ul className="space-y-1.5">
                    {checkIns.slice(0, MAX_VISIBLE_CHECKINS).map((checkIn, index) => (
                      <li
                        key={checkIn.id}
                        className="bg-gray-50 rounded-md px-4 py-2.5 text-sm text-gray-700 text-center"
                      >
                        <span className="text-gray-400 mr-1">
                          {checkIns.length - index}.
                        </span>
                        Task completed at:{" "}
                        <span className="tabular-nums">
                          {formatDateTime(checkIn.timestamp)}
                        </span>{" "}
                        <span className="text-gray-500">
                          (Interval:{" "}
                          <span className="tabular-nums">{checkIn.intervalSeconds}</span>)
                        </span>
                      </li>
                    ))}
                  </ul>
                  {checkIns.length > MAX_VISIBLE_CHECKINS && (
                    <p className="text-center text-xs text-gray-400 mt-3">
                      仅显示最近 {MAX_VISIBLE_CHECKINS} 条，共 {checkIns.length}{" "}
                      条（更早的记录仍保存在云端）
                    </p>
                  )}
                </>
              ) : (
                <p className="text-center text-gray-400 text-sm py-8">
                  No tasks marked yet. Click "Mark Task" to get started.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
