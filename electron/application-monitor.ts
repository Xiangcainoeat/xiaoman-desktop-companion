import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FRONTMOST_APP_SCRIPT = 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.localizedName.js';

export class FrontmostApplicationMonitor {
  private timer: NodeJS.Timeout | null = null;
  private previousApplication: string | null = null;
  private running = false;

  constructor(
    private readonly onApplication: (name: string) => void,
    private readonly onAvailability: (available: boolean) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), 2200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { stdout } = await execFileAsync("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-e",
        FRONTMOST_APP_SCRIPT,
      ], { timeout: 1800 });
      const application = stdout.trim();
      this.onAvailability(true);
      if (application && application !== this.previousApplication) {
        this.previousApplication = application;
        this.onApplication(application);
      }
    } catch {
      this.onAvailability(false);
    } finally {
      this.running = false;
    }
  }
}
