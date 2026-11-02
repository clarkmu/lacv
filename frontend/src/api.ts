import type {
  AssayDefinitionDetail, AssayDefinitionDraft, AssayDefinitionListItem, AssayExecution, AssayExecutionDetail, AssayImportPreview, BatchDetail,
  BatchListItem, BatchSampleImportPreview, BatchSampleImportRow, ProcessEventDetail, SampleDetail, SampleLineage, SampleListItem, SampleRef, SampleType,
  StorageLocation, StorageLocationDetail,
} from './types'

const API = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isMultipart = options?.body instanceof FormData
  const response = await fetch(`${API}${path}`, {
    headers: isMultipart ? options?.headers : { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!response.ok) throw await readError(response)
  if (response.status === 204) return undefined as T
  return response.json()
}

/** An API failure. fieldErrors maps a request field (e.g. "volume_used") to its message, so forms can show it in place. */
export class ApiError extends Error {
  fieldErrors: Record<string, string>

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.fieldErrors = fieldErrors
  }
}

async function readError(response: Response) {
  const text = await response.text()
  try {
    const body = JSON.parse(text)
    if (typeof body.detail === 'string') return new ApiError(body.detail)
    if (body.detail && typeof body.detail.message === 'string') {
      return new ApiError([body.detail.message, ...(body.detail.problems ?? [])].join('. '))
    }
    if (Array.isArray(body.detail)) {
      const items = body.detail as { loc?: (string | number)[]; msg: string }[]
      // Keyed by the field name, and also by its full path (e.g. "changes.2.aliquot_number") for errors about one row of a list.
      const fieldErrors: Record<string, string> = {}
      for (const item of items.filter(item => item.loc && item.loc.length > 1)) {
        const message = item.msg.replace(/^Value error, /, '')
        fieldErrors[String(item.loc!.at(-1))] ??= message
        fieldErrors[item.loc!.slice(1).join('.')] = message
      }
      return new ApiError(items.map(item => `${item.loc?.slice(1).join('.') || 'request'}: ${item.msg}`).join('; '), fieldErrors)
    }
  } catch {
    // Not JSON; show the raw text.
  }
  return new ApiError(text || response.statusText)
}

function formWith(file: File) {
  const body = new FormData()
  body.append('file', file)
  return body
}

const post = <T>(path: string, payload: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(payload) })
const patch = <T>(path: string, payload: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) })

export const api = {
  listBatches: () => request<BatchListItem[]>('/batches'),
  getBatch: (id: string | number) => request<BatchDetail>(`/batches/${id}`),
  updateBatchSamples: (batchId: number, payload: { changes: Record<string, unknown>[]; operator_name?: string | null; change_notes?: string | null }) => patch<BatchDetail>(`/batches/${batchId}/samples`, payload),
  previewSampleBatchImport: (file: File) => { const body = new FormData(); body.append('file', file); return request<BatchSampleImportPreview>('/batches/sample-import/preview', { method: 'POST', headers: {}, body }) },
  createSampleBatch: (payload: { batch_name: string; samples: BatchSampleImportRow[] }) => post<BatchDetail>('/batches/sample-import', payload),

  listSamples: (options: { rootOnly?: boolean } = {}) => request<SampleListItem[]>(options.rootOnly ? '/samples?root_only=true' : '/samples'),
  lookupSample: (code: string) => request<SampleRef>(`/samples/lookup?code=${encodeURIComponent(code)}`),
  getSample: (id: string | number) => request<SampleDetail>(`/samples/${id}`),
  getSampleLineage: (id: string | number) => request<SampleLineage>(`/samples/${id}/lineage`),
  createSample: (payload: Record<string, unknown>) => post<SampleDetail>('/samples', payload),
  createChildSample: (parentId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${parentId}/children`, payload),
  updateSample: (id: number, changes: Record<string, unknown>) => patch<SampleDetail>(`/samples/${id}`, changes),
  deleteSample: (id: number) => request<void>(`/samples/${id}`, { method: 'DELETE' }),
  createAliquots: (sampleId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${sampleId}/aliquots`, payload),
  recordAssayExecution: (sampleId: number, payload: Record<string, unknown>) => post<AssayExecutionDetail>(`/samples/${sampleId}/assay-executions`, payload),
  attachDataFile: (sampleId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${sampleId}/data-files`, payload),

  listSampleTypes: () => request<SampleType[]>('/sample-types'),
  createSampleType: (payload: { type_name: string }) => post<SampleType>('/sample-types', payload),

  createProcessEvent: (payload: Record<string, unknown>) => post<ProcessEventDetail>('/process-events', payload),

  listAssayDefinitions: (options: { activeOnly?: boolean } = {}) => request<AssayDefinitionListItem[]>(options.activeOnly ? '/assay-definitions?active_only=true' : '/assay-definitions'),
  getAssayDefinition: (id: string | number) => request<AssayDefinitionDetail>(`/assay-definitions/${id}`),
  createAssayDefinition: (payload: AssayDefinitionDraft) => post<AssayDefinitionDetail>('/assay-definitions', payload),
  updateAssayDefinition: (id: number, changes: Partial<AssayDefinitionDraft> & { is_active?: boolean }) => patch<AssayDefinitionDetail>(`/assay-definitions/${id}`, changes),
  previewAssayImport: (file: File) => request<AssayImportPreview>('/assay-definitions/import/preview', { method: 'POST', headers: {}, body: formWith(file) }),
  importAssayDefinition: (file: File) => request<AssayDefinitionDetail>('/assay-definitions/import', { method: 'POST', headers: {}, body: formWith(file) }),

  listAssayExecutions: () => request<AssayExecution[]>('/assay-executions'),
  listPerformedBy: () => request<string[]>('/assay-executions/performed-by'),
  getAssayExecution: (id: string | number) => request<AssayExecutionDetail>(`/assay-executions/${id}`),
  updateAssayExecution: (id: number, changes: Record<string, unknown>) => patch<AssayExecutionDetail>(`/assay-executions/${id}`, changes),
  createAssayResult: (executionId: number, payload: Record<string, unknown>) => post<AssayExecutionDetail>(`/assay-executions/${executionId}/results`, payload),
  updateAssayResult: (executionId: number, resultId: number, changes: Record<string, unknown>) => patch<AssayExecutionDetail>(`/assay-executions/${executionId}/results/${resultId}`, changes),
  deleteAssayResult: (executionId: number, resultId: number) => request<AssayExecutionDetail>(`/assay-executions/${executionId}/results/${resultId}`, { method: 'DELETE' }),
  createAssayOutputSample: (executionId: number, payload: Record<string, unknown>) => post<AssayExecutionDetail>(`/assay-executions/${executionId}/output-samples`, payload),

  listStorageLocations: () => request<StorageLocation[]>('/storage-locations'),
  getStorageLocation: (id: string | number) => request<StorageLocationDetail>(`/storage-locations/${id}`),
  createStorageLocation: (payload: Record<string, unknown>) => post<StorageLocation>('/storage-locations', payload),
  updateStorageLocation: (id: number, changes: Record<string, unknown>) => patch<StorageLocation>(`/storage-locations/${id}`, changes),
}
