from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
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

class StorageLocation(Base):
    __tablename__ = "storage_locations"
    storage_location_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    location_code: Mapped[str] = mapped_column(String(100))
    location_type: Mapped[str] = mapped_column(String(50))
    location_name: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class SampleType(Base):
    __tablename__ = "sample_types"
    sample_type_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type_code: Mapped[str] = mapped_column(String(100), unique=True)
    type_name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(default=0)

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

class Sample(Base):
    """The single physical identity. Lineage is parent_sample_id only; children inherit nothing."""
    __tablename__ = "samples"
    sample_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.batch_id"))
    parent_sample_id: Mapped[int | None] = mapped_column(ForeignKey("samples.sample_id"))
    sample_code: Mapped[str] = mapped_column(String(100), unique=True)
    external_sample_id: Mapped[str | None] = mapped_column(String(100))
    # The study subject (participant); a plain identifier.
    subject_code: Mapped[str | None] = mapped_column(String(100))
    # Which tube among those received for the same subject, sample type and collection.
    aliquot_number: Mapped[int | None] = mapped_column()
    sample_type_id: Mapped[int | None] = mapped_column(ForeignKey("sample_types.sample_type_id"))
    label: Mapped[str | None] = mapped_column(String(255))
    subtype: Mapped[str | None] = mapped_column(String(100))
    source_type: Mapped[str | None] = mapped_column(String(100))
    source_description: Mapped[str | None] = mapped_column(String(255))
    collection_date: Mapped[datetime | None] = mapped_column(DateTime)
    received_date: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50), default="expected")
    current_quantity: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str | None] = mapped_column(String(50))
    concentration: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    concentration_unit: Mapped[str | None] = mapped_column(String(50))
    storage_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    is_consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_disposed: Mapped[bool] = mapped_column(Boolean, default=False)
    expiration_date: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    batch: Mapped[Batch | None] = relationship(back_populates="samples")
    parent: Mapped[Sample | None] = relationship(remote_side=[sample_id], back_populates="children")
    children: Mapped[list[Sample]] = relationship(back_populates="parent", order_by="Sample.sample_id")
    sample_type_ref: Mapped[SampleType | None] = relationship()
    storage_location: Mapped[StorageLocation | None] = relationship()
    legacy_material_records: Mapped[list[LegacyMaterialRecord]] = relationship(back_populates="sample", order_by="LegacyMaterialRecord.legacy_material_id")

    @property
    def sample_type(self) -> str | None:
        return self.sample_type_ref.type_name if self.sample_type_ref else None

    @property
    def legacy_codes(self) -> list[str]:
        return [record.material_code for record in self.legacy_material_records]

class LegacyMaterialRecord(Base):
    """A row of the retired materials table and the Sample it resolved to."""
    __tablename__ = "legacy_material_records"
    legacy_material_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"))
    material_code: Mapped[str] = mapped_column(String(120), unique=True)
    resolution: Mapped[str] = mapped_column(String(20))
    record: Mapped[dict] = mapped_column(JSONB)
    migrated_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    sample: Mapped[Sample] = relationship(back_populates="legacy_material_records")

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
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"), primary_key=True)
    quantity_used: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

class ProcessEventOutput(Base):
    __tablename__ = "process_event_outputs"
    process_event_id: Mapped[int] = mapped_column(ForeignKey("process_events.process_event_id"), primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"), primary_key=True)
    quantity_generated: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

class SampleQuantityEvent(Base):
    __tablename__ = "sample_quantity_events"
    quantity_event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"))
    event_type: Mapped[str] = mapped_column(String(50))
    quantity_change: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    quantity_unit: Mapped[str] = mapped_column(String(50))
    quantity_before: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    quantity_after: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    related_process_event_id: Mapped[int | None] = mapped_column(ForeignKey("process_events.process_event_id"))
    related_assay_id: Mapped[int | None] = mapped_column(ForeignKey("assays.assay_id"))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    operator_name: Mapped[str | None] = mapped_column(String(150))
    notes: Mapped[str | None] = mapped_column(Text)

class AssayDefinition(Base):
    """A reusable assay procedure. Each Assay row is one execution of it on one Sample."""
    __tablename__ = "assay_definitions"
    assay_definition_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_code: Mapped[str] = mapped_column(String(100), unique=True)
    assay_name: Mapped[str] = mapped_column(String(255))
    assay_type: Mapped[str] = mapped_column(String(100))
    target: Mapped[str | None] = mapped_column(String(255))
    protocol_id: Mapped[int | None] = mapped_column(ForeignKey("protocols.protocol_id"))
    description: Mapped[str | None] = mapped_column(Text)
    kit: Mapped[str | None] = mapped_column(String(255))
    instrument: Mapped[str | None] = mapped_column(String(255))
    typical_volume: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    typical_volume_unit: Mapped[str | None] = mapped_column(String(50))
    source_file_name: Mapped[str | None] = mapped_column(String(255))
    source_sha256: Mapped[str | None] = mapped_column(String(64))
    imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    expected_results: Mapped[list[AssayDefinitionResult]] = relationship(
        back_populates="definition", cascade="all, delete-orphan",
        order_by="(AssayDefinitionResult.sort_order, AssayDefinitionResult.assay_definition_result_id)",
    )

class AssayDefinitionResult(Base):
    """A result an execution of the assay reports, e.g. "CT" for analyte "LACV"."""
    __tablename__ = "assay_definition_results"
    assay_definition_result_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_definition_id: Mapped[int] = mapped_column(ForeignKey("assay_definitions.assay_definition_id"))
    analyte: Mapped[str | None] = mapped_column(String(255))
    result_name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str | None] = mapped_column(String(50))
    # numeric | text | either
    value_type: Mapped[str] = mapped_column(String(20), default="either")
    sort_order: Mapped[int] = mapped_column(default=0)

    definition: Mapped[AssayDefinition] = relationship(back_populates="expected_results")

class AssayRun(Base):
    __tablename__ = "assay_runs"
    assay_run_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_code: Mapped[str] = mapped_column(String(100), unique=True)

class Assay(Base):
    """One execution of an assay definition on one Sample ("assay execution" in the API and UI)."""
    __tablename__ = "assays"
    assay_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_instance_code: Mapped[str] = mapped_column(String(100), unique=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"))
    assay_definition_id: Mapped[int] = mapped_column(ForeignKey("assay_definitions.assay_definition_id"))
    assay_run_id: Mapped[int | None] = mapped_column(ForeignKey("assay_runs.assay_run_id"))
    operator_name: Mapped[str | None] = mapped_column(String(150))
    assay_date: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50))
    qc_status: Mapped[str] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

    definition: Mapped[AssayDefinition] = relationship()
    sample: Mapped[Sample] = relationship()
    results: Mapped[list[AssayResult]] = relationship(back_populates="assay", order_by="AssayResult.assay_result_id")

class AssayOutput(Base):
    """A derived Sample produced by an assay."""
    __tablename__ = "assay_outputs"
    assay_id: Mapped[int] = mapped_column(ForeignKey("assays.assay_id"), primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"), primary_key=True)
    notes: Mapped[str | None] = mapped_column(Text)

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
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.sample_id"))
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("storage_locations.storage_location_id"))
    event_type: Mapped[str] = mapped_column(String(50))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    operator_name: Mapped[str | None] = mapped_column(String(150))
    notes: Mapped[str | None] = mapped_column(Text)

class DataFile(Base):
    __tablename__ = "data_files"
    data_file_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assay_id: Mapped[int | None] = mapped_column(ForeignKey("assays.assay_id"))
    sample_id: Mapped[int | None] = mapped_column(ForeignKey("samples.sample_id"))
    file_type: Mapped[str] = mapped_column(String(50))
    file_name: Mapped[str] = mapped_column(String(255))
    file_location: Mapped[str] = mapped_column(String(1000))
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
