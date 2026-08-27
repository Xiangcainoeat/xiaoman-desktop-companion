import type {
  AppRuleInput,
  AppSnapshot,
  CompanionSettings,
  CodexOpenResult,
  CodexReplyResult,
  CodexThreadListResult,
  CursorPayload,
  FoodId,
  GameId,
  JobId,
  InteractionAction,
  ReminderInput,
  SoundName,
} from "./shared/types";

export interface XiaomanApi {
  getSnapshot(): Promise<AppSnapshot>;
  interact(action: InteractionAction): Promise<AppSnapshot>;
  feedFood(foodId: FoodId): Promise<AppSnapshot>;
  bathePet(): Promise<AppSnapshot>;
  openGiftBox(): Promise<AppSnapshot>;
  startPetJob(jobId: JobId): Promise<AppSnapshot>;
  collectPetJob(): Promise<AppSnapshot>;
  cancelPetJob(): Promise<AppSnapshot>;
  claimDailyQuest(questId: string): Promise<AppSnapshot>;
  setGameActive(active: boolean): void;
  completeGame(gameId: GameId, score: number): Promise<AppSnapshot>;
  saveReminder(input: ReminderInput): Promise<AppSnapshot>;
  removeReminder(id: string): Promise<AppSnapshot>;
  toggleReminder(id: string): Promise<AppSnapshot>;
  saveRule(input: AppRuleInput): Promise<AppSnapshot>;
  removeRule(id: string): Promise<AppSnapshot>;
  toggleRule(id: string): Promise<AppSnapshot>;
  updateSettings(patch: Partial<CompanionSettings>): Promise<AppSnapshot>;
  updateIdlePhrases(phrases: string[]): Promise<AppSnapshot>;
  testNotification(): Promise<void>;
  clearActivity(): Promise<AppSnapshot>;
  listCodexThreads(force?: boolean): Promise<CodexThreadListResult>;
  openCodexThread(threadId: string): Promise<CodexOpenResult>;
  replyCodexThread(threadId: string, message: string): Promise<CodexReplyResult>;
  setOverlayTaskPanel(open: boolean): void;
  showCenter(): void;
  toggleOverlay(): void;
  moveOverlayBy(deltaX: number, deltaY: number): void;
  showOverlayMenu(): void;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onCursor(callback: (payload: CursorPayload) => void): () => void;
  onSound(callback: (sound: SoundName) => void): () => void;
}

declare global {
  interface Window {
    xiaoman?: XiaomanApi;
  }
}
