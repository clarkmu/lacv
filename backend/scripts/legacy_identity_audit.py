"""Read-only audit of legacy Sample/Material identity.

Before Material is folded into Sample, every legacy Material must resolve to
exactly one physical Sample identity:

    matched      the Material is the inventory record of an existing Sample
    new_sample   the Material is a real derivative with no Sample yet; it will
                 become a derived Sample that keeps the Material code
    ambiguous    the rules cannot decide; a human must add an override

The audit never writes to the database. The connection is opened with
default_transaction_read_only=on and the script checks that it took effect.

Usage:
    DATABASE_URL=postgresql+psycopg://... \
        python legacy_identity_audit.py --out DIR [--overrides FILE]

Exit codes: 0 = every Material resolved, 1 = ambiguous Materials remain,
2 = the overrides file has errors.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

MATCHED = "matched"
NEW_SAMPLE = "new_sample"
AMBIGUOUS = "ambiguous"
CANDIDATE = "candidate"
PENDING = "pending"

SAMPLE_CODE_MAX_LENGTH = 100

# Tables that point at materials.material_id and must be retargeted later.
MATERIAL_REFERENCES = [
    ("process_event_inputs", "material_id"),
    ("process_event_outputs", "material_id"),
    ("material_quantity_events", "material_id"),
    ("assays", "material_id"),
    ("storage_events", "material_id"),
    ("data_files", "material_id"),
]

SAMPLE_COLUMNS = [
    "sample_id", "sample_code", "parent_sample_id", "batch_id", "external_sample_id",
    "sample_type", "source_type", "source_description", "status", "notes",
]
MATERIAL_COLUMNS = [
    "material_id", "material_code", "sample_id", "parent_material_id", "material_type_id",
    "material_type", "material_subtype", "material_label", "current_quantity", "quantity_unit",
    "concentration", "concentration_unit", "storage_location_id", "status", "is_consumed",
    "is_disposed", "notes",
]

OVERRIDE_COLUMNS = [
    "material_id", "material_code", "owning_sample_code", "parent_material_code", "reason",
    "resolution", "sample_code", "parent_sample_code", "new_sample_code", "reviewer", "review_notes",
]


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


# ---------------------------------------------------------------------------
# Classification (pure functions, no database access)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Overrides file
# ---------------------------------------------------------------------------

def read_overrides(path: Path, samples: list[dict], materials: list[dict]) -> tuple[dict[int, Override], list[str]]:
    """Read the human-edited overrides CSV. Rows with a blank resolution are ignored."""
    sample_ids_by_code = {row["sample_code"]: row["sample_id"] for row in samples}
    material_ids_by_code = {row["material_code"]: row["material_id"] for row in materials}
    overrides: dict[int, Override] = {}
    errors: list[str] = []

    with path.open(newline="", encoding="utf-8-sig") as handle:
        for line_number, row in enumerate(csv.DictReader(handle), start=2):
            resolution = (row.get("resolution") or "").strip()
            if not resolution:
                continue
            where = f"{path.name} line {line_number}"
            material_code = (row.get("material_code") or "").strip()
            material_id = material_ids_by_code.get(material_code)
            if material_id is None:
                errors.append(f"{where}: unknown material_code {material_code!r}")
                continue
            if material_id in overrides:
                errors.append(f"{where}: duplicate override for {material_code}")
                continue
            if resolution == MATCHED:
                sample_code = (row.get("sample_code") or "").strip()
                if sample_code not in sample_ids_by_code:
                    errors.append(f"{where}: matched needs an existing sample_code, got {sample_code!r}")
                    continue
                overrides[material_id] = Override(material_id, MATCHED, sample_id=sample_ids_by_code[sample_code])
            elif resolution == NEW_SAMPLE:
                parent_ref, error = _parse_parent_code((row.get("parent_sample_code") or "").strip(), sample_ids_by_code, material_ids_by_code)
                if error:
                    errors.append(f"{where}: {error}")
                    continue
                if parent_ref == ("material", material_id):
                    errors.append(f"{where}: a material cannot be its own parent")
                    continue
                new_code = (row.get("new_sample_code") or "").strip() or material_code
                overrides[material_id] = Override(material_id, NEW_SAMPLE, parent_ref=parent_ref, new_sample_code=new_code)
            else:
                errors.append(f"{where}: resolution must be {MATCHED!r} or {NEW_SAMPLE!r}, got {resolution!r}")
    return overrides, errors


def _parse_parent_code(code: str, sample_ids_by_code: dict, material_ids_by_code: dict) -> tuple[tuple | None, str | None]:
    """Blank means a root sample. A code may name an existing sample or a legacy material.

    Prefix with sample: or material: when a code exists in both namespaces.
    """
    if not code:
        return None, None
    if code.startswith("sample:"):
        code = code.removeprefix("sample:")
        return (("sample", sample_ids_by_code[code]), None) if code in sample_ids_by_code else (None, f"unknown sample code {code!r}")
    if code.startswith("material:"):
        code = code.removeprefix("material:")
        return (("material", material_ids_by_code[code]), None) if code in material_ids_by_code else (None, f"unknown material code {code!r}")
    in_samples, in_materials = code in sample_ids_by_code, code in material_ids_by_code
    if in_samples and in_materials:
        return None, f"parent code {code!r} is both a sample and a material code; prefix it with sample: or material:"
    if in_samples:
        return ("sample", sample_ids_by_code[code]), None
    if in_materials:
        return ("material", material_ids_by_code[code]), None
    return None, f"unknown parent code {code!r}"


# ---------------------------------------------------------------------------
# Database reads
# ---------------------------------------------------------------------------

def connect_read_only(database_url: str):
    from sqlalchemy import create_engine, text

    engine = create_engine(database_url, connect_args={"options": "-c default_transaction_read_only=on"})
    connection = engine.connect()
    if connection.execute(text("SHOW transaction_read_only")).scalar() != "on":
        connection.close()
        raise SystemExit("Refusing to run: the connection is not read-only.")
    return connection


def load_database(connection) -> dict:
    from sqlalchemy import text

    columns_by_table: dict[str, list[dict]] = defaultdict(list)
    for row in connection.execute(text(
        "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
    )).mappings():
        columns_by_table[row["table_name"]].append(dict(row))
    available = {table: {c["column_name"] for c in columns} for table, columns in columns_by_table.items()}
    for required in ("samples", "materials"):
        if required not in available:
            raise SystemExit(f"Table {required!r} not found in schema public.")

    row_counts = {table: connection.execute(text(f'SELECT count(*) FROM "{table}"')).scalar() for table in columns_by_table}
    alembic_version = None
    if "alembic_version" in available:
        alembic_version = connection.execute(text("SELECT string_agg(version_num, ',') FROM alembic_version")).scalar()

    samples = _select_rows(connection, "samples", SAMPLE_COLUMNS, available["samples"], "sample_id")
    materials = _select_rows(connection, "materials", MATERIAL_COLUMNS, available["materials"], "material_id")
    material_type_names = {}
    if "material_types" in available:
        material_type_names = dict(connection.execute(text("SELECT material_type_id, type_name FROM material_types")).all())
    for material in materials:
        material["material_type_name"] = material_type_names.get(material["material_type_id"]) or material["material_type"]

    reference_counts: dict[int, dict[str, int]] = defaultdict(dict)
    for table, column in MATERIAL_REFERENCES:
        if column not in available.get(table, set()):
            continue
        for material_id, count in connection.execute(text(f'SELECT "{column}", count(*) FROM "{table}" WHERE "{column}" IS NOT NULL GROUP BY 1')).all():
            reference_counts[material_id][table] = count

    process_inputs_by_output: dict[int, set[int]] = defaultdict(set)
    if {"process_event_inputs", "process_event_outputs"} <= available.keys():
        for output_id, input_id in connection.execute(text(
            "SELECT o.material_id, i.material_id FROM process_event_outputs o "
            "JOIN process_event_inputs i ON i.process_event_id = o.process_event_id"
        )).all():
            process_inputs_by_output[output_id].add(input_id)

    return {
        "columns_by_table": columns_by_table,
        "row_counts": row_counts,
        "alembic_version": alembic_version,
        "samples": samples,
        "materials": materials,
        "reference_counts": reference_counts,
        "process_inputs_by_output": process_inputs_by_output,
    }


def _select_rows(connection, table: str, wanted: list[str], available: set[str], order_by: str) -> list[dict]:
    from sqlalchemy import text

    present = [column for column in wanted if column in available]
    rows = connection.execute(text(f'SELECT {", ".join(present)} FROM "{table}" ORDER BY {order_by}')).mappings()
    return [{column: row.get(column) for column in wanted} for row in rows]


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

def add_process_warnings(resolutions, materials, process_inputs_by_output) -> None:
    for material in materials:
        inputs = process_inputs_by_output.get(material["material_id"])
        if inputs and material["parent_material_id"] not in inputs:
            resolutions[material["material_id"]].warnings.append("process output whose parent material is not one of the process inputs")


def classification_rows(resolutions, samples_by_id, materials_by_id, reference_counts) -> list[dict]:
    rows = []
    for material_id, material in materials_by_id.items():
        resolution = resolutions[material_id]
        owning_sample = samples_by_id.get(material["sample_id"]) or {}
        parent_material = materials_by_id.get(material["parent_material_id"]) or {}
        target = samples_by_id.get(resolution.sample_id) or {}
        counts = reference_counts.get(material_id, {})
        rows.append({
            "material_id": material_id,
            "material_code": material["material_code"],
            "material_type": material["material_type_name"],
            "owning_sample_code": owning_sample.get("sample_code"),
            "parent_material_code": parent_material.get("material_code"),
            "classification": resolution.kind,
            "source": resolution.source,
            "reason": resolution.reason,
            "resolves_to_sample_code": target.get("sample_code") if resolution.kind == MATCHED else resolution.new_sample_code,
            "new_sample_parent": describe_identity(resolution.parent_ref, samples_by_id, materials_by_id) if resolution.kind == NEW_SAMPLE else "",
            "warnings": "; ".join(resolution.warnings),
            **{f"n_{table}": counts.get(table, 0) for table, _ in MATERIAL_REFERENCES},
        })
    return rows


def override_rows(resolutions, samples_by_id, materials_by_id, previous_overrides_path: Path | None) -> list[dict]:
    """Ambiguous Materials, plus any rows already filled in, ready for human review."""
    previous = {}
    if previous_overrides_path:
        with previous_overrides_path.open(newline="", encoding="utf-8-sig") as handle:
            previous = {row.get("material_code"): row for row in csv.DictReader(handle)}

    rows = []
    for material_id, material in materials_by_id.items():
        resolution = resolutions[material_id]
        if resolution.kind != AMBIGUOUS and material["material_code"] not in previous:
            continue
        prior = previous.get(material["material_code"], {})
        parent_material = materials_by_id.get(material["parent_material_id"]) or {}
        rows.append({
            "material_id": material_id,
            "material_code": material["material_code"],
            "owning_sample_code": (samples_by_id.get(material["sample_id"]) or {}).get("sample_code"),
            "parent_material_code": parent_material.get("material_code"),
            "reason": resolution.reason if resolution.kind == AMBIGUOUS else f"resolved: {resolution.kind}",
            **{column: prior.get(column, "") for column in ("resolution", "sample_code", "parent_sample_code", "new_sample_code", "reviewer", "review_notes")},
        })
    return rows


def field_conflict_rows(resolutions, samples_by_id, materials_by_id) -> list[dict]:
    """Matched pairs whose overlapping fields disagree, with the proposed reconciliation."""
    rows = []
    for material_id, resolution in resolutions.items():
        if resolution.kind != MATCHED:
            continue
        sample, material = samples_by_id[resolution.sample_id], materials_by_id[material_id]
        comparisons = [
            ("status", sample["status"], material["status"], "use material status"),
            ("notes", sample["notes"], material["notes"], "keep both, labelled by source"),
            ("type", sample["sample_type"], material["material_type_name"], "use material type lookup; review sample_type audit"),
        ]
        for field_name, sample_value, material_value, proposal in comparisons:
            if _blank(sample_value) or _blank(material_value) or str(sample_value).strip() == str(material_value).strip():
                continue
            rows.append({
                "sample_code": sample["sample_code"],
                "material_code": material["material_code"],
                "field": field_name,
                "sample_value": sample_value,
                "material_value": material_value,
                "proposed": proposal,
            })
    return rows


def sample_type_rows(samples, resolutions, materials_by_id) -> list[dict]:
    material_types_by_sample: dict[int, list[str]] = defaultdict(list)
    for material_id, resolution in resolutions.items():
        if resolution.kind == MATCHED:
            material_types_by_sample[resolution.sample_id].append(materials_by_id[material_id]["material_type_name"] or "(none)")

    groups: dict[str, list[dict]] = defaultdict(list)
    for sample in samples:
        groups[sample["sample_type"] if not _blank(sample["sample_type"]) else "(blank)"].append(sample)

    rows = []
    for sample_type, members in sorted(groups.items(), key=lambda item: -len(item[1])):
        roots = sum(1 for s in members if s["parent_sample_id"] is None)
        matched_types = Counter(t for s in members for t in material_types_by_sample[s["sample_id"]])
        rows.append({
            "sample_type": sample_type,
            "samples": len(members),
            "root_samples": roots,
            "derived_samples": len(members) - roots,
            "only_restates_root_or_derived": roots == len(members) or roots == 0,
            "samples_with_matched_material": sum(1 for s in members if material_types_by_sample[s["sample_id"]]),
            "matched_material_types": "; ".join(f"{name}: {count}" for name, count in matched_types.most_common(8))
            + (f"; +{len(matched_types) - 8} more" if len(matched_types) > 8 else ""),
            "example_sample_codes": ", ".join(s["sample_code"] for s in members[:5]),
        })
    return rows


def unmatched_sample_rows(samples, resolutions, materials) -> list[dict]:
    matched = {r.sample_id for r in resolutions.values() if r.kind == MATCHED}
    owned = Counter(material["sample_id"] for material in materials)
    return [
        {
            "sample_id": sample["sample_id"],
            "sample_code": sample["sample_code"],
            "sample_type": sample["sample_type"],
            "status": sample["status"],
            "has_parent": sample["parent_sample_id"] is not None,
            "materials_owned": owned[sample["sample_id"]],
        }
        for sample in samples if sample["sample_id"] not in matched
    ]


def write_csv(path: Path, rows: list[dict], columns: list[str] | None = None) -> None:
    columns = columns or (list(rows[0].keys()) if rows else [])
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def write_summary(path: Path, data: dict, resolutions, override_errors, conflicts, type_rows, unmatched, warnings_count, database_label: str) -> None:
    samples, materials = data["samples"], data["materials"]
    kinds = Counter(r.kind for r in resolutions.values())
    reasons = Counter(r.reason for r in resolutions.values() if r.kind == AMBIGUOUS)
    samples_by_id = {s["sample_id"]: s for s in samples}
    materials_by_id = {m["material_id"]: m for m in materials}
    status_pairs = Counter(
        (samples_by_id[r.sample_id]["status"], materials_by_id[mid]["status"])
        for mid, r in resolutions.items() if r.kind == MATCHED
    )
    sample_codes = {s["sample_code"] for s in samples}
    shared_codes = sum(1 for m in materials if m["material_code"] in sample_codes)
    cyclic_samples = find_cycles(samples_by_id, "sample_id", "parent_sample_id")

    lines = [
        "# Legacy Sample/Material identity audit",
        "",
        f"- Run at: {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        f"- Database: {database_label}",
        f"- Alembic version: {data['alembic_version'] or '(none)'}",
        f"- Samples: {len(samples)}; Materials: {len(materials)}",
        "",
        "## Material classification",
        "",
        f"- matched to an existing Sample: {kinds[MATCHED]}",
        f"- new derived Sample needed: {kinds[NEW_SAMPLE]}",
        f"- ambiguous (needs override): {kinds[AMBIGUOUS]}",
        f"- resolved by override: {sum(1 for r in resolutions.values() if r.source == 'override' and r.kind != AMBIGUOUS)}",
        f"- materials with non-blocking warnings: {warnings_count}",
        "",
    ]
    if override_errors:
        lines += ["## Override file errors", ""] + [f"- {error}" for error in override_errors] + [""]
    if reasons:
        lines += ["## Ambiguity reasons", ""] + [f"- {count} × {reason}" for reason, count in reasons.most_common(25)] + [""]
    lines += [
        "## Samples",
        "",
        f"- Samples with no matched Material (stay as Samples with empty inventory fields): {len(unmatched)}",
        f"- Samples in parent cycles: {len(cyclic_samples)}",
        f"- Material codes that are also Sample codes: {shared_codes}",
        "",
        "## Status of matched pairs (sample status → material status)",
        "",
        "| sample status | material status | pairs |",
        "| --- | --- | --- |",
    ] + [f"| {s} | {m} | {n} |" for (s, m), n in status_pairs.most_common()] + [
        "",
        "## Free-text sample_type values",
        "",
        "| sample_type | samples | root | derived | only root/derived? | matched material types |",
        "| --- | --- | --- | --- | --- | --- |",
    ] + [
        f"| {r['sample_type']} | {r['samples']} | {r['root_samples']} | {r['derived_samples']} | {r['only_restates_root_or_derived']} | {r['matched_material_types']} |"
        for r in type_rows[:40]
    ] + [
        "",
        "## Matched-pair field conflicts",
        "",
    ] + [f"- {field_name}: {count}" for field_name, count in Counter(c["field"] for c in conflicts).most_common()] + [
        "" if conflicts else "- none",
        "",
        "## Not answerable from the database",
        "",
        "- Whether physical tubes carry MAT codes, Sample codes, or both. Check labels in the freezer.",
        "",
        "## Row counts",
        "",
    ] + [f"- {table}: {count}" for table, count in sorted(data["row_counts"].items())] + [""]
    path.write_text("\n".join(lines), encoding="utf-8")


def _blank(value) -> bool:
    return value is None or str(value).strip() == ""


def _redacted_url(database_url: str) -> str:
    from sqlalchemy.engine import make_url

    return make_url(database_url).render_as_string(hide_password=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, type=Path, help="directory for the report files")
    parser.add_argument("--overrides", type=Path, help="human-reviewed identity_overrides.csv to validate and apply")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="defaults to $DATABASE_URL")
    args = parser.parse_args(argv)
    if not args.database_url:
        parser.error("set DATABASE_URL or pass --database-url")

    connection = connect_read_only(args.database_url)
    try:
        data = load_database(connection)
    finally:
        connection.rollback()
        connection.close()

    samples, materials = data["samples"], data["materials"]
    overrides, override_errors = ({}, [])
    if args.overrides:
        overrides, override_errors = read_overrides(args.overrides, samples, materials)

    resolutions = classify_materials(samples, materials, overrides)
    add_process_warnings(resolutions, materials, data["process_inputs_by_output"])
    samples_by_id = {s["sample_id"]: s for s in samples}
    materials_by_id = {m["material_id"]: m for m in materials}

    args.out.mkdir(parents=True, exist_ok=True)
    conflicts = field_conflict_rows(resolutions, samples_by_id, materials_by_id)
    type_rows = sample_type_rows(samples, resolutions, materials_by_id)
    unmatched = unmatched_sample_rows(samples, resolutions, materials)
    write_csv(args.out / "material_classification.csv", classification_rows(resolutions, samples_by_id, materials_by_id, data["reference_counts"]))
    write_csv(args.out / "identity_overrides.csv", override_rows(resolutions, samples_by_id, materials_by_id, args.overrides), OVERRIDE_COLUMNS)
    write_csv(args.out / "matched_field_conflicts.csv", conflicts, ["sample_code", "material_code", "field", "sample_value", "material_value", "proposed"])
    write_csv(args.out / "sample_type_audit.csv", type_rows)
    write_csv(args.out / "unmatched_samples.csv", unmatched, ["sample_id", "sample_code", "sample_type", "status", "has_parent", "materials_owned"])
    write_csv(
        args.out / "schema_inventory.csv",
        [dict(column, row_count=data["row_counts"][table]) for table, columns in data["columns_by_table"].items() for column in columns],
    )
    warnings_count = sum(1 for r in resolutions.values() if r.warnings)
    write_summary(args.out / "summary.md", data, resolutions, override_errors, conflicts, type_rows, unmatched, warnings_count, _redacted_url(args.database_url))

    kinds = Counter(r.kind for r in resolutions.values())
    print(f"matched={kinds[MATCHED]} new_sample={kinds[NEW_SAMPLE]} ambiguous={kinds[AMBIGUOUS]} override_errors={len(override_errors)}")
    print(f"Reports written to {args.out}")
    if override_errors:
        return 2
    return 1 if kinds[AMBIGUOUS] else 0


if __name__ == "__main__":
    sys.exit(main())
