from fastapi import FastAPI
from .routers import assays, batches, samples, materials, process_events, storage_locations

app = FastAPI(title="Custom LIMS API", version="0.1.0", root_path="/api")

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(samples.router)
app.include_router(materials.router)
app.include_router(process_events.router)
app.include_router(assays.router)
app.include_router(batches.router)
app.include_router(storage_locations.router)
