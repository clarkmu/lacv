from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict

class BatchBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    batch_id: int
    batch_code: str
    batch_name: str

class SampleBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sample_id: int
    sample_code: str
    sample_type: str | None = None
    status: str

class BatchDetail(BatchBrief):
    description: str | None = None
    is_active: bool
    samples: list[SampleBrief] = []

class BatchSampleImportRow(BaseModel):
    sample_code: str
    parent_sample_id: int | None = None
    external_sample_id: str | None = None
    sample_type: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    status: str = "expected"
    notes: str | None = None

class BatchSampleImportPreview(BaseModel):
    samples: list[BatchSampleImportRow]

class BatchSampleImportCreate(BaseModel):
    batch_name: str
    samples: list[BatchSampleImportRow]

class MaterialBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    material_id: int
    material_code: str
    material_type: str
    status: str

class MaterialTypeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    material_type_id: int
    type_code: str
    type_name: str

class StorageLocationBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    storage_location_id: int
    parent_location_id: int | None = None
    location_code: str
    location_type: str
    location_name: str | None = None
    is_active: bool

class SampleCreate(BaseModel):
    sample_code: str
    batch_id: int | None = None
    parent_sample_id: int | None = None
    external_sample_id: str | None = None
    sample_type: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    status: str = "expected"
    notes: str | None = None

class SampleUpdate(BaseModel):
    batch_id: int | None = None
    parent_sample_id: int | None = None
    external_sample_id: str | None = None
    sample_type: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    status: str | None = None
    notes: str | None = None

class SampleDetail(SampleBrief):
    external_sample_id: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    notes: str | None = None
    batch: BatchBrief | None = None
    parent: SampleBrief | None = None
    offspring: list[SampleBrief] = []
    materials: list[MaterialBrief] = []

class MaterialCreate(BaseModel):
    sample_id: int
    material_type_id: int
    parent_material_id: int | None = None
    material_code: str
    material_label: str | None = None
    material_subtype: str | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    storage_location_id: int | None = None
    status: str = "available"
    is_consumed: bool = False
    is_disposed: bool = False
    expiration_date: datetime | None = None
    notes: str | None = None

class MaterialUpdate(BaseModel):
    sample_id: int | None = None
    storage_location_id: int | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    status: str | None = None
    is_consumed: bool | None = None
    is_disposed: bool | None = None
    expiration_date: datetime | None = None
    notes: str | None = None

class ProcessTypeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    process_type_id: int
    type_code: str
    type_name: str

class ProcessOutputMaterialCreate(MaterialCreate):
    quantity_generated: Decimal | None = None

class ProcessEventCreate(BaseModel):
    process_code: str
    process_type: str
    input_material_ids: list[int]
    output_materials: list[ProcessOutputMaterialCreate]
    quantity_used: Decimal | None = None
    quantity_unit: str | None = None
    operator_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status: str = "completed"
    notes: str | None = None

class AliquotCreate(BaseModel):
    process_code: str
    material_type_id: int
    aliquot_count: int
    material_code_prefix: str
    quantity_per_aliquot: Decimal | None = None
    quantity_unit: str | None = None
    storage_location_id: int | None = None
    operator_name: str | None = None
    notes: str | None = None

class AssayResultBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    assay_result_id: int
    assay_id: int
    analyte: str | None = None
    result_name: str
    numeric_value: Decimal | None = None
    text_value: str | None = None
    unit: str | None = None
    interpretation: str | None = None
    qc_status: str

class AssayResultCreate(BaseModel):
    analyte: str | None = None
    result_name: str
    numeric_value: Decimal | None = None
    text_value: str | None = None
    unit: str | None = None
    interpretation: str | None = None
    qc_status: str = "not_reviewed"

class AssayCreate(BaseModel):
    assay_instance_code: str
    assay_name: str | None = None
    assay_type: str
    target: str | None = None
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str = "planned"
    qc_status: str = "not_reviewed"
    notes: str | None = None

class AssayDetail(BaseModel):
    assay_id: int
    assay_code: str
    assay_name: str
    assay_type: str
    target: str | None = None
    material: MaterialBrief
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str
    qc_status: str
    notes: str | None = None
    results: list[AssayResultBrief] = []

class AssayBrief(BaseModel):
    assay_id: int
    assay_code: str
    assay_name: str
    assay_type: str
    target: str | None = None
    material: MaterialBrief
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str
    qc_status: str

class MaterialDetail(MaterialBrief):
    sample_id: int
    sample: SampleBrief
    storage_location_id: int | None = None
    storage_location: StorageLocationBrief | None = None
    material_subtype: str | None = None
    material_label: str | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    is_consumed: bool = False
    is_disposed: bool = False
    expiration_date: datetime | None = None
    notes: str | None = None
    parent: MaterialBrief | None = None
    offspring: list[MaterialBrief] = []
    process_events: list[dict] = []
    assays: list[dict] = []
    storage_events: list[dict] = []
    quantity_events: list[dict] = []

class MaterialLineageProcess(BaseModel):
    process_event_id: int
    process_code: str
    process_type: str
    status: str
    operator_name: str | None = None
    input_materials: list[MaterialBrief] = []

class MaterialLineageNode(BaseModel):
    material_id: int
    material_code: str
    material_type: str
    status: str
    generated_by_process: MaterialLineageProcess | None = None
    assays: list[dict] = []
    children: list["MaterialLineageNode"] = []

class SampleLineage(BaseModel):
    sample: SampleBrief
    materials: list[MaterialLineageNode]

class StorageLocationCreate(BaseModel):
    parent_location_id: int | None = None
    location_code: str
    location_type: str
    location_name: str | None = None
    description: str | None = None
    is_active: bool = True

class StorageLocationUpdate(BaseModel):
    parent_location_id: int | None = None
    location_code: str | None = None
    location_type: str | None = None
    location_name: str | None = None
    description: str | None = None
    is_active: bool | None = None
