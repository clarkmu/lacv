import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { SamplesPage } from './pages/SamplesPage'
import { SamplePage } from './pages/SamplePage'
import { NewSamplePage } from './pages/NewSamplePage'
import { NewOffspringPage } from './pages/NewOffspringPage'
import { BatchesPage } from './pages/BatchesPage'
import { BatchPage } from './pages/BatchPage'
import { BatchImportConfirmPage } from './pages/BatchImportConfirmPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { MaterialPage } from './pages/MaterialPage'
import { NewMaterialPage } from './pages/NewMaterialPage'
import { NewMaterialOffspringPage } from './pages/NewMaterialOffspringPage'
import { NewAliquotPage } from './pages/NewAliquotPage'
import { NewProcessPage } from './pages/NewProcessPage'
import { NewAssayPage } from './pages/NewAssayPage'
import { AssaysPage } from './pages/AssaysPage'
import { AssayPage } from './pages/AssayPage'
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
        <Route path="/sample/:id/offspring/new" element={<NewOffspringPage />} />
        <Route path="/batches" element={<BatchesPage />} />
        <Route path="/batches/import/confirm" element={<BatchImportConfirmPage />} />
        <Route path="/batch/:id" element={<BatchPage />} />
        <Route path="/materials" element={<MaterialsPage />} />
        <Route path="/materials/new" element={<NewMaterialPage />} />
        <Route path="/material/:id" element={<MaterialPage />} />
        <Route path="/material/:id/offspring/new" element={<NewMaterialOffspringPage />} />
        <Route path="/material/:id/aliquots/new" element={<NewAliquotPage />} />
        <Route path="/material/:id/process/new" element={<NewProcessPage />} />
        <Route path="/material/:id/assays/new" element={<NewAssayPage />} />
        <Route path="/assays" element={<AssaysPage />} />
        <Route path="/assay/:id" element={<AssayPage />} />
        <Route path="/storage-locations" element={<StorageLocationsPage />} />
        <Route path="/storage-locations/new" element={<NewStorageLocationPage />} />
        <Route path="/storage-location/:id" element={<StorageLocationPage />} />
        <Route path="*" element={<Navigate to="/batches" replace />} />
      </Route>
    </Routes>
  )
}
