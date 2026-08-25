import type {
  AppRuleInput,
  AppSnapshot,
  CompanionSettings,
  CursorPayload,
  InteractionAction,
  ReminderInput,
  SoundName,
} from "./shared/types";

export interface XiaomanApi {
  getSnapshot(): Promise<AppSnapshot>;
  interact(action: InteractionAction): Promise<AppSnapshot>;
  saveReminder(input: ReminderInput): Promise<AppSnapshot>;
  removeReminder(id: string): Promise<AppSnapshot>;
  toggleReminder(id: string): Promise<AppSnapshot>;
  saveRule(input: AppRuleInput): Promise<AppSnapshot>;
  removeRule(id: string): Promise<AppSnapshot>;
  toggleRule(id: string): Promise<AppSnapshot>;
  updateSettings(patch: Partial<CompanionSettings>): Promise<AppSnapshot>;
  testNotification(): Promise<void>;
  clearActivity(): Promise<AppSnapshot>;
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
