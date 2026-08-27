import type { AssayBrief, AssayDetail, BatchBrief, BatchDetail, BatchSampleImportPreview, BatchSampleImportRow, MaterialBrief, MaterialDetail, MaterialTypeBrief, SampleBrief, SampleDetail, SampleLineage, StorageLocation } from './types'

const API = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isMultipart = options?.body instanceof FormData
  const response = await fetch(`${API}${path}`, {
    headers: isMultipart ? options?.headers : { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

export const api = {
  listSamples: () => request<SampleBrief[]>('/samples'),
  listBatches: () => request<BatchBrief[]>('/batches'),
  getBatch: (id: string | number) => request<BatchDetail>(`/batches/${id}`),
  previewSampleBatchImport: (file: File) => { const body = new FormData(); body.append('file', file); return request<BatchSampleImportPreview>('/batches/sample-import/preview', { method: 'POST', headers: {}, body }) },
  createSampleBatch: (payload: { batch_name: string; samples: BatchSampleImportRow[] }) =>
    request<BatchDetail>('/batches/sample-import', { method: 'POST', body: JSON.stringify(payload) }),
  importBatches: (file: File) => { const body = new FormData(); body.append('file', file); return request<BatchBrief[]>('/batches/import', { method: 'POST', headers: {}, body }) },
  listMaterials: () => request<MaterialBrief[]>('/materials'),
  listMaterialTypes: () => request<MaterialTypeBrief[]>('/materials/types'),
  getMaterial: (id: string | number) => request<MaterialDetail>(`/materials/${id}`),
  createMaterial: (payload: Record<string, unknown>) =>
    request<MaterialDetail>('/materials', { method: 'POST', body: JSON.stringify(payload) }),
  createMaterialOffspring: (parentId: number, payload: Record<string, unknown>) =>
    request<MaterialDetail>(`/materials/${parentId}/offspring`, { method: 'POST', body: JSON.stringify(payload) }),
  createMaterialAliquots: (materialId: number, payload: Record<string, unknown>) =>
    request<MaterialDetail>(`/materials/${materialId}/aliquots`, { method: 'POST', body: JSON.stringify(payload) }),
  createProcessEvent: (payload: Record<string, unknown>) =>
    request<MaterialDetail>('/process-events', { method: 'POST', body: JSON.stringify(payload) }),
  updateMaterial: (id: number, patch: Record<string, unknown>) =>
    request<MaterialDetail>(`/materials/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createMaterialAssay: (materialId: number, payload: Record<string, unknown>) =>
    request<MaterialDetail>(`/materials/${materialId}/assays`, { method: 'POST', body: JSON.stringify(payload) }),
  listAssays: () => request<AssayBrief[]>('/assays'),
  getAssay: (id: string | number) => request<AssayDetail>(`/assays/${id}`),
  createAssayResult: (assayId: number, payload: Record<string, unknown>) =>
    request<AssayDetail>(`/assays/${assayId}/results`, { method: 'POST', body: JSON.stringify(payload) }),
  listStorageLocations: () => request<StorageLocation[]>('/storage-locations'),
  getStorageLocation: (id: string | number) => request<StorageLocation>(`/storage-locations/${id}`),
  createStorageLocation: (payload: Record<string, unknown>) =>
    request<StorageLocation>('/storage-locations', { method: 'POST', body: JSON.stringify(payload) }),
  updateStorageLocation: (id: number, patch: Record<string, unknown>) => request<StorageLocation>(`/storage-locations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  getSample: (id: string | number) => request<SampleDetail>(`/samples/${id}`),
  getSampleLineage: (id: string | number) => request<SampleLineage>(`/samples/${id}/lineage`),
  updateSample: (id: number, patch: Record<string, unknown>) =>
    request<SampleDetail>(`/samples/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createSample: (payload: Record<string, unknown>) =>
    request<SampleDetail>('/samples', { method: 'POST', body: JSON.stringify(payload) }),
  createOffspring: (parentId: number, payload: Record<string, unknown>) =>
    request<SampleDetail>(`/samples/${parentId}/offspring`, { method: 'POST', body: JSON.stringify(payload) }),
}
