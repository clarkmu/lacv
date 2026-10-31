from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field

class BatchBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    batch_id: int
    batch_code: str
    batch_name: str

class SampleRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sample_id: int
    sample_code: str
    sample_type: str | None = None
    status: str

class SampleListItem(SampleRef):
    sample_type_id: int | None = None
    parent_sample_id: int | None = None
    batch_id: int | None = None
    external_sample_id: str | None = None
    label: str | None = None
    received_date: datetime | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    storage_location_id: int | None = None
    legacy_codes: list[str] = []

class BatchDetail(BatchBrief):
    description: str | None = None
    is_active: bool
    samples: list[SampleRef] = []

class BatchSampleImportRow(BaseModel):
    """One root Sample in a shipping batch. sample_type names a sample type lookup entry."""
    sample_code: str
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

class SampleTypeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sample_type_id: int
    type_code: str
    type_name: str

class SampleTypeCreate(BaseModel):
    type_name: str = Field(min_length=1, max_length=150)
    type_code: str | None = Field(default=None, max_length=100)
    description: str | None = None

class StorageLocationBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    storage_location_id: int
    parent_location_id: int | None = None
    location_code: str
    location_type: str
    location_name: str | None = None
    is_active: bool

class SampleFields(BaseModel):
    """Values a user enters for a Sample. Nothing is copied from a parent."""
    external_sample_id: str | None = None
    sample_type_id: int | None = None
    label: str | None = None
    subtype: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    storage_location_id: int | None = None
    is_consumed: bool = False
    is_disposed: bool = False
    expiration_date: datetime | None = None
    notes: str | None = None

class SampleCreate(SampleFields):
    sample_code: str = Field(min_length=1, max_length=100)
    batch_id: int | None = None
    parent_sample_id: int | None = None
    status: str = "expected"

class DerivedSampleCreate(SampleFields):
    """A child Sample; its parent comes from the route or process, never from the payload."""
    sample_code: str = Field(min_length=1, max_length=100)
    status: str = "available"

class ChildSampleCreate(DerivedSampleCreate):
    """A child made directly from its parent. The amount taken, when given, is removed from the parent."""
    quantity_taken_from_parent: Decimal | None = Field(default=None, gt=0)
    # Defaults to the parent's quantity unit.
    quantity_taken_unit: str | None = None

class SampleUpdate(BaseModel):
    sample_code: str | None = Field(default=None, min_length=1, max_length=100)
    batch_id: int | None = None
    parent_sample_id: int | None = None
    external_sample_id: str | None = None
    sample_type_id: int | None = None
    label: str | None = None
    subtype: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    status: str | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    storage_location_id: int | None = None
    is_consumed: bool | None = None
    is_disposed: bool | None = None
    expiration_date: datetime | None = None
    notes: str | None = None
    # Recorded on the storage or quantity event this edit creates, not on the Sample.
    operator_name: str | None = None
    change_notes: str | None = None

class LegacyIdentifier(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    legacy_material_id: int
    material_code: str
    resolution: str
    migrated_at: datetime

class ProcessEventSummary(BaseModel):
    process_event_id: int
    process_code: str
    process_type: str
    status: str
    operator_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    role: str
    inputs: list[SampleRef] = []
    outputs: list[SampleRef] = []

class AssaySummary(BaseModel):
    assay_id: int
    assay_code: str
    assay_name: str
    assay_type: str
    target: str | None = None
    status: str
    qc_status: str
    assay_date: datetime | None = None
    result_count: int = 0

class StorageEventBrief(BaseModel):
    storage_event_id: int
    event_type: str
    event_date: datetime
    from_location_id: int | None = None
    to_location_id: int | None = None
    from_location_code: str | None = None
    to_location_code: str | None = None
    operator_name: str | None = None
    notes: str | None = None

class QuantityEventBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    quantity_event_id: int
    event_type: str
    quantity_change: Decimal
    quantity_unit: str
    quantity_before: Decimal | None = None
    quantity_after: Decimal | None = None
    related_process_event_id: int | None = None
    event_date: datetime
    operator_name: str | None = None
    notes: str | None = None

class DataFileBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    data_file_id: int
    assay_id: int | None = None
    sample_id: int | None = None
    file_type: str
    file_name: str
    file_location: str
    checksum_sha256: str | None = None
    notes: str | None = None
    created_at: datetime

class DataFileCreate(BaseModel):
    file_type: str = Field(min_length=1, max_length=50)
    file_name: str = Field(min_length=1, max_length=255)
    file_location: str = Field(min_length=1, max_length=1000)
    checksum_sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")
    assay_id: int | None = None
    notes: str | None = None

class SampleAvailability(BaseModel):
    """How much of a Sample remains, from its own quantity ledger (see app/quantity.py)."""
    # tracked | not_recorded | no_unit | unit_mismatch | inconsistent
    state: str
    unit: str | None = None
    dimension: str | None = None
    starting_quantity: Decimal | None = None
    available_quantity: Decimal | None = None
    removed_quantity: Decimal | None = None
    added_quantity: Decimal | None = None
    percent_remaining: float | None = None
    problems: list[str] = []

class SampleDetail(SampleListItem):
    subtype: str | None = None
    source_type: str | None = None
    source_description: str | None = None
    collection_date: datetime | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    is_consumed: bool = False
    is_disposed: bool = False
    expiration_date: datetime | None = None
    notes: str | None = None
    batch: BatchBrief | None = None
    parent: SampleRef | None = None
    children: list[SampleRef] = []
    storage_location: StorageLocationBrief | None = None
    legacy_identifiers: list[LegacyIdentifier] = []
    generated_by_assays: list[AssaySummary] = []
    process_events: list[ProcessEventSummary] = []
    assays: list[AssaySummary] = []
    storage_events: list[StorageEventBrief] = []
    quantity_events: list[QuantityEventBrief] = []
    data_files: list[DataFileBrief] = []
    availability: SampleAvailability

class LineageGeneratedBy(BaseModel):
    kind: str
    code: str
    type: str

class SampleLineageNode(SampleRef):
    generated_by: LineageGeneratedBy | None = None
    children: list["SampleLineageNode"] = []

class SampleLineage(BaseModel):
    sample: SampleRef
    ancestors: list[SampleRef]
    descendants: list[SampleLineageNode]

class ProcessTypeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    process_type_id: int
    type_code: str
    type_name: str

class ProcessOutputSampleCreate(DerivedSampleCreate):
    # Required when a process has several inputs; it must be one of them.
    parent_sample_id: int | None = None
    quantity_generated: Decimal | None = None

class ProcessEventCreate(BaseModel):
    process_code: str = Field(min_length=1, max_length=100)
    process_type: str = Field(min_length=1, max_length=150)
    protocol_id: int | None = None
    input_sample_ids: list[int]
    output_samples: list[ProcessOutputSampleCreate]
    quantity_used: Decimal | None = None
    quantity_unit: str | None = None
    operator_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status: str = "completed"
    notes: str | None = None

class ProcessEventDetail(BaseModel):
    process_event_id: int
    process_code: str
    process_type: str
    status: str
    operator_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    inputs: list[SampleRef] = []
    outputs: list[SampleRef] = []

class AliquotCreate(BaseModel):
    process_code: str = Field(min_length=1, max_length=100)
    aliquot_count: int = Field(ge=1, le=500)
    sample_code_prefix: str = Field(min_length=1, max_length=90)
    sample_type_id: int | None = None
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
    result_name: str = Field(min_length=1, max_length=255)
    numeric_value: Decimal | None = None
    text_value: str | None = None
    unit: str | None = None
    interpretation: str | None = None
    qc_status: str = "not_reviewed"

class AssayCreate(BaseModel):
    assay_instance_code: str = Field(min_length=1, max_length=100)
    assay_name: str | None = None
    assay_type: str = Field(min_length=1, max_length=100)
    target: str | None = None
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str = "planned"
    qc_status: str = "not_reviewed"
    notes: str | None = None

class AssayUpdate(BaseModel):
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str | None = None
    qc_status: str | None = None
    notes: str | None = None

class AssayBrief(BaseModel):
    assay_id: int
    assay_code: str
    assay_name: str
    assay_type: str
    target: str | None = None
    sample: SampleRef
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str
    qc_status: str

class AssayDetail(AssayBrief):
    notes: str | None = None
    results: list[AssayResultBrief] = []
    output_samples: list[SampleRef] = []
    data_files: list[DataFileBrief] = []

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
