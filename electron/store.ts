import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizePersistedData } from "../src/shared/domain";
import type { PersistedData } from "../src/shared/types";

export class CompanionStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    mkdirSync(userDataPath, { recursive: true });
    this.filePath = path.join(userDataPath, "xiaoman-data.json");
  }

  load(): PersistedData {
    if (!existsSync(this.filePath)) return normalizePersistedData(null);
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return normalizePersistedData(parsed);
    } catch {
      const backupPath = `${this.filePath}.invalid-${Date.now()}.bak`;
      try {
        renameSync(this.filePath, backupPath);
      } catch {
        // A read-only or concurrently moved file still falls back safely in memory.
      }
      return normalizePersistedData(null);
    }
  }

  save(data: PersistedData): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
