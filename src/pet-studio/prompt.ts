export const PET_STUDIO_GITHUB_REPO = "Xiangcainoeat/xiaoman-desktop-companion";
export const PET_STUDIO_GITHUB_PATH = "skills/xiaoman-pet-studio";

/** The supported Codex helper; keep this command free of machine-specific paths. */
export const PET_STUDIO_INSTALL_COMMAND = `python3 "\${CODEX_HOME:-\$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo ${PET_STUDIO_GITHUB_REPO} --path ${PET_STUDIO_GITHUB_PATH} --method auto`;

export interface PetStudioReferenceImage {
  readonly key: string;
  readonly title: string;
  readonly details: string;
}

export const PET_STUDIO_REFERENCE_IMAGES = [
  { key: "front", title: "正脸站立", details: "眼睛、鼻口、耳朵和整体比例清晰" },
  { key: "left", title: "左侧面站立", details: "头身连接、背线和尾巴根部清晰" },
  { key: "right", title: "右侧面站立", details: "与左侧面互相校验，不强行镜像花纹" },
  { key: "back", title: "背面站立", details: "背部花色、尾巴形状和后腿轮廓清晰" },
  { key: "top", title: "俯视或高机位", details: "头顶、耳朵内侧和背部体积清晰" },
  { key: "bottom", title: "仰视或低机位", details: "下巴、胸口和腹部边界清晰" },
  { key: "run", title: "行走或奔跑", details: "腿部节奏、步幅和尾巴摆动自然" },
  { key: "rest", title: "坐姿或卧姿", details: "自然待机比例与爪子形状清晰" },
  { key: "expression", title: "互动表情", details: "眨眼、伸舌、抬爪等个性细节清晰" },
  { key: "material", title: "近距离毛发或材质", details: "毛色、渐变、纹理和眼睛颜色清晰" },
] as const satisfies readonly PetStudioReferenceImage[];

export interface PetStudioPromptOptions {
  petName?: string;
  outputDirectory?: string;
}

function referenceChecklist(): string {
  return PET_STUDIO_REFERENCE_IMAGES
    .map((reference, index) => `${index + 1}. ${reference.title}：${reference.details}`)
    .join("\n");
}

/**
 * Keep the starter turn deterministic so the app and documentation always
 * describe the same input contract.
 */
export function buildPetStudioPrompt(options: PetStudioPromptOptions = {}): string {
  const petName = options.petName?.trim() || "我的宠物";
  const outputDirectory = options.outputDirectory?.trim() || "~/Documents/XiaomanPets";
  return [
    "$xiaoman-pet-studio",
    `请把我的宠物“${petName}”制作成可以导入小满桌面伴侣的 Codex 宠物素材包。`,
    "先检查并使用 xiaoman-pet-studio Skill；如果本机还没有，请执行下面的官方获取/安装命令，再重新调用 Skill：",
    PET_STUDIO_INSTALL_COMMAND,
    "",
    "请先检查环境：确认当前会话支持 $imagegen 或 $relay-imagegen，并调用 load_workspace_dependencies 检查可用的 Python/Pillow。缺少任何图像生成或确定性处理能力时，先列出缺项并停止，不要用占位图、纯 CSS 图或未验证图片冒充结果。",
    "",
    "我会在这个 Codex 任务中上传十张参考图。请逐张核对并标记覆盖情况；图片尽量使用原图，避免滤镜和强色偏，不要裁掉耳朵、尾巴或爪子。需要补图时先说明缺哪一类：",
    referenceChecklist(),
    "",
    `生成完成后将结果写入 ${outputDirectory} 下的独立目录，不要修改小满桌面伴侣源码。必须生成并验证 spriteVersionNumber: 2、9 个标准动作行、16 个注视方向、透明背景边缘清理、联系表和 QA 报告，并打包为可导入的 .xmpet 文件。`,
    "输出中请给出：素材包绝对路径、asset-manifest、QA 报告和小满应用中的导入步骤。不要把 API key 写入提示词、源码、日志或素材包。",
  ].join("\n");
}
