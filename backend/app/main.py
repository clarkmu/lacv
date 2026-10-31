from fastapi import FastAPI
from .routers import assay_definitions, assay_executions, batches, process_events, sample_types, samples, storage_locations

app = FastAPI(title="LACV API", version="0.1.0", root_path="/api")

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(samples.router)
app.include_router(sample_types.router)
app.include_router(process_events.router)
app.include_router(assay_definitions.router)
app.include_router(assay_executions.router)
app.include_router(batches.router)
app.include_router(storage_locations.router)
