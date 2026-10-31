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

export type BatchDetail = BatchBrief & { description: string | null; is_active: boolean; samples: SampleRef[] }

export type BatchSampleImportRow = {
  sample_code: string
  external_sample_id: string | null
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

export type AssaySummary = {
  assay_id: number
  assay_code: string
  assay_name: string
  assay_type: string
  target: string | null
  status: string
  qc_status: string
  assay_date: string | null
  result_count: number
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
  related_assay_id: number | null
  event_date: string
  operator_name: string | null
  notes: string | null
}

export type DataFile = {
  data_file_id: number
  assay_id: number | null
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

export type AssayResult = {
  assay_result_id: number
  assay_id: number
  analyte: string | null
  result_name: string
  numeric_value: string | null
  text_value: string | null
  unit: string | null
  interpretation: string | null
  qc_status: string
}

export type AssayBrief = {
  assay_id: number
  assay_code: string
  assay_name: string
  assay_type: string
  target: string | null
  sample: SampleRef
  operator_name: string | null
  assay_date: string | null
  status: string
  qc_status: string
}

export type AssayDefinition = {
  assay_definition_id: number
  assay_code: string
  assay_name: string
  assay_type: string
  target: string | null
}

export type AssayDetail = AssayBrief & {
  notes: string | null
  volume_used: string | null
  volume_unit: string | null
  results: AssayResult[]
  output_samples: SampleRef[]
  data_files: DataFile[]
}
