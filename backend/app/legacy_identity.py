"""Resolve legacy Material rows to physical Sample identities.

Shared by the read-only audit (scripts/legacy_identity_audit.py) and the Alembic
migration that folds Material into Sample, so both apply the same rules:

    matched      the Material is the inventory record of an existing Sample
    new_sample   the Material is a real derivative with no Sample yet; it becomes
                 a derived Sample that keeps the Material code
    ambiguous    the rules cannot decide; nothing is guessed

Pure functions over plain dicts; no database access.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

MATCHED = "matched"
NEW_SAMPLE = "new_sample"
AMBIGUOUS = "ambiguous"
CANDIDATE = "candidate"
PENDING = "pending"

SAMPLE_CODE_MAX_LENGTH = 100


@dataclass
class Resolution:
    kind: str
    reason: str = ""
    sample_id: int | None = None
    parent_ref: tuple | None = None
    new_sample_code: str | None = None
    source: str = "rule"
    warnings: list[str] = field(default_factory=list)


@dataclass
class Override:
    material_id: int
    resolution: str
    sample_id: int | None = None
    parent_ref: tuple | None = None
    new_sample_code: str | None = None


def classify_materials(samples: list[dict], materials: list[dict], overrides: dict[int, Override] | None = None) -> dict[int, Resolution]:
    """Resolve every Material to a Sample identity.

    Parent identities depend on how the parent Material resolved, so the rules
    are applied repeatedly until nothing changes.
    """
    overrides = overrides or {}
    samples_by_id = {row["sample_id"]: row for row in samples}
    materials_by_id = {row["material_id"]: row for row in materials}
    cyclic_materials = find_cycles(materials_by_id, "material_id", "parent_material_id")

    resolutions: dict[int, Resolution] = {}
    for _ in range(len(materials) + 2):
        next_resolutions = {
            material["material_id"]: _classify_one(material, resolutions, samples_by_id, materials_by_id, cyclic_materials, overrides)
            for material in materials
        }
        _settle_candidates(next_resolutions, materials_by_id, samples_by_id)
        _check_new_sample_rules(next_resolutions, samples, materials_by_id)
        if next_resolutions == resolutions:
            break
        resolutions = next_resolutions

    for material_id, resolution in resolutions.items():
        if resolution.kind == PENDING:
            resolutions[material_id] = Resolution(AMBIGUOUS, "could not resolve parent material")
    _check_new_sample_parent_cycles(resolutions, materials_by_id)
    _add_warnings(resolutions, samples_by_id, materials_by_id)
    return resolutions


def _classify_one(material, resolutions, samples_by_id, materials_by_id, cyclic_materials, overrides) -> Resolution:
    material_id = material["material_id"]
    override = overrides.get(material_id)
    if override:
        return _apply_override(override, resolutions)
    if material_id in cyclic_materials:
        return Resolution(AMBIGUOUS, "material parent links form a cycle")
    sample = samples_by_id.get(material["sample_id"])
    if sample is None:
        return Resolution(AMBIGUOUS, f"owning sample {material['sample_id']} does not exist")

    parent_id = material["parent_material_id"]
    if parent_id is None:
        return Resolution(CANDIDATE, "root material of its sample")
    parent = materials_by_id.get(parent_id)
    if parent is None:
        return Resolution(AMBIGUOUS, f"parent material {parent_id} does not exist")

    parent_resolution = resolutions.get(parent_id)
    if parent_resolution is None or parent_resolution.kind in (PENDING, CANDIDATE):
        return Resolution(PENDING)
    if parent_resolution.kind == AMBIGUOUS:
        return Resolution(AMBIGUOUS, f"blocked: parent material {parent['material_code']} is unresolved")

    parent_identity = identity_of(parent_id, parent_resolution)
    if parent["sample_id"] == material["sample_id"]:
        return Resolution(
            NEW_SAMPLE,
            "derived from a material of the same sample (aliquot/offspring/process output)",
            parent_ref=parent_identity,
            new_sample_code=material["material_code"],
        )
    if parent_identity == ("sample", sample["parent_sample_id"]):
        return Resolution(CANDIDATE, "material lineage matches sample lineage")
    return Resolution(
        AMBIGUOUS,
        f"parent material {parent['material_code']} resolves to {describe_identity(parent_identity, samples_by_id, materials_by_id)}, "
        f"but sample {sample['sample_code']} has parent {describe_identity(('sample', sample['parent_sample_id']), samples_by_id, materials_by_id)}",
    )


def _apply_override(override: Override, resolutions) -> Resolution:
    if override.resolution == MATCHED:
        return Resolution(MATCHED, "override: matched to existing sample", sample_id=override.sample_id, source="override")
    parent_ref = override.parent_ref
    if parent_ref and parent_ref[0] == "material":
        parent_resolution = resolutions.get(parent_ref[1])
        if parent_resolution is None or parent_resolution.kind in (PENDING, CANDIDATE):
            return Resolution(PENDING, source="override")
        if parent_resolution.kind == AMBIGUOUS:
            return Resolution(AMBIGUOUS, "override parent material is unresolved", source="override")
        parent_ref = identity_of(parent_ref[1], parent_resolution)
    return Resolution(
        NEW_SAMPLE, "override: new derived sample", parent_ref=parent_ref,
        new_sample_code=override.new_sample_code, source="override",
    )


def _settle_candidates(resolutions, materials_by_id, samples_by_id) -> None:
    """A Sample may be claimed by exactly one Material; otherwise all claimants are ambiguous."""
    claims: dict[int, list[int]] = defaultdict(list)
    for material_id, resolution in resolutions.items():
        if resolution.kind == CANDIDATE:
            claims[materials_by_id[material_id]["sample_id"]].append(material_id)
        elif resolution.kind == MATCHED:
            claims[resolution.sample_id].append(material_id)

    for sample_id, material_ids in claims.items():
        overridden = [mid for mid in material_ids if resolutions[mid].source == "override"]
        if len(material_ids) == 1:
            only = resolutions[material_ids[0]]
            if only.kind == CANDIDATE:
                only.kind, only.sample_id = MATCHED, sample_id
            continue
        if len(overridden) == 1:
            for material_id in material_ids:
                if material_id not in overridden:
                    resolutions[material_id] = Resolution(AMBIGUOUS, f"sample {samples_by_id[sample_id]['sample_code']} is claimed by an override for another material")
            continue
        codes = ", ".join(sorted(materials_by_id[mid]["material_code"] for mid in material_ids))
        for material_id in material_ids:
            resolutions[material_id] = Resolution(AMBIGUOUS, f"several materials look like sample {samples_by_id[sample_id]['sample_code']}: {codes}")


def _check_new_sample_rules(resolutions, samples, materials_by_id) -> None:
    """Rule-derived new Samples must not plausibly be an existing Sample and must have a usable code."""
    matched_samples = {r.sample_id for r in resolutions.values() if r.kind == MATCHED}
    children_by_parent: dict[int, list[dict]] = defaultdict(list)
    for sample in samples:
        if sample["parent_sample_id"] is not None:
            children_by_parent[sample["parent_sample_id"]].append(sample)
    existing_codes = {sample["sample_code"] for sample in samples}
    new_codes = Counter(r.new_sample_code for r in resolutions.values() if r.kind == NEW_SAMPLE)

    for material_id, resolution in resolutions.items():
        if resolution.kind != NEW_SAMPLE:
            continue
        code = resolution.new_sample_code
        if resolution.source == "rule" and resolution.parent_ref and resolution.parent_ref[0] == "sample":
            unlinked_children = [
                child["sample_code"] for child in children_by_parent[resolution.parent_ref[1]]
                if child["sample_id"] not in matched_samples
            ]
            if unlinked_children:
                resolutions[material_id] = Resolution(
                    AMBIGUOUS,
                    "may be an existing child sample with no material: " + ", ".join(sorted(unlinked_children)),
                )
                continue
        if not code:
            resolutions[material_id] = Resolution(AMBIGUOUS, "new sample has no code")
        elif code in existing_codes:
            resolutions[material_id] = Resolution(AMBIGUOUS, f"new sample code {code} already exists as a sample code")
        elif new_codes[code] > 1:
            resolutions[material_id] = Resolution(AMBIGUOUS, f"new sample code {code} is used more than once")
        elif len(code) > SAMPLE_CODE_MAX_LENGTH:
            resolutions[material_id] = Resolution(AMBIGUOUS, f"new sample code is longer than {SAMPLE_CODE_MAX_LENGTH} characters")


def _check_new_sample_parent_cycles(resolutions, materials_by_id) -> None:
    for material_id, resolution in list(resolutions.items()):
        seen = set()
        current = ("material", material_id)
        while current and current[0] == "material":
            if current[1] in seen:
                resolutions[material_id] = Resolution(AMBIGUOUS, "new sample parent links form a cycle")
                break
            seen.add(current[1])
            current_resolution = resolutions.get(current[1])
            current = current_resolution.parent_ref if current_resolution and current_resolution.kind == NEW_SAMPLE else None


def _add_warnings(resolutions, samples_by_id, materials_by_id) -> None:
    for material_id, resolution in resolutions.items():
        material = materials_by_id[material_id]
        if resolution.kind == MATCHED and material["parent_material_id"] is None:
            sample = samples_by_id.get(resolution.sample_id)
            if sample and sample["parent_sample_id"] is not None:
                resolution.warnings.append("lineage_gap: sample has a parent but its material has no parent material")


def identity_of(material_id: int, resolution: Resolution) -> tuple | None:
    if resolution.kind == MATCHED:
        return ("sample", resolution.sample_id)
    if resolution.kind == NEW_SAMPLE:
        return ("material", material_id)
    return None


def describe_identity(identity, samples_by_id, materials_by_id) -> str:
    if identity is None or identity[1] is None:
        return "no parent"
    if identity[0] == "sample":
        sample = samples_by_id.get(identity[1])
        return f"sample {sample['sample_code']}" if sample else f"missing sample {identity[1]}"
    return f"new sample {materials_by_id[identity[1]]['material_code']}"


def find_cycles(rows_by_id: dict, id_key: str, parent_key: str) -> set:
    in_cycle: set = set()
    for start in rows_by_id:
        path, current = [], start
        while current is not None and current in rows_by_id and current not in path:
            path.append(current)
            current = rows_by_id[current][parent_key]
        if current is not None and current in path:
            in_cycle.update(path[path.index(current):])
    return in_cycle
