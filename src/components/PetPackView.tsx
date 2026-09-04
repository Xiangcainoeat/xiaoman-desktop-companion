import {
  Check,
  Download,
  FileImage,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PET_ASSET_IDS, findPetPackAsset } from "../pet-pack/runtime";
import type { AppSnapshot, PetPackOperationResult, PetPackSummary } from "../shared/types";
import { bridge } from "../useCompanion";

const ASSET_LABELS: Record<string, string> = {
  "codex-pet": "Codex 元数据",
  "codex-spritesheet": "Codex 动作图集",
  "native-look-atlas": "原生注视图集",
  "native-look-metadata": "原生注视元数据",
  "enhanced-pet": "增强元数据",
  "enhanced-spritesheet": "增强动作图集",
  "enhanced-look-atlas": "增强注视图集",
  "enhanced-look-metadata": "增强注视元数据",
  "idle-actions": "待机动作图集",
  "idle-actions-metadata": "待机动作元数据",
  "sleeping-actions": "睡觉动作图集",
  "sleeping-actions-metadata": "睡觉动作元数据",
  "care-actions": "照料动作图集",
  "care-actions-metadata": "照料动作元数据",
  avatar: "头像",
  tray: "菜单栏图标",
};

function dimensions(asset: ReturnType<typeof findPetPackAsset>): string {
  if (!asset) return "未提供";
  const size = asset.width && asset.height ? `${asset.width} x ${asset.height}` : "尺寸未声明";
  const grid = asset.columns && asset.rows ? ` · ${asset.columns} x ${asset.rows} 格` : "";
  const frames = asset.frameCount ? ` · ${asset.frameCount} 帧` : "";
  return `${size}${grid}${frames}`;
}

function summaryForRuntime(summary: PetPackSummary | undefined, currentId: string): string {
  if (!summary) return currentId;
  return `${summary.name} · v${summary.version}`;
}

function resultMessage(result: PetPackOperationResult): string {
  return result.ok ? result.message : `未完成：${result.message}`;
}

export function PetPackView({ snapshot }: { snapshot: AppSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const activeSummary = snapshot.petPacks?.find((pack) => pack.active);
  const runtimeAssets = snapshot.petPackRuntime?.assets ?? [];
  const assetRows = useMemo(() => PET_ASSET_IDS.map((id) => ({
    id,
    asset: findPetPackAsset(snapshot.petPackRuntime, id),
  })), [snapshot.petPackRuntime]);

  const run = async (operation: () => Promise<PetPackOperationResult | AppSnapshot>): Promise<void> => {
    setBusy(true);
    setFeedback("");
    try {
      const result = await operation();
      if ("ok" in result) setFeedback(resultMessage(result));
      else setFeedback("操作已完成");
    } catch (error) {
      setFeedback(`未完成：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const importPack = () => run(() => bridge.importPetPack());
  const activate = (id: string | null) => run(() => bridge.activatePetPack(id));
  const remove = (id: string) => run(() => bridge.removePetPack(id));
  const exportCodex = (id: string) => run(() => bridge.exportPetPackToCodex(id));

  return (
    <section className="pet-pack-section section-block" aria-labelledby="pet-pack-title">
      <div className="section-heading pet-pack-heading">
        <div>
          <span className="eyebrow">素材包</span>
          <h2 id="pet-pack-title">导入与替换小满</h2>
          <p className="section-description">使用一份经过校验的 .xmpet 文件替换外观；内置小满始终可以回退。</p>
        </div>
        <div className="pet-pack-heading-actions">
          <span className="pet-pack-active-label"><Check size={15} />{summaryForRuntime(activeSummary, snapshot.petPackRuntime?.id ?? "内置小满")}</span>
          <button className="secondary-button" type="button" disabled={busy} onClick={importPack} title="从本机导入 .xmpet 文件">
            <Upload size={16} />导入素材包
          </button>
        </div>
      </div>

      <div className="pet-pack-manager">
        <div className="pet-pack-installed" aria-label="已安装素材包">
          <div className="pet-pack-subheading"><PackageOpen size={17} /><strong>已安装</strong><span>{snapshot.petPacks?.length ?? 0} 个</span></div>
          {(snapshot.petPacks ?? []).map((pack) => (
            <div className={`pet-pack-installed-row ${pack.active ? "is-active" : ""}`} key={pack.id}>
              <div className="pet-pack-pack-icon"><FileImage size={17} /></div>
              <div className="pet-pack-pack-copy">
                <strong>{pack.name}</strong>
                <small>{pack.bundled ? "应用内置 · 不可变" : `${pack.id} · v${pack.version}`} · {pack.assetCount} 项素材</small>
              </div>
              <div className="pet-pack-pack-actions">
                {pack.active ? <span className="pet-pack-current"><Check size={14} />使用中</span> : (
                  <button className="text-button" type="button" disabled={busy} onClick={() => activate(pack.bundled ? null : pack.id)}>切换</button>
                )}
                {!pack.bundled && pack.hasCodex && (
                  <button className="icon-button" type="button" disabled={busy} title="导出 Codex 兼容文件" aria-label={`导出 ${pack.name} 到 Codex`} onClick={() => exportCodex(pack.id)}>
                    <Download size={16} />
                  </button>
                )}
                {!pack.bundled && (
                  <button className="icon-button danger-icon-button" type="button" disabled={busy || pack.active} title="删除素材包" aria-label={`删除 ${pack.name}`} onClick={() => remove(pack.id)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="pet-pack-manifest" aria-label="当前素材清单">
          <div className="pet-pack-subheading"><RefreshCw size={17} /><strong>当前素材清单</strong><span>{runtimeAssets.length} / {PET_ASSET_IDS.length} 项已提供</span></div>
          <div className="pet-pack-asset-table">
            {assetRows.map(({ id, asset }) => (
              <div className={`pet-pack-asset-row ${asset ? "is-present" : "is-fallback"}`} key={id}>
                <span className="pet-pack-asset-status" aria-hidden="true">{asset ? <Check size={13} /> : <RotateCcw size={13} />}</span>
                <div className="pet-pack-asset-copy">
                  <strong>{ASSET_LABELS[id] ?? id}</strong>
                  <small><code>{asset?.path ?? "内置回退"}</code> · {dimensions(asset)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {feedback && <p className={`pet-pack-feedback ${feedback.startsWith("未完成") ? "is-error" : ""}`} role="status">{feedback}</p>}
    </section>
  );
}
