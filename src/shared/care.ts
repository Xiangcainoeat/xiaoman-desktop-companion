import type { CareOperationResult, FoodId, JobId, PersistedData, RewardBundle } from "./types";

const FOOD_EFFECTS: Record<FoodId, { name: string; fullness: number; energy: number; affection: number }> = {
  "fish-snack": { name: "小鱼干", fullness: 18, energy: 1, affection: 1 },
  milk: { name: "牛奶", fullness: 12, energy: 5, affection: 2 },
  "tuna-bites": { name: "金枪鱼小方", fullness: 26, energy: 2, affection: 3 },
  salmon: { name: "三文鱼片", fullness: 38, energy: 6, affection: 4 },
};

export const JOBS: Record<JobId, { duration: number; reward: RewardBundle }> = {
  "desk-organizer": { duration: 10 * 60_000, reward: { food: { "fish-snack": 1 }, giftBoxes: 0, experience: 8 } },
  "code-helper": { duration: 25 * 60_000, reward: { food: { "fish-snack": 2 }, giftBoxes: 0, experience: 18 } },
  "delivery-run": { duration: 45 * 60_000, reward: { food: { milk: 1, "tuna-bites": 1 }, giftBoxes: 0, experience: 30 } },
};

export function canonicalJobReward(jobId: JobId): RewardBundle {
  const reward = JOBS[jobId].reward;
  return { food: { ...reward.food }, giftBoxes: reward.giftBoxes, experience: reward.experience };
}

function result(data: PersistedData, message?: string): CareOperationResult {
  return message ? { ok: true, data, message } : { ok: true, data };
}

function progress(data: PersistedData, kind: string): PersistedData {
  return {
    ...data,
    dailyQuests: data.dailyQuests.map((quest) => quest.kind === kind && quest.progress < quest.target
      ? { ...quest, progress: quest.progress + 1 }
      : quest),
  };
}

function addReward(data: PersistedData, reward: RewardBundle): PersistedData {
  const food = { ...data.inventory.food };
  for (const [id, quantity] of Object.entries(reward.food)) {
    if (id in food) food[id as FoodId] = Math.min(9999, food[id as FoodId] + Math.max(0, quantity ?? 0));
  }
  return {
    ...data,
    inventory: { food, giftBoxes: Math.min(9999, data.inventory.giftBoxes + reward.giftBoxes) },
    stats: { ...data.stats, experience: data.stats.experience + reward.experience, level: Math.max(1, Math.floor((data.stats.experience + reward.experience) / 100) + 1) },
  };
}

export function applyFeed(data: PersistedData, foodId: FoodId, now: number): CareOperationResult {
  const effect = FOOD_EFFECTS[foodId];
  if (!effect || data.inventory.food[foodId] <= 0) return { ok: false, message: `${effect?.name ?? "食物"}吃完啦` };
  const next = progress({
    ...data,
    inventory: { ...data.inventory, food: { ...data.inventory.food, [foodId]: data.inventory.food[foodId] - 1 } },
    stats: {
      ...data.stats,
      fullness: Math.min(100, data.stats.fullness + effect.fullness),
      energy: Math.min(100, data.stats.energy + effect.energy),
      affection: Math.min(100, data.stats.affection + effect.affection),
      meals: data.stats.meals + 1,
      interactions: data.stats.interactions + 1,
      lastFedAt: now,
      lastUpdatedAt: now,
    },
  }, "feed");
  return result(next, `吃了${effect.name}`);
}

export function applyBath(data: PersistedData, now: number): CareOperationResult {
  const next = progress({
    ...data,
    stats: { ...data.stats, cleanliness: Math.min(100, data.stats.cleanliness + 45), affection: Math.min(100, data.stats.affection + 2), energy: Math.max(0, data.stats.energy - 1), interactions: data.stats.interactions + 1, lastUpdatedAt: now },
  }, "bathe");
  return result(next, "洗得香香的");
}

export function startPetJob(data: PersistedData, jobId: JobId, now: number): CareOperationResult {
  const job = JOBS[jobId];
  if (!job) return { ok: false, message: "没有这个打工" };
  if (data.activeJob) return { ok: false, message: "已经在打工啦" };
  if (data.stats.energy < 4) return { ok: false, message: "精力不够啦" };
  const started = {
    ...data,
    stats: { ...data.stats, energy: data.stats.energy - 4, lastUpdatedAt: now },
    activeJob: { id: jobId, startedAt: now, completesAt: now + job.duration, reward: canonicalJobReward(jobId) },
  };
  return result(started, "开始打工啦");
}

export function completePetJob(data: PersistedData, now: number): CareOperationResult {
  if (!data.activeJob) return { ok: false, message: "现在没有打工" };
  if (now < data.activeJob.completesAt) return { ok: false, message: "打工还没完成" };
  const next = addReward(progress({ ...data, activeJob: null }, "work"), data.activeJob.reward);
  return result(next, "打工完成啦");
}

export function openGiftBox(data: PersistedData, random: () => number): CareOperationResult {
  if (data.inventory.giftBoxes <= 0) return { ok: false, message: "礼包用完啦" };
  const roll = Math.max(0, Math.min(0.999999, random()));
  const foodId: FoodId = roll < 0.45 ? "fish-snack" : roll < 0.75 ? "milk" : roll < 0.95 ? "tuna-bites" : "salmon";
  const next = progress({ ...data, inventory: { ...data.inventory, giftBoxes: data.inventory.giftBoxes - 1, food: { ...data.inventory.food, [foodId]: Math.min(9999, data.inventory.food[foodId] + 1) } } }, "open-gift");
  return result(next, `获得了${FOOD_EFFECTS[foodId].name}`);
}

export function claimDailyQuest(data: PersistedData, questId: string, now: number): CareOperationResult {
  const quest = data.dailyQuests.find((item) => item.id === questId);
  if (!quest) return { ok: false, message: "任务不存在" };
  if (quest.claimed || quest.progress < quest.target) return { ok: false, message: quest.claimed ? "任务奖励已经领取啦" : "任务还没完成" };
  const rewarded = addReward({ ...data, dailyQuests: data.dailyQuests.map((item) => item.id === questId ? { ...item, claimed: true } : item) }, quest.reward);
  return result({ ...rewarded, stats: { ...rewarded.stats, lastUpdatedAt: now } }, "领取成功");
}

export function grantCodexCompletionReward(data: PersistedData, key: string, random: () => number, now: number): CareOperationResult {
  if (data.codexRewardLedger.includes(key)) return { ok: true, data };
  const ledger = [...data.codexRewardLedger, key].slice(-120);
  let next = progress({ ...data, codexRewardLedger: ledger, stats: { ...data.stats, lastUpdatedAt: now } }, "codex-complete");
  next = addReward(next, { food: { "fish-snack": 1 }, giftBoxes: random() < 0.18 ? 1 : 0, experience: 0 });
  return result(next, "Codex 完成奖励");
}
