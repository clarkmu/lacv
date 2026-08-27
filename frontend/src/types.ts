export type SampleBrief = {
  sample_id: number
  sample_code: string
  sample_type: string | null
  status: string
}

export type BatchBrief = {
  batch_id: number
  batch_code: string
  batch_name: string
}

export type BatchDetail = BatchBrief & { description: string | null; is_active: boolean; samples: SampleBrief[] }

export type BatchSampleImportRow = {
  sample_code: string
  parent_sample_id: number | null
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

export type MaterialBrief = {
  material_id: number
  material_code: string
  material_type: string
  status: string
}

export type MaterialTypeBrief = {
  material_type_id: number
  type_code: string
  type_name: string
}

export type MaterialDetail = MaterialBrief & {
  sample_id: number
  sample: SampleBrief
  storage_location_id: number | null
  storage_location: StorageLocation | null
  material_subtype: string | null
  material_label: string | null
  current_quantity: string | null
  quantity_unit: string | null
  concentration: string | null
  concentration_unit: string | null
  is_consumed: boolean
  is_disposed: boolean
  expiration_date: string | null
  notes: string | null
  parent: MaterialBrief | null
  offspring: MaterialBrief[]
  process_events: { process_event_id: number; process_code: string; process_type: string; status: string; operator_name: string | null }[]
  assays: { assay_id: number; assay_code: string; assay_type: string; target: string | null; status: string; qc_status: string }[]
  storage_events: { storage_event_id: number; event_type: string; event_date: string; from_location_id: number | null; to_location_id: number | null; from_location_code: string | null; from_location_name: string | null; to_location_code: string | null; to_location_name: string | null; operator_name: string | null }[]
  quantity_events: { quantity_event_id: number; event_type: string; quantity_change: string; quantity_unit: string; quantity_before: string | null; quantity_after: string | null; event_date: string; operator_name: string | null; notes: string | null }[]
}

export type StorageLocation = { storage_location_id: number; parent_location_id: number | null; location_code: string; location_type: string; location_name: string | null; is_active: boolean }

export type AssayDetail = {
  assay_id: number
  assay_code: string
  assay_name: string
  assay_type: string
  target: string | null
  material: MaterialBrief
  operator_name: string | null
  assay_date: string | null
  status: string
  qc_status: string
  notes: string | null
  results: AssayResult[]
}

export type AssayBrief = Omit<AssayDetail, 'notes' | 'results'>

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

export type MaterialLineageNode = {
  material_id: number
  material_code: string
  material_type: string
  status: string
  generated_by_process: {
    process_event_id: number
    process_code: string
    process_type: string
    status: string
    operator_name: string | null
    input_materials: MaterialBrief[]
  } | null
  assays: { assay_id: number; assay_code: string; assay_type: string; target: string | null; status: string; qc_status: string }[]
  children: MaterialLineageNode[]
}

export type SampleLineage = {
  sample: SampleBrief
  materials: MaterialLineageNode[]
}

export type SampleDetail = SampleBrief & {
  external_sample_id: string | null
  source_type: string | null
  source_description: string | null
  collection_date: string | null
  received_date: string | null
  notes: string | null
  batch: BatchBrief | null
  parent: SampleBrief | null
  offspring: SampleBrief[]
  materials: MaterialBrief[]
}
