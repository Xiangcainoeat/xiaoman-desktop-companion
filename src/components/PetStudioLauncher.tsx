import { ChevronDown, Images, MessageCircle, PackageOpen, Sparkles } from "lucide-react";
import { useState } from "react";
import { PET_STUDIO_INSTALL_COMMAND, PET_STUDIO_REFERENCE_IMAGES } from "../pet-studio/prompt";
import type { PetStudioStartResult } from "../shared/types";
import { bridge } from "../useCompanion";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PetStudioLauncher() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<PetStudioStartResult | null>(null);

  const startPetStudio = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const next = await bridge.startPetStudio();
      setResult(next);
      setFeedback(next.message);
    } catch (error) {
      setResult(null);
      setFeedback(`启动失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pet-studio-launcher section-block" aria-labelledby="pet-studio-title">
      <div className="pet-studio-launcher-head">
        <div className="pet-studio-launcher-copy">
          <span className="eyebrow">宠物替换</span>
          <h2 id="pet-studio-title">一键生成自己的宠物</h2>
          <p className="section-description">
            打开原生 Codex 新对话并预填 Skill 获取命令和十张素材清单；请在 Codex 中点击发送，完成后导入生成的 .xmpet 包。
          </p>
        </div>
        <button className="primary-button pet-studio-start" type="button" disabled={busy} onClick={() => void startPetStudio()}>
          <MessageCircle size={16} />
          {busy ? "正在打开 Codex" : "在 Codex 中开始"}
        </button>
      </div>

      <div className="pet-studio-launcher-meta">
        <span><Sparkles size={15} />Codex 负责生图与素材处理</span>
        <span><PackageOpen size={15} />输出可导入的 .xmpet</span>
      </div>

      <details className="pet-studio-disclosure">
        <summary>
          <span><Images size={16} />十张素材建议</span>
          <ChevronDown className="pet-studio-disclosure-chevron" size={16} />
        </summary>
        <ol className="pet-studio-reference-list">
          {PET_STUDIO_REFERENCE_IMAGES.map((reference) => (
            <li key={reference.key}>
              <strong>{reference.title}</strong>
              <span>{reference.details}</span>
            </li>
          ))}
        </ol>
      </details>

      <details className="pet-studio-disclosure pet-studio-command-disclosure">
        <summary>
          <span><PackageOpen size={16} />查看 Skill 获取命令</span>
          <ChevronDown className="pet-studio-disclosure-chevron" size={16} />
        </summary>
        <code>{result?.installCommand ?? PET_STUDIO_INSTALL_COMMAND}</code>
      </details>

      {feedback && <p className={`pet-studio-feedback ${result?.ok ? "" : "is-error"}`} role="status" aria-live="polite">{feedback}</p>}
    </section>
  );
}
