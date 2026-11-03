import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { SamplesPage } from './pages/SamplesPage'
import { SamplePage } from './pages/SamplePage'
import { NewSamplePage } from './pages/NewSamplePage'
import { NewChildSamplePage } from './pages/NewChildSamplePage'
import { BatchesPage } from './pages/BatchesPage'
import { BatchPage } from './pages/BatchPage'
import { BatchImportConfirmPage } from './pages/BatchImportConfirmPage'
import { NewAliquotPage } from './pages/NewAliquotPage'
import { NewProcessPage } from './pages/NewProcessPage'
import { NewAssayPage } from './pages/NewAssayPage'
import { AssaysPage } from './pages/AssaysPage'
import { AssayDefinitionPage } from './pages/AssayDefinitionPage'
import { AssayDefinitionFormPage } from './pages/AssayDefinitionFormPage'
import { StorageLocationsPage } from './pages/StorageLocationsPage'
import { StorageLocationPage } from './pages/StorageLocationPage'
import { NewStorageLocationPage } from './pages/NewStorageLocationPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/samples" element={<SamplesPage />} />
        <Route path="/samples/new" element={<NewSamplePage />} />
        <Route path="/sample/:id" element={<SamplePage />} />
        <Route path="/sample/:id/children/new" element={<NewChildSamplePage />} />
        <Route path="/sample/:id/aliquots/new" element={<NewAliquotPage />} />
        <Route path="/sample/:id/process/new" element={<NewProcessPage />} />
        <Route path="/sample/:id/assays/new" element={<NewAssayPage />} />
        <Route path="/batches" element={<BatchesPage />} />
        <Route path="/batches/import/confirm" element={<BatchImportConfirmPage />} />
        <Route path="/batch/:id" element={<BatchPage />} />
        <Route path="/materials" element={<Navigate to="/samples" replace />} />
        <Route path="/assays" element={<AssaysPage />} />
        <Route path="/assays/new" element={<AssayDefinitionFormPage />} />
        {/* The assay's workspace: its details, executions, their Samples and results. */}
        <Route path="/assays/:id" element={<AssayDefinitionPage />} />
        <Route path="/storage-locations" element={<StorageLocationsPage />} />
        <Route path="/storage-locations/new" element={<NewStorageLocationPage />} />
        <Route path="/storage-location/:id" element={<StorageLocationPage />} />
        <Route path="*" element={<Navigate to="/batches" replace />} />
      </Route>
    </Routes>
  )
}
