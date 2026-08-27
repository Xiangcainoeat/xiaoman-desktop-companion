import type {
  AppRuleInput,
  AppSnapshot,
  CenterTab,
  CompanionSettings,
  CodexOpenResult,
  CodexReplyResult,
  CodexThreadListResult,
  CursorPayload,
  QuickViewMode,
  FoodId,
  GameId,
  GameStartResult,
  JobId,
  InteractionAction,
  OverlayInteractionReport,
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
  startGameSession(): Promise<GameStartResult>;
  completeGame(gameId: GameId, score: number): Promise<AppSnapshot>;
  startDesktopBubbleSession(): Promise<AppSnapshot>;
  hitDesktopBubble(sessionId: string, bubbleId: string): Promise<AppSnapshot>;
  stopDesktopBubbleSession(sessionId: string, completed: boolean): Promise<AppSnapshot>;
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
  showCenter(tab?: CenterTab): void;
  showQuickWindow(mode: QuickViewMode): void;
  quitApp(): void;
  toggleOverlay(): void;
  moveOverlayBy(deltaX: number, deltaY: number): void;
  setOverlayMouseMode(mode: "passthrough" | "interactive"): void;
  reportOverlayHitRegions(report: OverlayInteractionReport): void;
  showOverlayMenu(): void;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onCursor(callback: (payload: CursorPayload) => void): () => void;
  onSound(callback: (sound: SoundName) => void): () => void;
  onCenterTab(callback: (tab: CenterTab) => void): () => void;
}

declare global {
  interface Window {
    xiaoman?: XiaomanApi;
  }
}
