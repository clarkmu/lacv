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
    """An execution this Sample took part in, as the Sample page lists it, with this Sample's result in it."""
    assay_execution_id: int
    execution_name: str
    assay_definition_id: int
    assay_name: str
    assay_type: str
    target: str | None = None
    status: str
    qc_status: str
    assay_date: datetime | None = None
    sample_count: int = 1
    # This Sample's result set in the execution: the fields entered so far.
    results: list["SampleResultBrief"] = []

class SampleResultBrief(BaseModel):
    label: str
    unit: str | None = None
    numeric_value: Decimal | None = None
    text_value: str | None = None
    interpretation: str | None = None
    qc_status: str

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
    related_assay_execution_id: int | None = None
    event_date: datetime
    operator_name: str | None = None
    notes: str | None = None

class DataFileBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    data_file_id: int
    assay_execution_id: int | None = None
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
    # An execution this Sample took part in.
    assay_execution_id: int | None = None
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

class AssayDefinitionFields(BaseModel):
    """What the procedure is, and the one result each Sample in an execution reports. Nothing about one execution."""
    assay_name: str = Field(min_length=1, max_length=255)
    assay_type: str = Field(min_length=1, max_length=100)
    target: str | None = Field(default=None, max_length=255)
    kit: str | None = Field(default=None, max_length=255)
    instrument: str | None = Field(default=None, max_length=255)
    typical_volume: Decimal | None = Field(default=None, gt=0)
    typical_volume_unit: str | None = Field(default=None, max_length=50)
    description: str | None = None
    # The result fields each Sample in an execution reports, in order.
    result_fields: list["ResultFieldIn"] = []

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

    _tidy = field_validator("assay_name", "assay_type", "target", "kit", "instrument", "typical_volume_unit", mode="before")(tidy_text)
    _tidy_description = field_validator("description", mode="before")(tidy_long_text)

class ResultFieldIn(BaseModel):
    """A result field of an assay, e.g. CT for analyte LACV in cycles."""
    analyte: str | None = Field(default=None, max_length=255)
    result_name: str = Field(min_length=1, max_length=255)
    unit: str | None = Field(default=None, max_length=50)
    value_type: str = Field(default="either", pattern="^(numeric|text|either)$")

    _tidy = field_validator("analyte", "result_name", "unit", mode="before")(tidy_text)

class ResultField(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    assay_definition_result_id: int
    analyte: str | None = None
    result_name: str
    unit: str | None = None
    value_type: str
    # "<analyte> <result_name>", e.g. "LACV CT".
    label: str

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
    result_fields: list[ResultField] = []
    is_active: bool

class AssayDefinitionListItem(AssayDefinitionBrief):
    # Executions, not Sample rows; distinct Samples across them; the latest execution date.
    execution_count: int = 0
    sample_count: int = 0
    last_performed: datetime | None = None

class ExecutionResultBrief(BaseModel):
    """One entered field of a Sample's result set."""
    model_config = ConfigDict(from_attributes=True)
    assay_definition_result_id: int
    numeric_value: Decimal | None = None
    text_value: str | None = None
    interpretation: str | None = None
    qc_status: str

class ExecutionSampleRow(BaseModel):
    """A Sample in an execution and its result set: one entry per field entered so far (none until the assay is done)."""
    assay_execution_sample_id: int
    sample: SampleRef
    results: list[ExecutionResultBrief] = []
    # From this Sample's quantity ledger, when the execution used some of it.
    volume_used: Decimal | None = None
    volume_unit: str | None = None

class AssayExecutionDetail(BaseModel):
    """One execution of an assay: its details, its Samples with their results, and what it produced."""
    assay_execution_id: int
    execution_name: str
    assay_definition_id: int
    operator_name: str | None = None
    assay_date: datetime | None = None
    status: str
    qc_status: str
    notes: str | None = None
    samples: list[ExecutionSampleRow] = []
    output_samples: list[SampleRef] = []
    data_files: list[DataFileBrief] = []

class ResultFieldSummary(BaseModel):
    """One result field's mean over the numeric values entered so far. Empty and text values are counted, never averaged."""
    assay_definition_result_id: int
    label: str
    unit: str | None = None
    mean: Decimal | None = None
    numeric_count: int = 0
    text_count: int = 0
    empty_count: int = 0
    # False for a text field: no mean is meaningful.
    averageable: bool = True

class AssayDefinitionDetail(AssayDefinitionListItem):
    description: str | None = None
    created_at: datetime
    # What a new execution is called unless the user renames it.
    next_execution_name: str
    # One per result field, in the assay's order.
    result_summaries: list[ResultFieldSummary] = []
    executions: list[AssayExecutionDetail] = []

class ExecutionResultInput(BaseModel):
    """One result field for one Sample, as typed. Every part may be blank: blank means not entered."""
    assay_definition_result_id: int
    # A number such as 31.2, or text such as "not detected".
    value: str | None = None
    interpretation: str | None = Field(default=None, max_length=255)
    qc_status: str | None = None

    _tidy_value = field_validator("value", mode="before")(tidy_long_text)
    _tidy = field_validator("interpretation", "qc_status", mode="before")(tidy_text)

class ExecutionSampleCreate(BaseModel):
    sample_id: int
    # Any of the assay's result fields; leave them out, or blank, when the assay has not been done yet.
    results: list[ExecutionResultInput] = []
    # Volume of this Sample the execution used; recorded on the Sample's quantity ledger.
    volume_used: Decimal | None = Field(default=None, gt=0)
    # Defaults to the Sample's quantity unit.
    volume_unit: str | None = None

    _tidy_unit = field_validator("volume_unit", mode="before")(tidy_text)

class AssayExecutionCreate(BaseModel):
    """One execution of an assay on one or more Samples, created with all its Samples or not at all."""
    # Generated (<assay code>-NNN) when omitted.
    execution_name: str | None = Field(default=None, min_length=1, max_length=100)
    # "Performed by" in the UI.
    operator_name: str | None = Field(default=None, max_length=150)
    assay_date: datetime | None = None
    status: str = "completed"
    qc_status: str = "not_reviewed"
    notes: str | None = None
    samples: list[ExecutionSampleCreate] = Field(min_length=1, max_length=2000)

    _tidy = field_validator("execution_name", "operator_name", mode="before")(tidy_text)
    _tidy_notes = field_validator("notes", mode="before")(tidy_long_text)

class AssayExecutionUpdate(BaseModel):
    execution_name: str | None = Field(default=None, min_length=1, max_length=100)
    operator_name: str | None = Field(default=None, max_length=150)
    assay_date: datetime | None = None
    status: str | None = None
    qc_status: str | None = None
    notes: str | None = None

    _tidy = field_validator("execution_name", "operator_name", mode="before")(tidy_text)
    _tidy_notes = field_validator("notes", mode="before")(tidy_long_text)

class ExecutionResultUpdate(BaseModel):
    """Change one field of one Sample's result set; only what is sent changes. Blank value and interpretation clear the field."""
    value: str | None = None
    interpretation: str | None = Field(default=None, max_length=255)
    qc_status: str | None = None

    _tidy_value = field_validator("value", mode="before")(tidy_long_text)
    _tidy = field_validator("interpretation", "qc_status", mode="before")(tidy_text)

class ExecutionImportSource(BaseModel):
    file_name: str
    sha256: str
    sheets: list[str]

class SampleCandidate(BaseModel):
    """A Sample the row's code might mean, and why it was suggested."""
    sample: SampleRef
    reason: str

class ExecutionImportRow(BaseModel):
    """One Samples-sheet row: its exact Sample, or close candidates for the user to choose from, or neither."""
    row_number: int
    sample_code: str | None = None
    # exact | close | none
    match: str
    sample: SampleRef | None = None
    candidates: list[SampleCandidate] = []
    # Set when an earlier row already matched the same Sample exactly: a Sample appears once in an execution.
    duplicate_of_row: int | None = None
    results: list[ExecutionResultInput] = []
    volume_used: Decimal | None = None
    volume_unit: str | None = None
    # Problems with the row's values (a missing code, an invalid result or volume); matching is in match and duplicate_of_row.
    problems: list[str] = []

class ExecutionImportDetails(BaseModel):
    execution_name: str | None = None
    assay_date: datetime | None = None
    operator_name: str | None = None
    notes: str | None = None

class ExecutionImportPreview(BaseModel):
    """What a workbook would create. Nothing is saved; the rows are then saved as a new execution."""
    source: ExecutionImportSource
    execution: ExecutionImportDetails | None = None
    rows: list[ExecutionImportRow] = []
    # Problems with the file itself, which block the import; each names its sheet and row. Row problems are on the rows.
    problems: list[str] = []
    can_import: bool

class StorageSubLocation(StorageLocationBrief):
    """A location inside another, with how many Samples are stored in it and below it."""
    sample_count: int = 0

class StoredSample(BaseModel):
    """One physical tube in a location. root is the original Sample it derives from, when it is not itself original."""
    sample_id: int
    sample_code: str
    sample_type_id: int | None = None
    sample_type: str | None = None
    status: str
    subject_code: str | None = None
    aliquot_number: int | None = None
    label: str | None = None
    current_quantity: Decimal | None = None
    quantity_unit: str | None = None
    concentration: Decimal | None = None
    concentration_unit: str | None = None
    received_date: datetime | None = None
    legacy_codes: list[str] = []
    parent: SampleRef | None = None
    root: SampleRef | None = None
    storage_location_id: int
    storage_location_code: str

class StorageLocationDetail(StorageLocationBrief):
    description: str | None = None
    # Outermost first, ending with this location's parent.
    ancestors: list[StorageLocationBrief] = []
    sub_locations: list[StorageSubLocation] = []
    # Samples stored here and in every location below this one.
    contents: list[StoredSample] = []

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

AssaySummary.model_rebuild()
AssayDefinitionFields.model_rebuild()
AssayDefinitionCreate.model_rebuild()
SampleDetail.model_rebuild()
