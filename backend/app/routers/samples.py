from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from ..database import get_db
from ..models import Assay, Material, ProcessEvent, ProcessEventInput, ProcessEventOutput, Sample
from ..schemas import SampleBrief, SampleCreate, SampleDetail, SampleLineage, SampleUpdate

router = APIRouter(prefix="/samples", tags=["samples"])

@router.get("", response_model=list[SampleBrief])
def list_samples(db: Session = Depends(get_db)):
    return db.scalars(select(Sample).order_by(Sample.sample_id.desc())).all()

@router.get("/{sample_id}", response_model=SampleDetail)
def get_sample(sample_id: int, db: Session = Depends(get_db)):
    stmt = (
        select(Sample)
        .where(Sample.sample_id == sample_id)
        .options(
            selectinload(Sample.batch),
            selectinload(Sample.parent),
            selectinload(Sample.offspring),
            selectinload(Sample.materials),
        )
    )
    sample = db.scalar(stmt)
    if not sample:
        raise HTTPException(404, "Sample not found")
    return sample

@router.get("/{sample_id}/lineage", response_model=SampleLineage)
def get_sample_lineage(sample_id: int, db: Session = Depends(get_db)):
    sample = db.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    materials = db.scalars(
        select(Material)
        .where(Material.sample_id == sample_id)
        .options(selectinload(Material.material_type_ref), selectinload(Material.offspring), selectinload(Material.parent))
    ).all()
    descendants = list(materials)
    seen_ids = {material.material_id for material in descendants}
    frontier = list(materials)
    while frontier:
        children = db.scalars(
            select(Material)
            .where(Material.parent_material_id.in_([material.material_id for material in frontier]))
            .options(selectinload(Material.material_type_ref))
        ).all()
        frontier = [material for material in children if material.material_id not in seen_ids]
        seen_ids.update(material.material_id for material in frontier)
        descendants.extend(frontier)

    assays = db.scalars(
        select(Assay)
        .where(Assay.material_id.in_(seen_ids))
        .options(selectinload(Assay.definition))
    ).all() if seen_ids else []
    assays_by_material = {}
    for assay in assays:
        assays_by_material.setdefault(assay.material_id, []).append({
            "assay_id": assay.assay_id,
            "assay_code": assay.assay_instance_code,
            "assay_type": assay.definition.assay_type,
            "target": assay.definition.target,
            "status": assay.status,
            "qc_status": assay.qc_status,
        })

    process_by_output_material = _processes_by_output_material(seen_ids, db)
    by_parent = {}
    by_id = {material.material_id: material for material in descendants}
    for material in descendants:
        by_parent.setdefault(material.parent_material_id, []).append(material)
    root_materials = [
        material
        for material in descendants
        if material.parent_material_id is None or material.parent_material_id not in by_id
    ]
    return {
        "sample": sample,
        "materials": [_serialize_material_node(material, by_parent, assays_by_material, process_by_output_material) for material in root_materials],
    }

@router.post("", response_model=SampleDetail, status_code=status.HTTP_201_CREATED)
def create_sample(payload: SampleCreate, db: Session = Depends(get_db)):
    # Lineage only: no values are copied from the parent.
    sample = Sample(**payload.model_dump())
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return get_sample(sample.sample_id, db)

@router.post("/{parent_id}/offspring", response_model=SampleDetail, status_code=status.HTTP_201_CREATED)
def create_offspring(parent_id: int, payload: SampleCreate, db: Session = Depends(get_db)):
    if not db.get(Sample, parent_id):
        raise HTTPException(404, "Parent sample not found")
    data = payload.model_dump()
    data["parent_sample_id"] = parent_id
    # Intentionally do not inherit any other parent properties.
    sample = Sample(**data)
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return get_sample(sample.sample_id, db)

@router.patch("/{sample_id}", response_model=SampleDetail)
def update_sample(sample_id: int, payload: SampleUpdate, db: Session = Depends(get_db)):
    sample = db.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(sample, key, value)
    db.commit()
    return get_sample(sample_id, db)

def _processes_by_output_material(material_ids: set[int], db: Session):
    if not material_ids:
        return {}
    output_links = db.scalars(select(ProcessEventOutput).where(ProcessEventOutput.material_id.in_(material_ids))).all()
    process_ids = {link.process_event_id for link in output_links}
    if not process_ids:
        return {}
    processes = {
        process.process_event_id: process
        for process in db.scalars(
            select(ProcessEvent)
            .where(ProcessEvent.process_event_id.in_(process_ids))
            .options(selectinload(ProcessEvent.process_type_ref))
        ).all()
    }
    input_links = db.scalars(select(ProcessEventInput).where(ProcessEventInput.process_event_id.in_(process_ids))).all()
    input_material_ids = {link.material_id for link in input_links}
    input_materials = {
        material.material_id: material
        for material in db.scalars(
            select(Material)
            .where(Material.material_id.in_(input_material_ids))
            .options(selectinload(Material.material_type_ref))
        ).all()
    } if input_material_ids else {}
    inputs_by_process = {}
    for link in input_links:
        material = input_materials.get(link.material_id)
        if material:
            inputs_by_process.setdefault(link.process_event_id, []).append(material)

    result = {}
    for link in output_links:
        process = processes.get(link.process_event_id)
        if not process:
            continue
        result[link.material_id] = {
            "process_event_id": process.process_event_id,
            "process_code": process.process_code,
            "process_type": process.process_type,
            "status": process.status,
            "operator_name": process.operator_name,
            "input_materials": inputs_by_process.get(process.process_event_id, []),
        }
    return result

def _serialize_material_node(material: Material, by_parent: dict, assays_by_material: dict, process_by_output_material: dict):
    return {
        "material_id": material.material_id,
        "material_code": material.material_code,
        "material_type": material.material_type,
        "status": material.status,
        "generated_by_process": process_by_output_material.get(material.material_id),
        "assays": assays_by_material.get(material.material_id, []),
        "children": [_serialize_material_node(child, by_parent, assays_by_material, process_by_output_material) for child in by_parent.get(material.material_id, [])],
    }
