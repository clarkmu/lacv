import type { AssayBrief, AssayDefinition, AssayDetail, BatchBrief, BatchDetail, BatchSampleImportPreview, BatchSampleImportRow, ProcessEventDetail, SampleDetail, SampleLineage, SampleListItem, SampleRef, SampleType, StorageLocation } from './types'

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
    if (Array.isArray(body.detail)) {
      const items = body.detail as { loc?: (string | number)[]; msg: string }[]
      const fieldErrors = Object.fromEntries(items.filter(item => item.loc && item.loc.length > 1).map(item => [String(item.loc!.at(-1)), item.msg.replace(/^Value error, /, '')]))
      return new ApiError(items.map(item => `${item.loc?.slice(1).join('.') || 'request'}: ${item.msg}`).join('; '), fieldErrors)
    }
  } catch {
    // Not JSON; show the raw text.
  }
  return new ApiError(text || response.statusText)
}

const post = <T>(path: string, payload: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(payload) })
const patch = <T>(path: string, payload: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) })

export const api = {
  listBatches: () => request<BatchBrief[]>('/batches'),
  getBatch: (id: string | number) => request<BatchDetail>(`/batches/${id}`),
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
  createSampleAssay: (sampleId: number, payload: Record<string, unknown>) => post<AssayDetail>(`/samples/${sampleId}/assays`, payload),
  attachDataFile: (sampleId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${sampleId}/data-files`, payload),

  listSampleTypes: () => request<SampleType[]>('/sample-types'),
  createSampleType: (payload: { type_name: string }) => post<SampleType>('/sample-types', payload),

  createProcessEvent: (payload: Record<string, unknown>) => post<ProcessEventDetail>('/process-events', payload),

  listAssays: () => request<AssayBrief[]>('/assays'),
  listAssayDefinitions: () => request<AssayDefinition[]>('/assays/definitions'),
  listPerformedBy: () => request<string[]>('/assays/performed-by'),
  getAssay: (id: string | number) => request<AssayDetail>(`/assays/${id}`),
  updateAssay: (id: number, changes: Record<string, unknown>) => patch<AssayDetail>(`/assays/${id}`, changes),
  createAssayResult: (assayId: number, payload: Record<string, unknown>) => post<AssayDetail>(`/assays/${assayId}/results`, payload),
  createAssayOutputSample: (assayId: number, payload: Record<string, unknown>) => post<AssayDetail>(`/assays/${assayId}/output-samples`, payload),

  listStorageLocations: () => request<StorageLocation[]>('/storage-locations'),
  getStorageLocation: (id: string | number) => request<StorageLocation>(`/storage-locations/${id}`),
  createStorageLocation: (payload: Record<string, unknown>) => post<StorageLocation>('/storage-locations', payload),
  updateStorageLocation: (id: number, changes: Record<string, unknown>) => patch<StorageLocation>(`/storage-locations/${id}`, changes),
}
