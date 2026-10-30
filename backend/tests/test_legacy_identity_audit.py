import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from legacy_identity_audit import AMBIGUOUS, MATCHED, NEW_SAMPLE, classify_materials, read_overrides  # noqa: E402


def sample(sample_id, code, parent=None):
    return {"sample_id": sample_id, "sample_code": code, "parent_sample_id": parent}


def material(material_id, code, sample_id, parent=None):
    return {"material_id": material_id, "material_code": code, "sample_id": sample_id, "parent_material_id": parent}


def test_seed_shape_matches_each_material_to_its_sample():
    samples = [sample(1, "S-ROOT"), sample(2, "S-CHILD", parent=1)]
    materials = [material(10, "M-ROOT", 1), material(11, "M-CHILD", 2, parent=10)]

    result = classify_materials(samples, materials)

    assert (result[10].kind, result[10].sample_id) == (MATCHED, 1)
    assert (result[11].kind, result[11].sample_id) == (MATCHED, 2)


def test_aliquots_under_same_sample_become_new_derived_samples():
    samples = [sample(1, "S-ROOT")]
    materials = [material(10, "M-ROOT", 1), material(11, "M-ROOT-A1", 1, parent=10), material(12, "M-ROOT-A1-RNA", 1, parent=11)]

    result = classify_materials(samples, materials)

    assert result[10].kind == MATCHED
    assert (result[11].kind, result[11].parent_ref, result[11].new_sample_code) == (NEW_SAMPLE, ("sample", 1), "M-ROOT-A1")
    assert (result[12].kind, result[12].parent_ref) == (NEW_SAMPLE, ("material", 11))


def test_two_root_materials_on_one_sample_are_ambiguous_with_their_descendants():
    samples = [sample(1, "S-ROOT")]
    materials = [material(10, "M-SERUM", 1), material(11, "M-PLASMA", 1), material(12, "M-SERUM-A1", 1, parent=10)]

    result = classify_materials(samples, materials)

    assert {result[mid].kind for mid in (10, 11, 12)} == {AMBIGUOUS}
    assert "blocked" in result[12].reason


def test_derivative_is_ambiguous_when_parent_has_child_sample_without_material():
    samples = [sample(1, "S-ROOT"), sample(2, "S-CHILD", parent=1)]
    materials = [material(10, "M-ROOT", 1), material(11, "M-ROOT-A1", 1, parent=10)]

    result = classify_materials(samples, materials)

    assert result[11].kind == AMBIGUOUS
    assert "S-CHILD" in result[11].reason


def test_material_lineage_that_disagrees_with_sample_lineage_is_ambiguous():
    samples = [sample(1, "S-A"), sample(2, "S-B"), sample(3, "S-C", parent=2)]
    materials = [material(10, "M-A", 1), material(11, "M-B", 2), material(12, "M-C", 3, parent=10)]

    result = classify_materials(samples, materials)

    assert result[12].kind == AMBIGUOUS


def test_new_sample_code_colliding_with_existing_sample_code_is_ambiguous():
    samples = [sample(1, "S-ROOT"), sample(2, "M-ROOT-A1")]
    materials = [material(10, "M-ROOT", 1), material(11, "M-ROOT-A1", 1, parent=10), material(12, "M-OTHER", 2)]

    result = classify_materials(samples, materials)

    assert result[11].kind == AMBIGUOUS
    assert "already exists" in result[11].reason


def test_overrides_resolve_ambiguity_and_unblock_descendants(tmp_path):
    samples = [sample(1, "S-ROOT")]
    materials = [material(10, "M-SERUM", 1), material(11, "M-PLASMA", 1), material(12, "M-PLASMA-A1", 1, parent=11)]
    overrides_file = tmp_path / "identity_overrides.csv"
    overrides_file.write_text(
        "material_code,resolution,sample_code,parent_sample_code,new_sample_code\n"
        "M-SERUM,matched,S-ROOT,,\n"
        "M-PLASMA,new_sample,,S-ROOT,\n"
    )

    overrides, errors = read_overrides(overrides_file, samples, materials)
    result = classify_materials(samples, materials, overrides)

    assert errors == []
    assert (result[10].kind, result[10].sample_id) == (MATCHED, 1)
    assert (result[11].kind, result[11].parent_ref) == (NEW_SAMPLE, ("sample", 1))
    assert (result[12].kind, result[12].parent_ref) == (NEW_SAMPLE, ("material", 11))


def test_invalid_overrides_are_reported(tmp_path):
    samples = [sample(1, "S-ROOT")]
    materials = [material(10, "M-ROOT", 1)]
    overrides_file = tmp_path / "identity_overrides.csv"
    overrides_file.write_text(
        "material_code,resolution,sample_code,parent_sample_code,new_sample_code\n"
        "M-NOPE,matched,S-ROOT,,\n"
        "M-ROOT,guess,,,\n"
    )

    overrides, errors = read_overrides(overrides_file, samples, materials)

    assert overrides == {}
    assert len(errors) == 2
