from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def tidy_text(value):
    """Trim and collapse whitespace so the same name is stored the same way; blank means not given."""
    if not isinstance(value, str):
        return value
    return " ".join(value.split()) or None


def tidy_long_text(value):
    if not isinstance(value, str):
        return value
    return value.strip() or None

class BatchBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    batch_id: int
    batch_code: str
    batch_name: str

class BatchListItem(BatchBrief):
    description: str | None = None
    is_active: bool
    sample_count: int = 0

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
    subject_code: str | None = None
    aliquot_number: int | None = None
    label: str | None = None
    received_date: datetime | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    storage_location_id: int | None = None
    legacy_codes: list[str] = []

class BatchSampleRow(BaseModel):
    """A root Sample as the Batch page lists and edits it."""
    sample_id: int
    sample_code: str
    subject_code: str | None = None
    external_sample_id: str | None = None
    sample_type_id: int | None = None
    sample_type: str | None = None
    aliquot_number: int | None = None
    collection_date: datetime | None = None
    received_date: datetime | None = None
    status: str
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    storage_location_id: int | None = None
    storage_location_code: str | None = None
    child_count: int = 0

class BatchDetail(BatchBrief):
    description: str | None = None
    is_active: bool
    samples: list[BatchSampleRow] = []

class BatchSampleChange(BaseModel):
    """Changes to one Sample of a Batch; only the fields sent are changed."""
    sample_id: int
    subject_code: str | None = Field(default=None, max_length=100)
    external_sample_id: str | None = Field(default=None, max_length=100)
    sample_type_id: int | None = None
    aliquot_number: int | None = Field(default=None, ge=1)
    collection_date: datetime | None = None
    received_date: datetime | None = None
    status: str | None = Field(default=None, min_length=1, max_length=50)
    current_quantity: Decimal | None = Field(default=None, ge=0)
    quantity_unit: str | None = Field(default=None, max_length=50)
    storage_location_id: int | None = None

    _tidy = field_validator("subject_code", "external_sample_id", "status", "quantity_unit", mode="before")(tidy_text)

class BatchSamplesUpdate(BaseModel):
    """Several Samples of one Batch changed together: all of it is saved, or none."""
    changes: list[BatchSampleChange] = Field(min_length=1, max_length=500)
    operator_name: str | None = Field(default=None, max_length=150)
    change_notes: str | None = None

class BatchSampleImportRow(BaseModel):
    """One root Sample in a shipping batch. sample_type names a sample type lookup entry."""
    sample_code: str
    subject_code: str | None = None
    external_sample_id: str | None = None
    aliquot_number: int | None = Field(default=None, ge=1)
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
    subject_code: str | None = Field(default=None, max_length=100)
    aliquot_number: int | None = Field(default=None, ge=1)
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
    subject_code: str | None = Field(default=None, max_length=100)
    aliquot_number: int | None = Field(default=None, ge=1)
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
    """An assay execution as the Sample page lists it."""
    execution_id: int
    execution_code: str
    assay_definition_id: int
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
    related_assay_id: int | None = None
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
    analyte: str | None = None
    result_name: str
    numeric_value: Decimal | None = None
    text_value: str | None = None
    unit: str | None = None
    interpretation: str | None = None
    qc_status: str

class AssayResultFields(BaseModel):
    analyte: str | None = Field(default=None, max_length=255)
    numeric_value: Decimal | None = None
    text_value: str | None = None
    unit: str | None = Field(default=None, max_length=50)
    interpretation: str | None = Field(default=None, max_length=255)

    _tidy = field_validator("analyte", "unit", "interpretation", mode="before")(tidy_text)
    _tidy_value = field_validator("text_value", mode="before")(tidy_long_text)

class AssayResultCreate(AssayResultFields):
    """One result of an execution: a number (e.g. a CT of 31.2) or a text value (e.g. "not detected")."""
    result_name: str = Field(min_length=1, max_length=255)
    qc_status: str = "not_reviewed"

    _tidy_name = field_validator("result_name", mode="before")(tidy_text)

    @model_validator(mode="after")
    def needs_a_value(self):
        if self.numeric_value is None and self.text_value is None:
            raise ValueError("Enter a value: a number, or text such as \"not detected\"")
        return self

class AssayResultUpdate(AssayResultFields):
    result_name: str | None = Field(default=None, min_length=1, max_length=255)
    qc_status: str | None = None

    _tidy_name = field_validator("result_name", mode="before")(tidy_text)

class ExpectedResult(BaseModel):
    """A result an execution of the assay reports, e.g. "CT" for analyte "LACV"."""
    model_config = ConfigDict(from_attributes=True)
    analyte: str | None = Field(default=None, max_length=255)
    result_name: str = Field(min_length=1, max_length=255)
    unit: str | None = Field(default=None, max_length=50)
    value_type: str = Field(default="either", pattern="^(numeric|text|either)$")

    _tidy = field_validator("analyte", "result_name", "unit", mode="before")(tidy_text)

class AssayDefinitionFields(BaseModel):
    """What the procedure is. Nothing here is about one execution (who ran it, when, on which Sample)."""
    assay_name: str = Field(min_length=1, max_length=255)
    assay_type: str = Field(min_length=1, max_length=100)
    target: str | None = Field(default=None, max_length=255)
    kit: str | None = Field(default=None, max_length=255)
    instrument: str | None = Field(default=None, max_length=255)
    typical_volume: Decimal | None = Field(default=None, gt=0)
    typical_volume_unit: str | None = Field(default=None, max_length=50)
    description: str | None = None
    expected_results: list[ExpectedResult] = []

    _tidy = field_validator("assay_name", "assay_type", "target", "kit", "instrument", "typical_volume_unit", mode="before")(tidy_text)
    _tidy_description = field_validator("description", mode="before")(tidy_long_text)

    @model_validator(mode="after")
    def volume_has_a_unit(self):
        if self.typical_volume is not None and not self.typical_volume_unit:
            raise ValueError("Give the unit of the typical volume")
        return self

class AssayDefinitionCreate(AssayDefinitionFields):
    # Generated from the name when omitted.
    assay_code: str | None = Field(default=None, min_length=1, max_length=100)

    _tidy_code = field_validator("assay_code", mode="before")(tidy_text)

class AssayDefinitionUpdate(BaseModel):
    assay_name: str | None = Field(default=None, min_length=1, max_length=255)
    assay_type: str | None = Field(default=None, min_length=1, max_length=100)
    target: str | None = Field(default=None, max_length=255)
    kit: str | None = Field(default=None, max_length=255)
    instrument: str | None = Field(default=None, max_length=255)
    typical_volume: Decimal | None = Field(default=None, gt=0)
    typical_volume_unit: str | None = Field(default=None, max_length=50)
    description: str | None = None
    is_active: bool | None = None
    # Replaces the whole list when sent.
    expected_results: list[ExpectedResult] | None = None

    _tidy = field_validator("assay_name", "assay_type", "target", "kit", "instrument", "typical_volume_unit", mode="before")(tidy_text)
    _tidy_description = field_validator("description", mode="before")(tidy_long_text)

class AssayDefinitionBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    assay_definition_id: int
    assay_code: str
    assay_name: str
    assay_type: str
    target: str | None = None
    kit: str | None = None
    instrument: str | None = None
    typical_volume: Decimal | None = None
    typical_volume_unit: str | None = None
    is_active: bool
    expected_results: list[ExpectedResult] = []

class AssayDefinitionListItem(AssayDefinitionBrief):
    execution_count: int = 0
    sample_count: int = 0
    last_performed: datetime | None = None

class AssayExecutionBrief(BaseModel):
    """One execution of an assay on one Sample."""
    execution_id: int
    execution_code: str
    assay_definition_id: int
    assay_name: str
    assay_type: str
    target: str | None = None
    sample: SampleRef
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str
    qc_status: str
    result_count: int = 0

class AssayDefinitionDetail(AssayDefinitionListItem):
    description: str | None = None
    source_file_name: str | None = None
    source_sha256: str | None = None
    imported_at: datetime | None = None
    created_at: datetime
    executions: list[AssayExecutionBrief] = []

class AssayDefinitionImportSource(BaseModel):
    file_name: str
    sha256: str
    sheets: list[str]

class AssayDefinitionImportPreview(BaseModel):
    """What a workbook would create. Nothing is saved until the same file is confirmed."""
    source: AssayDefinitionImportSource
    definition: AssayDefinitionCreate | None = None
    # Problems block the import; each names where in the workbook it is.
    problems: list[str] = []
    can_import: bool

class AssayExecutionCreate(BaseModel):
    """An assay performed on a Sample: which assay, when, by whom, how much of the Sample it used, and any results."""
    assay_definition_id: int
    # Generated (ASSAY-NNN) when omitted.
    execution_code: str | None = Field(default=None, min_length=1, max_length=100)
    # "Performed by" in the UI.
    operator_name: str | None = Field(default=None, max_length=150)
    assay_date: datetime | None = None
    # Recording an execution means it was performed; QC review happens afterwards.
    status: str = "completed"
    qc_status: str = "not_reviewed"
    notes: str | None = None
    # Sample volume the execution used; recorded as a removal on the Sample's quantity ledger.
    volume_used: Decimal | None = Field(default=None, gt=0)
    # Defaults to the Sample's quantity unit.
    volume_unit: str | None = None
    results: list[AssayResultCreate] = []

    _tidy = field_validator("execution_code", "operator_name", "volume_unit", mode="before")(tidy_text)
    _tidy_notes = field_validator("notes", mode="before")(tidy_long_text)

class AssayExecutionUpdate(BaseModel):
    operator_name: str | None = Field(default=None, max_length=150)
    assay_date: datetime | None = None
    status: str | None = None
    qc_status: str | None = None
    notes: str | None = None

    _tidy = field_validator("operator_name", mode="before")(tidy_text)
    _tidy_notes = field_validator("notes", mode="before")(tidy_long_text)

class AssayExecutionDetail(AssayExecutionBrief):
    definition: AssayDefinitionBrief
    notes: str | None = None
    volume_used: Decimal | None = None
    volume_unit: str | None = None
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
