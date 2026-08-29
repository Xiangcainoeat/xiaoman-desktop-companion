#!/usr/bin/env python3
"""Assemble 32 anchors and 64 generated in-betweens into a 96-frame atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

import build_look_atlas_96 as atlas_builder
from resample_look_directions import normalize_transition_frame


ANCHOR_COUNT = 32
SEGMENTS_PER_BATCH = 4
GENERATED_COLUMNS = 4
GENERATED_ROWS = 2
GENERATED_ASPECT_RATIO = 2048 / 1152
SEAM_REPAIR_COLUMNS = 2
SEAM_REPAIR_ROWS = 2
SEAM_REPAIR_TARGETS = {
    46: 0,  # anchor 15 -> 16, first lower-hemisphere in-between
    47: 1,  # anchor 15 -> 16, second lower-hemisphere in-between
    70: 2,  # anchor 23 -> 24, first lower-hemisphere in-between
    71: 3,  # anchor 23 -> 24, second lower-hemisphere in-between
}


def seam_repair_mapping() -> dict[int, int]:
    """Return the explicit lower-hemisphere seam overrides."""
    return dict(SEAM_REPAIR_TARGETS)


def source_mapping() -> list[dict[str, int | str]]:
    mappings: list[dict[str, int | str]] = []
    for frame_index in range(atlas_builder.FRAME_COUNT):
        anchor = frame_index // 3
        subframe = frame_index % 3
        if subframe == 0:
            mappings.append({"kind": "anchor", "anchor": anchor})
            continue
        batch = anchor // SEGMENTS_PER_BATCH
        local_segment = anchor % SEGMENTS_PER_BATCH
        mappings.append({
            "kind": "generated",
            "batch": batch,
            "cell": local_segment * 2 + subframe - 1,
        })
    return mappings


def _open_rgba(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"input image does not exist: {path}")
    with Image.open(path) as opened:
        return opened.convert("RGBA")


def _generated_cells(path: Path) -> list[Image.Image]:
    sheet = _open_rgba(path)
    if abs(sheet.width / sheet.height - GENERATED_ASPECT_RATIO) > 0.01:
        raise ValueError(
            f"generated sheet {path} has aspect ratio {sheet.width / sheet.height:.5f}, "
            f"expected {GENERATED_ASPECT_RATIO:.5f}"
        )
    return [
        sheet.crop((
            round(sheet.width * (index % GENERATED_COLUMNS) / GENERATED_COLUMNS),
            round(sheet.height * (index // GENERATED_COLUMNS) / GENERATED_ROWS),
            round(sheet.width * (index % GENERATED_COLUMNS + 1) / GENERATED_COLUMNS),
            round(sheet.height * (index // GENERATED_COLUMNS + 1) / GENERATED_ROWS),
        ))
        for index in range(GENERATED_COLUMNS * GENERATED_ROWS)
    ]


def _seam_repair_cells(path: Path) -> list[Image.Image]:
    sheet = _open_rgba(path)
    if abs(sheet.width / sheet.height - GENERATED_ASPECT_RATIO) > 0.01:
        raise ValueError(
            f"seam repair sheet {path} has aspect ratio {sheet.width / sheet.height:.5f}, "
            f"expected {GENERATED_ASPECT_RATIO:.5f}"
        )
    return [
        sheet.crop((
            round(sheet.width * (index % SEAM_REPAIR_COLUMNS) / SEAM_REPAIR_COLUMNS),
            round(sheet.height * (index // SEAM_REPAIR_COLUMNS) / SEAM_REPAIR_ROWS),
            round(sheet.width * (index % SEAM_REPAIR_COLUMNS + 1) / SEAM_REPAIR_COLUMNS),
            round(sheet.height * (index // SEAM_REPAIR_COLUMNS + 1) / SEAM_REPAIR_ROWS),
        ))
        for index in range(SEAM_REPAIR_COLUMNS * SEAM_REPAIR_ROWS)
    ]


def load_ordered_frames(
    anchors_dir: Path,
    generated_dir: Path,
    registration: dict[str, object],
    seam_repairs_path: Path | None = None,
) -> tuple[list[Image.Image], list[dict[str, object]]]:
    anchors = [
        _open_rgba(anchors_dir / f"anchor-{index:02d}.png")
        for index in range(ANCHOR_COUNT)
    ]
    generated_batches = [
        _generated_cells(generated_dir / f"inbetweens-{index:02d}.png")
        for index in range(ANCHOR_COUNT // SEGMENTS_PER_BATCH)
    ]
    target_size = registration.get("targetSubjectSize", [174, 190])
    if (
        not isinstance(target_size, list)
        or len(target_size) != 2
        or not all(isinstance(value, (int, float)) and value > 0 for value in target_size)
    ):
        raise ValueError("generation registration targetSubjectSize is invalid")

    frames: list[Image.Image] = []
    provenance: list[dict[str, object]] = []
    for frame_index, mapping in enumerate(source_mapping()):
        if mapping["kind"] == "anchor":
            anchor_index = int(mapping["anchor"])
            frame = anchors[anchor_index]
            source = str(anchors_dir / f"anchor-{anchor_index:02d}.png")
        else:
            batch_index = int(mapping["batch"])
            cell_index = int(mapping["cell"])
            source_frame = generated_batches[batch_index][cell_index]
            frame = normalize_transition_frame(
                source_frame,
                registration,
                frame_index,
                target_subject_size=[int(target_size[0]), int(target_size[1])],
            )
            source = f"{generated_dir / f'inbetweens-{batch_index:02d}.png'}#cell-{cell_index}"
        frames.append(frame)
        provenance.append({
            "frameIndex": frame_index,
            "degrees": frame_index * atlas_builder.STEP_DEGREES,
            "kind": mapping["kind"],
            "source": source,
            **{key: value for key, value in mapping.items() if key != "kind"},
        })

    if seam_repairs_path is not None:
        seam_cells = _seam_repair_cells(seam_repairs_path)
        target_size = [int(target_size[0]), int(target_size[1])]
        for frame_index, cell_index in SEAM_REPAIR_TARGETS.items():
            frames[frame_index] = normalize_transition_frame(
                seam_cells[cell_index],
                registration,
                frame_index,
                target_subject_size=target_size,
            )
            provenance[frame_index] = {
                "frameIndex": frame_index,
                "degrees": frame_index * atlas_builder.STEP_DEGREES,
                "kind": "generated-seam-repair",
                "source": f"{seam_repairs_path}#cell-{cell_index}",
                "cell": cell_index,
            }
    return frames, provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generation-manifest", type=Path, required=True)
    parser.add_argument("--anchors-dir", type=Path, required=True)
    parser.add_argument("--generated-dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument(
        "--seam-repairs",
        type=Path,
        help="optional 2x2 sheet replacing the four known lower-hemisphere seam frames",
    )
    parser.add_argument("--frames-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    args = parser.parse_args()

    try:
        manifest = json.loads(args.generation_manifest.read_text(encoding="utf-8"))
        registration = manifest["registration"]
        if not isinstance(registration, dict):
            raise ValueError("generation manifest registration must be an object")
        frames, frame_provenance = load_ordered_frames(
            args.anchors_dir,
            args.generated_dir,
            registration,
            args.seam_repairs,
        )
        reference = _open_rgba(args.reference)
        atlas, metadata = atlas_builder.build_atlas(frames, reference)
        metadata["source"]["generationManifest"] = str(args.generation_manifest)
        metadata["source"]["anchorCount"] = ANCHOR_COUNT
        metadata["source"]["generatedCount"] = atlas_builder.FRAME_COUNT - ANCHOR_COUNT
        if args.seam_repairs is not None:
            metadata["source"]["seamRepairs"] = str(args.seam_repairs)
            metadata["source"]["seamRepairCount"] = len(SEAM_REPAIR_TARGETS)
        metadata["provenance"] = str(args.provenance)

        args.frames_dir.mkdir(parents=True, exist_ok=True)
        for index, frame in enumerate(frames):
            frame.save(args.frames_dir / f"frame-{index:03d}.png", "PNG", optimize=True)
        atlas_builder.write_outputs(atlas, metadata, args.output, args.metadata)
        args.provenance.parent.mkdir(parents=True, exist_ok=True)
        args.provenance.write_text(
            json.dumps({
                "algorithm": "32-anchors-plus-64-generated-inbetweens",
                "compositing": "none",
                "seamRepairs": seam_repair_mapping() if args.seam_repairs is not None else {},
                "frameCount": len(frame_provenance),
                "frames": frame_provenance,
            }, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (FileNotFoundError, KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"look-96 assembly failed: {error}") from error

    print(json.dumps({
        "ok": metadata["ok"],
        "frameCount": metadata["frameCount"],
        "dimensions": metadata["dimensions"],
        "alphaSummary": metadata["alphaSummary"],
        "colorSummary": {
            "maxLightFurDistance": metadata["colorSummary"]["maxLightFurDistance"],
            "missingLightFurFrames": metadata["colorSummary"]["missingLightFurFrames"],
        },
    }, ensure_ascii=True))
    if not metadata["ok"]:
        raise SystemExit("look-96 assembly validation failed")


if __name__ == "__main__":
    main()
