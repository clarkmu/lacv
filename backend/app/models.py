from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

class Batch(Base):
    __tablename__ = "batches"
    batch_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    batch_code: Mapped[str] = mapped_column(String(50), unique=True)
    batch_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    samples: Mapped[list[Sample]] = relationship(back_populates="batch")

class Sample(Base):
    __tablename__ = "samples"
    sample_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.batch_id"))
    parent_sample_id: Mapped[int | None] = mapped_column(ForeignKey("samples.sample_id"))
    sample_code: Mapped[str] = mapped_column(String(100), unique=True)
    external_sample_id: Mapped[str | None] = mapped_column(String(100))
    sample_type: Mapped[str | None] = mapped_column(String(100))
    source_type: Mapped[str | None] = mapped_column(String(100))
    source_description: Mapped[str | None] = mapped_column(String(255))
    collection_date: Mapped[datetime | None] = mapped_column(DateTime)
    received_date: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50), default="expected")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    batch: Mapped[Batch | None] = relationship(back_populates="samples")
    parent: Mapped[Sample | None] = relationship(remote_side=[sample_id], back_populates="offspring")
    offspring: Mapped[list[Sample]] = relationship(back_populates="parent")
    materials: Mapped[list[Material]] = relationship(back_populates="sample")

class StorageLocation(Base):
    __tablename__ = "storage_locations"
    storage_location_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    location_code: Mapped[str] = mapped_column(String(100))
    location_type: Mapped[str] = mapped_column(String(50))
    location_name: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class MaterialType(Base):
    __tablename__ = "material_types"
    material_type_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type_code: Mapped[str] = mapped_column(String(100), unique=True)
    type_name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column()

class ProcessType(Base):
    __tablename__ = "process_types"
    process_type_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type_code: Mapped[str] = mapped_column(String(100), unique=True)
    type_name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int | None] = mapped_column()

class Protocol(Base):
    __tablename__ = "protocols"
    protocol_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    protocol_code: Mapped[str] = mapped_column(String(100))
    protocol_name: Mapped[str] = mapped_column(String(255))
    protocol_version: Mapped[str] = mapped_column(String(100))

class Material(Base):
    __tablename__ = "materials"
    material_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"))
    parent_material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.material_id"))
    material_code: Mapped[str] = mapped_column(String(120), unique=True)
    material_type_id: Mapped[int] = mapped_column(ForeignKey("material_types.material_type_id"))
    material_subtype: Mapped[str | None] = mapped_column(String(100))
    material_label: Mapped[str | None] = mapped_column(String(255))
    current_quantity: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str | None] = mapped_column(String(50))
    concentration: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    concentration_unit: Mapped[str | None] = mapped_column(String(50))
    storage_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    status: Mapped[str] = mapped_column(String(50), default="available")
    is_consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_disposed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_date: Mapped[datetime | None] = mapped_column(DateTime)
    expiration_date: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    sample: Mapped[Sample] = relationship(back_populates="materials")
    parent: Mapped[Material | None] = relationship(remote_side=[material_id], back_populates="offspring")
    offspring: Mapped[list[Material]] = relationship(back_populates="parent")
    material_type_ref: Mapped[MaterialType] = relationship()
    storage_location: Mapped[StorageLocation | None] = relationship()

    @property
    def material_type(self) -> str:
        return self.material_type_ref.type_name

class ProcessEvent(Base):
    __tablename__ = "process_events"
    process_event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    process_code: Mapped[str] = mapped_column(String(100))
    process_type_id: Mapped[int] = mapped_column(ForeignKey("process_types.process_type_id"))
    protocol_id: Mapped[int | None] = mapped_column(ForeignKey("protocols.protocol_id"))
    batch_code: Mapped[str | None] = mapped_column(String(100))
    operator_name: Mapped[str | None] = mapped_column(String(150))
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

    process_type_ref: Mapped[ProcessType] = relationship()

    @property
    def process_type(self) -> str:
        return self.process_type_ref.type_name

class ProcessEventInput(Base):
    __tablename__ = "process_event_inputs"
    process_event_id: Mapped[int] = mapped_column(ForeignKey("process_events.process_event_id"), primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.material_id"), primary_key=True)
    quantity_used: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

class ProcessEventOutput(Base):
    __tablename__ = "process_event_outputs"
    process_event_id: Mapped[int] = mapped_column(ForeignKey("process_events.process_event_id"), primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.material_id"), primary_key=True)
    quantity_generated: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

class MaterialQuantityEvent(Base):
    __tablename__ = "material_quantity_events"
    quantity_event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.material_id"))
    event_type: Mapped[str] = mapped_column(String(50))
    quantity_change: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str] = mapped_column(String(50))
    quantity_before: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_after: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    related_process_event_id: Mapped[int | None] = mapped_column(ForeignKey("process_events.process_event_id"))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    operator_name: Mapped[str | None] = mapped_column(String(150))
    notes: Mapped[str | None] = mapped_column(Text)

class AssayDefinition(Base):
    __tablename__ = "assay_definitions"
    assay_definition_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_code: Mapped[str] = mapped_column(String(100), unique=True)
    assay_name: Mapped[str] = mapped_column(String(255))
    assay_type: Mapped[str] = mapped_column(String(100))
    target: Mapped[str | None] = mapped_column(String(255))

class AssayRun(Base):
    __tablename__ = "assay_runs"
    assay_run_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_code: Mapped[str] = mapped_column(String(100), unique=True)

class Assay(Base):
    __tablename__ = "assays"
    assay_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_instance_code: Mapped[str] = mapped_column(String(100))
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.material_id"))
    assay_definition_id: Mapped[int] = mapped_column(ForeignKey("assay_definitions.assay_definition_id"))
    assay_run_id: Mapped[int | None] = mapped_column(ForeignKey("assay_runs.assay_run_id"))
    operator_name: Mapped[str | None] = mapped_column(String(150))
    assay_date: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50))
    qc_status: Mapped[str] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

    definition: Mapped[AssayDefinition] = relationship()
    material: Mapped[Material] = relationship()
    results: Mapped[list[AssayResult]] = relationship(back_populates="assay")

class AssayResult(Base):
    __tablename__ = "assay_results"
    assay_result_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_id: Mapped[int] = mapped_column(ForeignKey("assays.assay_id"))
    analyte: Mapped[str | None] = mapped_column(String(255))
    result_name: Mapped[str] = mapped_column(String(255))
    numeric_value: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    text_value: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(String(50))
    interpretation: Mapped[str | None] = mapped_column(String(255))
    qc_status: Mapped[str] = mapped_column(String(50), default="not_reviewed")

    assay: Mapped[Assay] = relationship(back_populates="results")

class StorageEvent(Base):
    __tablename__ = "storage_events"
    storage_event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.material_id"))
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    event_type: Mapped[str] = mapped_column(String(50))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    operator_name: Mapped[str | None] = mapped_column(String(150))
