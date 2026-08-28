import {
  Bath,
  BriefcaseBusiness,
  CakeSlice,
  Check,
  CircleDot,
  Clock3,
  Gift,
  Gamepad2,
  Heart,
  PackageOpen,
  Pause,
  Play,
  Sparkles,
  Star,
  Utensils,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { JOBS } from "../shared/care";
import { STATE_LABELS } from "../shared/domain";
import type { AppSnapshot, FoodId, JobId, QuickViewMode } from "../shared/types";
import { bridge, useCompanion } from "../useCompanion";

export interface QuickActionDescriptor {
  id: "feed" | "bath" | "gift" | "job" | "quest" | "bubble" | "pet" | "games";
  label: string;
}

export const QUICK_CARE_ACTIONS: readonly QuickActionDescriptor[] = [
  { id: "feed", label: "喂食" },
  { id: "bath", label: "洗澡" },
  { id: "gift", label: "礼包" },
  { id: "job", label: "打工" },
  { id: "quest", label: "任务" },
];

export const QUICK_INTERACTION_ACTIONS: readonly QuickActionDescriptor[] = [
  { id: "bubble", label: "桌面泡泡" },
  { id: "pet", label: "摸摸" },
  { id: "games", label: "更多游戏" },
];

export function parseQuickViewMode(value: string | null): QuickViewMode | null {
  return value === "care" || value === "interaction" ? value : null;
}

const FOOD_LABELS: Record<FoodId, string> = {
  "fish-snack": "小鱼干",
  milk: "牛奶",
  "tuna-bites": "金枪鱼小方",
  salmon: "三文鱼片",
};

const JOB_LABELS: Record<JobId, string> = {
  "desk-organizer": "整理桌面",
  "code-helper": "代码小助手",
  "delivery-run": "快乐跑腿",
};

const FOOD_IDS = Object.keys(FOOD_LABELS) as FoodId[];
const JOB_IDS = Object.keys(JOBS) as JobId[];

function formatRemaining(milliseconds: number): string {
  const minutes = Math.ceil(Math.max(0, milliseconds) / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function FoodIcon({ foodId }: { foodId: FoodId }) {
  if (foodId === "milk") return <Utensils size={17} aria-hidden="true" />;
  if (foodId === "tuna-bites") return <PackageOpen size={17} aria-hidden="true" />;
  if (foodId === "salmon") return <Sparkles size={17} aria-hidden="true" />;
  return <CakeSlice size={17} aria-hidden="true" />;
}

function QuickMeter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "coral" | "green" | "blue";
}) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="quick-meter" aria-label={`${label} ${Math.round(value)}`}>
      <div className="quick-meter-heading"><span>{label}</span><strong>{Math.round(value)}</strong></div>
      <div className="quick-meter-track"><span className={`tone-${tone}`} style={{ width: `${bounded}%` }} /></div>
    </div>
  );
}

function QuickSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="quick-section" aria-labelledby={`quick-${title}`}>
      <div className="quick-section-heading"><span className="quick-section-icon">{icon}</span><h2 id={`quick-${title}`}>{title}</h2></div>
      {children}
    </section>
  );
}

export function QuickActionsView({
  mode,
  embedded = false,
  onClose,
}: {
  mode: QuickViewMode;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const snapshot = useCompanion();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (mode !== "care" || !snapshot?.activeJob) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [mode, snapshot?.activeJob?.completesAt]);

  const runAction = async (key: string, action: () => Promise<AppSnapshot>) => {
    if (busy) return;
    setBusy(key);
    setFeedback("");
    try {
      const next = await action();
      setFeedback(next.stateMessage || "操作完成");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "操作失败，请稍后再试");
    } finally {
      setBusy(null);
    }
  };

  const close = onClose ?? (() => window.close());

  if (!snapshot) {
    return <main className={`quick-root ${embedded ? "overlay-quick-panel" : ""} quick-loading`}><span className="loading-pulse" /><strong>小满正在准备</strong></main>;
  }

  const activeJob = snapshot.activeJob;
  const remaining = activeJob ? Math.max(0, activeJob.completesAt - now) : 0;
  const desktopSession = snapshot.desktopInteraction;

  return (
    <main className={`quick-root ${embedded ? "overlay-quick-panel" : ""} quick-${mode}`} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
      <header className="quick-header">
        <div>
          <span className="eyebrow">小满 · 快捷操作</span>
          <h1>{mode === "care" ? "养成照料" : "互动"}</h1>
        </div>
        <div className="quick-header-actions">
          <div className="quick-level" aria-label={`等级 ${snapshot.stats.level}`}><Star size={15} /><span>Lv. {snapshot.stats.level}</span></div>
          <button
            className="quick-close-button"
            type="button"
            title="关闭面板"
            aria-label="关闭面板"
            onClick={(event) => {
              event.stopPropagation();
              close();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {mode === "care" ? (
        <div className="quick-content">
          <QuickSection title="状态" icon={<Heart size={17} aria-hidden="true" />}>
            <div className="quick-status-grid">
              <QuickMeter label="饱食度" value={snapshot.stats.fullness} tone="coral" />
              <QuickMeter label="精力" value={snapshot.stats.energy} tone="blue" />
              <QuickMeter label="好感度" value={snapshot.stats.affection} tone="green" />
              <QuickMeter label="清洁度" value={snapshot.stats.cleanliness} tone="green" />
            </div>
          </QuickSection>

          <QuickSection title="食物与礼包" icon={<CakeSlice size={17} aria-hidden="true" />}>
            <div className="quick-food-grid">
              {FOOD_IDS.map((foodId) => {
                const quantity = snapshot.inventory.food[foodId];
                return (
                  <div className="quick-list-row quick-food-row" key={foodId}>
                    <span className="quick-row-icon"><FoodIcon foodId={foodId} /></span>
                    <span className="quick-row-copy"><strong>{FOOD_LABELS[foodId]}</strong><small>库存 {quantity}</small></span>
                    <button className="quick-icon-label-button" type="button" disabled={quantity <= 0 || busy !== null} title={`喂食${FOOD_LABELS[foodId]}`} aria-label={`喂食${FOOD_LABELS[foodId]}`} onClick={() => void runAction(`feed-${foodId}`, () => bridge.feedFood(foodId))}>
                      <Utensils size={14} aria-hidden="true" /><span>{quantity <= 0 ? "用完" : "喂"}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="quick-list-row">
              <span className="quick-row-icon quick-gift-icon"><Gift size={17} aria-hidden="true" /></span>
              <span className="quick-row-copy"><strong>惊喜礼包</strong><small>剩余 {snapshot.inventory.giftBoxes} 个</small></span>
              <button className="quick-icon-label-button" type="button" disabled={snapshot.inventory.giftBoxes <= 0 || busy !== null} title="打开礼包" aria-label="打开礼包" onClick={() => void runAction("gift", () => bridge.openGiftBox())}>
                <PackageOpen size={14} aria-hidden="true" /><span>打开</span>
              </button>
            </div>
          </QuickSection>

          <QuickSection title="照料" icon={<Bath size={17} aria-hidden="true" />}>
            <div className="quick-care-actions">
              <button className="quick-wide-button" type="button" disabled={busy !== null} title="给小满洗澡" aria-label="给小满洗澡" onClick={() => void runAction("bath", () => bridge.bathePet())}><Bath size={16} aria-hidden="true" /><span>给小满洗澡</span></button>
              <span className="quick-inline-note">清洁度 {Math.round(snapshot.stats.cleanliness)} · 当前 {STATE_LABELS[snapshot.state]}</span>
            </div>
          </QuickSection>

          <QuickSection title="打工与任务" icon={<BriefcaseBusiness size={17} aria-hidden="true" />}>
            <div className="quick-job-list">
              {JOB_IDS.map((jobId) => {
                const job = JOBS[jobId];
                const isActive = activeJob?.id === jobId;
                return (
                  <div className={`quick-list-row quick-job-row ${isActive ? "is-active" : ""}`} key={jobId}>
                    <span className="quick-row-icon"><BriefcaseBusiness size={16} aria-hidden="true" /></span>
                    <span className="quick-row-copy"><strong>{JOB_LABELS[jobId]}</strong><small><Clock3 size={12} aria-hidden="true" /> {formatRemaining(job.duration)}</small></span>
                    {isActive ? (
                      <button className="quick-icon-label-button" type="button" disabled={busy !== null} title={remaining > 0 ? "取消打工" : "领取打工奖励"} aria-label={remaining > 0 ? "取消打工" : "领取打工奖励"} onClick={() => void runAction(remaining > 0 ? "cancel-job" : "collect-job", () => remaining > 0 ? bridge.cancelPetJob() : bridge.collectPetJob())}>
                        {remaining > 0 ? <Pause size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}<span>{remaining > 0 ? formatRemaining(remaining) : "领取"}</span>
                      </button>
                    ) : (
                      <button className="quick-icon-label-button" type="button" disabled={Boolean(activeJob) || snapshot.stats.energy < 4 || busy !== null} title="开始打工" aria-label={`开始${JOB_LABELS[jobId]}`} onClick={() => void runAction(`job-${jobId}`, () => bridge.startPetJob(jobId))}><Play size={14} aria-hidden="true" /><span>开始</span></button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="quick-quest-list">
              {snapshot.dailyQuests.map((quest) => {
                const complete = quest.progress >= quest.target;
                return (
                  <div className={`quick-list-row quick-quest-row ${quest.claimed ? "is-claimed" : ""}`} key={quest.id}>
                    <span className="quick-row-icon">{quest.claimed ? <Check size={15} aria-hidden="true" /> : <CircleDot size={15} aria-hidden="true" />}</span>
                    <span className="quick-row-copy"><strong>{quest.title}</strong><small>{quest.progress} / {quest.target}</small></span>
                    <button className="quick-icon-label-button" type="button" disabled={!complete || quest.claimed || busy !== null} title="领取任务奖励" aria-label={`领取${quest.title}奖励`} onClick={() => void runAction(`quest-${quest.id}`, () => bridge.claimDailyQuest(quest.id))}><Gift size={14} aria-hidden="true" /><span>{quest.claimed ? "已领" : "领取"}</span></button>
                  </div>
                );
              })}
            </div>
          </QuickSection>
        </div>
      ) : (
        <div className="quick-content">
          <QuickSection title="桌面泡泡" icon={<CircleDot size={17} aria-hidden="true" />}>
            <div className="quick-interaction-hero">
              <div><strong>{desktopSession.active ? "泡泡正在桌面上飘" : "让小满吐一会儿泡泡"}</strong><small>{desktopSession.active ? `已戳破 ${desktopSession.score} 个` : "泡泡会在小满上方出现，点一下就能戳破"}</small></div>
              <button className="quick-primary-icon-button" type="button" disabled={!snapshot.settings.gameModeEnabled || busy !== null} title={desktopSession.active ? "停止桌面泡泡" : "开始桌面泡泡"} aria-label={desktopSession.active ? "停止桌面泡泡" : "开始桌面泡泡"} onClick={() => {
                if (desktopSession.active && desktopSession.sessionId) {
                  void runAction("stop-bubbles", () => bridge.stopDesktopBubbleSession(desktopSession.sessionId!, false));
                } else {
                  void runAction("start-bubbles", () => bridge.startDesktopBubbleSession());
                }
              }}>
                {desktopSession.active ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
              </button>
            </div>
            {!snapshot.settings.gameModeEnabled && <p className="quick-disabled-note">互动模式目前关闭，请在完整设置中打开。</p>}
          </QuickSection>

          <QuickSection title="和小满相处" icon={<Heart size={17} aria-hidden="true" />}>
            <div className="quick-interaction-actions">
              <button className="quick-wide-button" type="button" disabled={busy !== null} title="摸摸小满" aria-label="摸摸小满" onClick={() => void runAction("pet", () => bridge.interact("pet"))}><Heart size={16} aria-hidden="true" /><span>摸摸</span></button>
              <button className="quick-wide-button" type="button" title="打开更多游戏" aria-label="打开更多游戏" onClick={(event) => { event.stopPropagation(); bridge.showCenter("games"); }}><Gamepad2 size={16} aria-hidden="true" /><span>更多游戏</span></button>
            </div>
            <div className="quick-interaction-summary"><Sparkles size={14} aria-hidden="true" /><span>好感度 {Math.round(snapshot.stats.affection)} · 精力 {Math.round(snapshot.stats.energy)}</span></div>
          </QuickSection>
        </div>
      )}

      <div className="quick-feedback" role="status" aria-live="polite" aria-atomic="true">{busy ? "小满正在回应…" : feedback}</div>
    </main>
  );
}
