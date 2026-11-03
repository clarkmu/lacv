export type SampleRef = {
  sample_id: number
  sample_code: string
  sample_type: string | null
  status: string
}

export type SampleListItem = SampleRef & {
  sample_type_id: number | null
  parent_sample_id: number | null
  batch_id: number | null
  external_sample_id: string | null
  subject_code: string | null
  aliquot_number: number | null
  label: string | null
  received_date: string | null
  current_quantity: string | null
  quantity_unit: string | null
  storage_location_id: number | null
  legacy_codes: string[]
}

export type BatchBrief = {
  batch_id: number
  batch_code: string
  batch_name: string
}

export type BatchListItem = BatchBrief & { description: string | null; is_active: boolean; sample_count: number }

/** A root Sample as the Batch page lists and edits it. */
export type BatchSampleRow = {
  sample_id: number
  sample_code: string
  subject_code: string | null
  external_sample_id: string | null
  sample_type_id: number | null
  sample_type: string | null
  aliquot_number: number | null
  collection_date: string | null
  received_date: string | null
  status: string
  current_quantity: string | null
  quantity_unit: string | null
  storage_location_id: number | null
  storage_location_code: string | null
  child_count: number
}

export type BatchDetail = BatchBrief & { description: string | null; is_active: boolean; samples: BatchSampleRow[] }

export type BatchSampleImportRow = {
  sample_code: string
  subject_code: string | null
  external_sample_id: string | null
  aliquot_number: number | null
  sample_type: string | null
  source_type: string | null
  source_description: string | null
  collection_date: string | null
  received_date: string | null
  status: string
  notes: string | null
}

export type BatchSampleImportPreview = {
  samples: BatchSampleImportRow[]
}

export type SampleType = {
  sample_type_id: number
  type_code: string
  type_name: string
}

export type StorageLocation = { storage_location_id: number; parent_location_id: number | null; location_code: string; location_type: string; location_name: string | null; is_active: boolean }

/** One physical tube stored in a location. root is the original Sample it derives from (null when it is itself original). */
export type StoredSample = {
  sample_id: number
  sample_code: string
  sample_type_id: number | null
  sample_type: string | null
  status: string
  subject_code: string | null
  aliquot_number: number | null
  label: string | null
  current_quantity: string | null
  quantity_unit: string | null
  concentration: string | null
  concentration_unit: string | null
  received_date: string | null
  legacy_codes: string[]
  parent: SampleRef | null
  root: SampleRef | null
  storage_location_id: number
  storage_location_code: string
}

export type StorageLocationDetail = StorageLocation & {
  description: string | null
  ancestors: StorageLocation[]
  sub_locations: (StorageLocation & { sample_count: number })[]
  contents: StoredSample[]
}

export type ProcessEventSummary = {
  process_event_id: number
  process_code: string
  process_type: string
  status: string
  operator_name: string | null
  started_at: string | null
  completed_at: string | null
  role: string
  inputs: SampleRef[]
  outputs: SampleRef[]
}

/** An execution this Sample took part in, as the Sample page lists it, with this Sample's result in it. */
export type AssaySummary = {
  assay_execution_id: number
  execution_name: string
  assay_definition_id: number
  assay_name: string
  assay_type: string
  target: string | null
  status: string
  qc_status: string
  assay_date: string | null
  sample_count?: number
  result_numeric?: string | null
  result_text?: string | null
  result_unit?: string | null
}

export type StorageEvent = {
  storage_event_id: number
  event_type: string
  event_date: string
  from_location_id: number | null
  to_location_id: number | null
  from_location_code: string | null
  to_location_code: string | null
  operator_name: string | null
  notes: string | null
}

export type QuantityEvent = {
  quantity_event_id: number
  event_type: string
  quantity_change: string
  quantity_unit: string
  quantity_before: string | null
  quantity_after: string | null
  related_process_event_id: number | null
  related_assay_execution_id: number | null
  event_date: string
  operator_name: string | null
  notes: string | null
}

export type DataFile = {
  data_file_id: number
  assay_execution_id: number | null
  sample_id: number | null
  file_type: string
  file_name: string
  file_location: string
  checksum_sha256: string | null
  notes: string | null
  created_at: string
}

export type LegacyIdentifier = {
  legacy_material_id: number
  material_code: string
  resolution: string
  migrated_at: string
}

export type SampleAvailability = {
  state: 'tracked' | 'not_recorded' | 'no_unit' | 'unit_mismatch' | 'inconsistent'
  unit: string | null
  dimension: 'volume' | 'mass' | null
  starting_quantity: string | null
  available_quantity: string | null
  removed_quantity: string | null
  added_quantity: string | null
  percent_remaining: number | null
  problems: string[]
}

export type SampleDetail = SampleListItem & {
  subtype: string | null
  source_type: string | null
  source_description: string | null
  collection_date: string | null
  concentration: string | null
  concentration_unit: string | null
  is_consumed: boolean
  is_disposed: boolean
  expiration_date: string | null
  notes: string | null
  batch: BatchBrief | null
  parent: SampleRef | null
  children: SampleRef[]
  storage_location: StorageLocation | null
  legacy_identifiers: LegacyIdentifier[]
  generated_by_assays: AssaySummary[]
  process_events: ProcessEventSummary[]
  assays: AssaySummary[]
  storage_events: StorageEvent[]
  quantity_events: QuantityEvent[]
  data_files: DataFile[]
  availability: SampleAvailability
}

export type SampleLineageNode = SampleRef & {
  generated_by: { kind: 'process' | 'assay'; code: string; type: string } | null
  children: SampleLineageNode[]
}

export type SampleLineage = {
  sample: SampleRef
  ancestors: SampleRef[]
  descendants: SampleLineageNode[]
}

export type ProcessEventDetail = {
  process_event_id: number
  process_code: string
  process_type: string
  status: string
  operator_name: string | null
  started_at: string | null
  completed_at: string | null
  notes: string | null
  inputs: SampleRef[]
  outputs: SampleRef[]
}

export type ResultValueType = 'numeric' | 'text' | 'either'

/** A reusable assay procedure and the one result each Sample in an execution reports. */
export type AssayDefinition = {
  assay_definition_id: number
  assay_code: string
  assay_name: string
  assay_type: string
  target: string | null
  kit: string | null
  instrument: string | null
  typical_volume: string | null
  typical_volume_unit: string | null
  result_name: string | null
  result_unit: string | null
  result_value_type: ResultValueType
  is_active: boolean
}

export type AssayDefinitionListItem = AssayDefinition & {
  /** Executions, not Sample rows. */
  execution_count: number
  /** Distinct Samples across the executions. */
  sample_count: number
  last_performed: string | null
}

/** A Sample in an execution and its one result (both result fields null until entered). */
export type ExecutionSample = {
  assay_execution_sample_id: number
  sample: SampleRef
  result_numeric: string | null
  result_text: string | null
  volume_used: string | null
  volume_unit: string | null
}

/** One execution (run) of an assay, holding one or more Samples. */
export type AssayExecution = {
  assay_execution_id: number
  execution_name: string
  assay_definition_id: number
  operator_name: string | null
  assay_date: string | null
  status: string
  qc_status: string
  notes: string | null
  samples: ExecutionSample[]
  output_samples: SampleRef[]
  data_files: DataFile[]
}

/** The mean of the numeric results so far; empty and text results are counted but never averaged. */
export type NumericResultSummary = {
  mean: string | null
  numeric_count: number
  text_count: number
  empty_count: number
  unit: string | null
  averageable: boolean
}

export type AssayDefinitionDetail = AssayDefinitionListItem & {
  description: string | null
  created_at: string
  next_execution_name: string
  result_summary: NumericResultSummary
  executions: AssayExecution[]
}

export type AssayDefinitionDraft = {
  assay_name: string
  assay_type: string
  target: string | null
  kit: string | null
  instrument: string | null
  typical_volume: string | null
  typical_volume_unit: string | null
  description: string | null
  result_name: string | null
  result_unit: string | null
  result_value_type: ResultValueType
}

/** A Sample row of a new execution, as sent: the result as typed (blank for not yet known). */
export type ExecutionSampleDraft = {
  sample_id: number
  result: string | null
  volume_used: string | null
  volume_unit: string | null
}

export type ExecutionImportRow = {
  row_number: number
  sample_code: string | null
  sample: SampleRef | null
  result: string | null
  volume_used: string | null
  volume_unit: string | null
  problems: string[]
}

export type ExecutionImportPreview = {
  source: { file_name: string; sha256: string; sheets: string[] }
  execution: { execution_name: string | null; assay_date: string | null; operator_name: string | null; notes: string | null } | null
  rows: ExecutionImportRow[]
  problems: string[]
  can_import: boolean
}
