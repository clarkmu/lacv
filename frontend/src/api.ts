import type { AssayBrief, AssayDetail, BatchBrief, BatchDetail, BatchSampleImportPreview, BatchSampleImportRow, ProcessEventDetail, SampleDetail, SampleLineage, SampleListItem, SampleRef, SampleType, StorageLocation } from './types'

const API = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isMultipart = options?.body instanceof FormData
  const response = await fetch(`${API}${path}`, {
    headers: isMultipart ? options?.headers : { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!response.ok) throw new Error(await readError(response))
  if (response.status === 204) return undefined as T
  return response.json()
}

async function readError(response: Response) {
  const text = await response.text()
  try {
    const body = JSON.parse(text)
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) return body.detail.map((item: { loc?: string[]; msg: string }) => `${item.loc?.slice(1).join('.') || 'request'}: ${item.msg}`).join('; ')
  } catch {
    // Not JSON; show the raw text.
  }
  return text || response.statusText
}

const post = <T>(path: string, payload: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(payload) })
const patch = <T>(path: string, payload: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) })

export const api = {
  listBatches: () => request<BatchBrief[]>('/batches'),
  getBatch: (id: string | number) => request<BatchDetail>(`/batches/${id}`),
  previewSampleBatchImport: (file: File) => { const body = new FormData(); body.append('file', file); return request<BatchSampleImportPreview>('/batches/sample-import/preview', { method: 'POST', headers: {}, body }) },
  createSampleBatch: (payload: { batch_name: string; samples: BatchSampleImportRow[] }) => post<BatchDetail>('/batches/sample-import', payload),

  listSamples: () => request<SampleListItem[]>('/samples'),
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
  getAssay: (id: string | number) => request<AssayDetail>(`/assays/${id}`),
  updateAssay: (id: number, changes: Record<string, unknown>) => patch<AssayDetail>(`/assays/${id}`, changes),
  createAssayResult: (assayId: number, payload: Record<string, unknown>) => post<AssayDetail>(`/assays/${assayId}/results`, payload),
  createAssayOutputSample: (assayId: number, payload: Record<string, unknown>) => post<AssayDetail>(`/assays/${assayId}/output-samples`, payload),

  listStorageLocations: () => request<StorageLocation[]>('/storage-locations'),
  getStorageLocation: (id: string | number) => request<StorageLocation>(`/storage-locations/${id}`),
  createStorageLocation: (payload: Record<string, unknown>) => post<StorageLocation>('/storage-locations', payload),
  updateStorageLocation: (id: number, changes: Record<string, unknown>) => patch<StorageLocation>(`/storage-locations/${id}`, changes),
}
