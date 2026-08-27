import {
  Bath,
  BriefcaseBusiness,
  CakeSlice,
  Check,
  Clock3,
  Gift,
  Heart,
  PackageOpen,
  Sparkles,
  Star,
  Utensils,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { JOBS } from "../shared/care";
import type { AppSnapshot, FoodId, JobId } from "../shared/types";
import { bridge } from "../useCompanion";
import { StatBar } from "./Controls";

const FOOD_LABELS: Record<FoodId, string> = {
  "fish-snack": "小鱼干",
  milk: "牛奶",
  "tuna-bites": "金枪鱼小方",
  salmon: "三文鱼片",
};

const FOOD_ICONS: Record<FoodId, typeof CakeSlice> = {
  "fish-snack": CakeSlice,
  milk: Utensils,
  "tuna-bites": PackageOpen,
  salmon: Sparkles,
};

const JOB_LABELS: Record<JobId, string> = {
  "desk-organizer": "整理桌面",
  "code-helper": "代码小助手",
  "delivery-run": "快乐跑腿",
};

const JOB_DESCRIPTIONS: Record<JobId, string> = {
  "desk-organizer": "把桌面收拾得井井有条",
  "code-helper": "陪你一起处理代码任务",
  "delivery-run": "出发完成一趟小小委托",
};

function formatDuration(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function rewardText(
  reward: { experience: number; food: Partial<Record<FoodId, number>>; giftBoxes: number },
  bonusGiftChance = 0,
): string {
  const items = Object.entries(reward.food)
    .filter(([, quantity]) => quantity && quantity > 0)
    .map(([foodId, quantity]) => `${FOOD_LABELS[foodId as FoodId]} x${quantity}`);
  if (reward.giftBoxes > 0) items.push(`礼包 x${reward.giftBoxes}`);
  if (bonusGiftChance > 0) items.push(`${Math.round(bonusGiftChance * 100)}% 礼包机会`);
  if (reward.experience > 0) items.push(`经验 +${reward.experience}`);
  return items.join("、");
}

export function CareView({ snapshot }: { snapshot: AppSnapshot }) {
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!snapshot.activeJob) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.activeJob]);

  const runAction = async (action: () => Promise<AppSnapshot>) => {
    setNotice("");
    try {
      const next = await action();
      setNotice(next.stateMessage || "操作完成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后再试");
    }
  };

  const activeJob = snapshot.activeJob;
  const remaining = activeJob ? Math.max(0, activeJob.completesAt - now) : 0;

  return (
    <div className="view care-view">
      <section className="care-header section-block">
        <div>
          <span className="eyebrow">日常照料</span>
          <h2>照顾小满</h2>
          <p className="care-subtitle">把每一天过得饱满又有趣</p>
        </div>
        <div className="care-level-summary" aria-label={`等级 ${snapshot.stats.level}，经验 ${snapshot.stats.experience}`}>
          <span className="care-level-icon"><Star size={18} /></span>
          <span><small>等级</small><strong>Lv. {snapshot.stats.level}</strong></span>
          <span className="care-experience"><span style={{ width: `${snapshot.stats.experience % 100}%` }} /></span>
          <small>{snapshot.stats.experience % 100} / 100 经验</small>
        </div>
      </section>

      <section className="care-stats section-block" aria-labelledby="care-stats-title">
        <div className="section-heading"><div><span className="eyebrow">状态</span><h3 id="care-stats-title">小满今天感觉怎么样</h3></div></div>
        <div className="care-stat-grid">
          <StatBar icon={<CakeSlice size={16} />} label="饱食度" value={snapshot.stats.fullness} tone="coral" />
          <StatBar icon={<Zap size={16} />} label="精力" value={snapshot.stats.energy} tone="blue" />
          <StatBar icon={<Heart size={16} />} label="好感度" value={snapshot.stats.affection} tone="green" />
          <StatBar icon={<Sparkles size={16} />} label="清洁度" value={snapshot.stats.cleanliness} tone="green" />
        </div>
      </section>

      <div className="care-columns">
        <section className="section-block care-panel care-inventory" aria-labelledby="care-inventory-title">
          <div className="section-heading"><div><span className="eyebrow">补给</span><h3 id="care-inventory-title">食物库存</h3></div></div>
          <div className="care-food-list">
            {(Object.keys(FOOD_LABELS) as FoodId[]).map((foodId) => {
              const quantity = snapshot.inventory.food[foodId];
              const Icon = FOOD_ICONS[foodId];
              return (
                <div className="care-food-row" key={foodId}>
                  <span className="care-food-icon"><Icon size={17} /></span>
                  <span className="care-item-copy"><strong>{FOOD_LABELS[foodId]}</strong><small>库存 {quantity}</small></span>
                  <button type="button" className="care-action-button" disabled={quantity <= 0} onClick={() => void runAction(() => bridge.feedFood(foodId))}>
                    <Utensils size={15} />
                    <span>{quantity <= 0 ? "已用完" : "喂食"}</span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="care-gift-row">
            <span className="care-food-icon gift"><Gift size={18} /></span>
            <span className="care-item-copy"><strong>惊喜礼包</strong><small>库存 {snapshot.inventory.giftBoxes} 个</small></span>
            <button type="button" className="care-action-button care-gift-button" disabled={snapshot.inventory.giftBoxes <= 0} onClick={() => void runAction(() => bridge.openGiftBox())}>
              <PackageOpen size={15} /><span>打开</span>
            </button>
          </div>
          <div className="care-reward-note">
            <Sparkles size={16} aria-hidden="true" />
            <span><strong>小鱼干从哪里来</strong><small>每个真实完成的 Codex 任务奖励 1 份；打工、每日任务和礼包也会补充库存。Codex 奖励按任务只发一次，小游戏只增加好感度和经验。</small></span>
          </div>
        </section>

        <section className="section-block care-panel care-bath-panel" aria-labelledby="care-bath-title">
          <div className="section-heading"><div><span className="eyebrow">清洁</span><h3 id="care-bath-title">洗澡时间</h3></div></div>
          <div className="care-bath-content"><span className="care-bath-icon"><Bath size={30} /></span><p>洗香香，清洁度大幅提升，也会让小满更开心。</p></div>
          <button type="button" className="care-primary-button" onClick={() => void runAction(() => bridge.bathePet())}><Bath size={16} /><span>给小满洗澡</span></button>
        </section>
      </div>

      <section className="section-block care-panel" aria-labelledby="care-jobs-title">
        <div className="section-heading"><div><span className="eyebrow">赚取奖励</span><h3 id="care-jobs-title">打工</h3></div><span className="care-energy-note"><Zap size={14} />开始打工需要 4 点精力</span></div>
        <div className="care-job-list">
          {(Object.keys(JOBS) as JobId[]).map((jobId) => {
            const job = JOBS[jobId];
            const isActive = activeJob?.id === jobId;
            return (
              <article className={`care-job-card ${isActive ? "is-active" : ""}`} key={jobId}>
                <div className="care-job-icon"><BriefcaseBusiness size={19} /></div>
                <div className="care-job-copy"><strong>{JOB_LABELS[jobId]}</strong><p>{JOB_DESCRIPTIONS[jobId]}</p><small><Clock3 size={13} />{formatDuration(job.duration)} · {rewardText(job.reward, job.bonusGiftChance)}</small></div>
                {isActive ? (
                  <div className="care-job-status">
                    <strong>{remaining > 0 ? `剩余 ${formatDuration(remaining)}` : "可以领取奖励"}</strong>
                    {remaining > 0 ? (
                      <button type="button" className="care-cancel-button" onClick={() => void runAction(() => bridge.cancelPetJob())}>取消打工</button>
                    ) : (
                      <button type="button" className="care-action-button" onClick={() => void runAction(() => bridge.collectPetJob())}>领取奖励</button>
                    )}
                  </div>
                ) : (
                  <button type="button" className="care-action-button" disabled={Boolean(activeJob) || snapshot.stats.energy < 4} onClick={() => void runAction(() => bridge.startPetJob(jobId))}>开始</button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-block care-panel" aria-labelledby="care-quests-title">
        <div className="section-heading"><div><span className="eyebrow">今日目标</span><h3 id="care-quests-title">每日任务</h3></div><small className="care-quest-count">完成任务，领取额外奖励</small></div>
        <div className="care-quest-list">
          {snapshot.dailyQuests.map((quest) => {
            const complete = quest.progress >= quest.target;
            return <div className={`care-quest-row ${quest.claimed ? "is-claimed" : ""}`} key={quest.id}><span className="care-quest-check">{quest.claimed ? <Check size={15} /> : <span />}</span><span className="care-item-copy"><strong>{quest.title}</strong><small>{quest.progress} / {quest.target} · {rewardText(quest.reward)}</small></span><button type="button" className="care-action-button" disabled={!complete || quest.claimed} onClick={() => void runAction(() => bridge.claimDailyQuest(quest.id))}>{quest.claimed ? "已领取" : "领取奖励"}</button></div>;
          })}
        </div>
      </section>

      <div className="care-notice" aria-live="polite" aria-atomic="true">{notice}</div>
    </div>
  );
}
