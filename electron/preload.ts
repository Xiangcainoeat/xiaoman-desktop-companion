import { contextBridge, ipcRenderer } from "electron";
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
} from "../src/shared/types";

contextBridge.exposeInMainWorld("xiaoman", {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("snapshot:get"),
  interact: (action: InteractionAction): Promise<AppSnapshot> => ipcRenderer.invoke("interaction:perform", action),
  feedFood: (foodId: FoodId): Promise<AppSnapshot> => ipcRenderer.invoke("care:feed-food", foodId),
  bathePet: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:bathe-pet"),
  openGiftBox: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:open-gift-box"),
  startPetJob: (jobId: JobId): Promise<AppSnapshot> => ipcRenderer.invoke("care:start-pet-job", jobId),
  collectPetJob: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:collect-pet-job"),
  cancelPetJob: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:cancel-pet-job"),
  claimDailyQuest: (questId: string): Promise<AppSnapshot> => ipcRenderer.invoke("care:claim-daily-quest", questId),
  setGameActive: (active: boolean): void => ipcRenderer.send("game:set-active", active),
  completeGame: (gameId: GameId, score: number): Promise<AppSnapshot> => ipcRenderer.invoke("game:complete", gameId, score),
  saveReminder: (input: ReminderInput): Promise<AppSnapshot> => ipcRenderer.invoke("reminder:save", input),
  removeReminder: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("reminder:remove", id),
  toggleReminder: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("reminder:toggle", id),
  saveRule: (input: AppRuleInput): Promise<AppSnapshot> => ipcRenderer.invoke("rule:save", input),
  removeRule: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("rule:remove", id),
  toggleRule: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("rule:toggle", id),
  updateSettings: (patch: Partial<CompanionSettings>): Promise<AppSnapshot> =>
    ipcRenderer.invoke("settings:update", patch),
  updateIdlePhrases: (phrases: string[]): Promise<AppSnapshot> => ipcRenderer.invoke("idle-phrases:update", phrases),
  testNotification: (): Promise<void> => ipcRenderer.invoke("notification:test"),
  clearActivity: (): Promise<AppSnapshot> => ipcRenderer.invoke("activity:clear"),
  listCodexThreads: (force = false): Promise<CodexThreadListResult> => ipcRenderer.invoke("codex:threads:list", force),
  openCodexThread: (threadId: string): Promise<CodexOpenResult> => ipcRenderer.invoke("codex:thread:open", threadId),
  replyCodexThread: (threadId: string, message: string): Promise<CodexReplyResult> =>
    ipcRenderer.invoke("codex:thread:reply", threadId, message),
  setOverlayTaskPanel: (open: boolean): void => ipcRenderer.send("overlay:task-panel", open),
  showCenter: (): void => ipcRenderer.send("center:show"),
  toggleOverlay: (): void => ipcRenderer.send("overlay:toggle"),
  moveOverlayBy: (deltaX: number, deltaY: number): void => ipcRenderer.send("overlay:move-by", deltaX, deltaY),
  showOverlayMenu: (): void => ipcRenderer.send("overlay:context-menu"),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on("snapshot:changed", listener);
    return () => ipcRenderer.removeListener("snapshot:changed", listener);
  },
  onCursor: (callback: (payload: CursorPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CursorPayload) => callback(payload);
    ipcRenderer.on("cursor:changed", listener);
    return () => ipcRenderer.removeListener("cursor:changed", listener);
  },
  onSound: (callback: (sound: SoundName) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sound: SoundName) => callback(sound);
    ipcRenderer.on("sound:play", listener);
    return () => ipcRenderer.removeListener("sound:play", listener);
  },
});
