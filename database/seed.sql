-- Deterministic development data, shaped like the lab's real workflow but entirely synthetic
-- (subject, specimen and staff names are invented). Loaded only into a fresh database by docker
-- compose; never into an existing one.
--
-- Eight shipping batches of 5-20 root Samples each: paediatric clinic blood and swabs, hospital
-- CSF and serum received as several tubes per subject (aliquot numbers), hospital blood extracts,
-- and mosquito surveillance pools. Many roots go through
--   root -> RNA extraction -> RNA -> reverse transcription -> cDNA -> qPCR execution -> CT result
-- with every volume removal on the quantity ledger. Assays are reusable definitions; each
-- execution is a plate of one batch's Samples, and each Sample in it has one result set: a value,
-- interpretation and QC for each of the assay's result fields (left empty where not read yet).

-- Helpers for this load only (pg_temp functions disappear with the session).
CREATE FUNCTION pg_temp.storage_id(code TEXT) RETURNS BIGINT LANGUAGE sql AS $$
	SELECT storage_location_id FROM storage_locations WHERE location_code = code
$$;

CREATE FUNCTION pg_temp.add_sample(
	p_batch_id BIGINT, p_parent_id BIGINT, p_code TEXT, p_subject TEXT, p_type_code TEXT, p_quantity NUMERIC, p_unit TEXT,
	p_status TEXT, p_storage_code TEXT, p_collected TIMESTAMP, p_received TIMESTAMP, p_aliquot INTEGER, p_external TEXT,
	p_source_type TEXT, p_source_description TEXT, p_label TEXT, p_concentration NUMERIC, p_concentration_unit TEXT,
	p_operator TEXT, p_stored_at TIMESTAMP, p_notes TEXT
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
	new_id BIGINT;
	location_id BIGINT := pg_temp.storage_id(p_storage_code);
BEGIN
	INSERT INTO samples (batch_id, parent_sample_id, sample_code, subject_code, sample_type_id, current_quantity, quantity_unit, status,
		storage_location_id, collection_date, received_date, aliquot_number, external_sample_id, source_type, source_description, label,
		concentration, concentration_unit, notes)
	VALUES (p_batch_id, p_parent_id, p_code, p_subject, (SELECT sample_type_id FROM sample_types WHERE type_code = p_type_code), p_quantity, p_unit, p_status,
		location_id, p_collected, p_received, p_aliquot, p_external, p_source_type, p_source_description, p_label,
		p_concentration, p_concentration_unit, p_notes)
	RETURNING sample_id INTO new_id;
	IF location_id IS NOT NULL THEN
		INSERT INTO storage_events (sample_id, to_location_id, event_type, event_date, operator_name)
		VALUES (new_id, location_id, 'stored', COALESCE(p_stored_at, p_received, TIMESTAMP '2026-01-01'), p_operator);
	END IF;
	RETURN new_id;
END $$;

-- A removal from a Sample, in the Sample's own unit, chained on the ledger.
CREATE FUNCTION pg_temp.remove(p_sample_id BIGINT, p_amount NUMERIC, p_event_type TEXT, p_process_id BIGINT, p_execution_id BIGINT,
	p_operator TEXT, p_at TIMESTAMP, p_notes TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
	before_quantity NUMERIC;
	unit TEXT;
BEGIN
	SELECT current_quantity, quantity_unit INTO before_quantity, unit FROM samples WHERE sample_id = p_sample_id;
	UPDATE samples SET current_quantity = before_quantity - p_amount,
		is_consumed = (before_quantity - p_amount = 0),
		status = CASE WHEN before_quantity - p_amount = 0 THEN 'consumed' ELSE status END
	WHERE sample_id = p_sample_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after,
		related_process_event_id, related_assay_execution_id, event_date, operator_name, notes)
	VALUES (p_sample_id, p_event_type, -p_amount, unit, before_quantity, before_quantity - p_amount, p_process_id, p_execution_id, p_at, p_operator, p_notes);
END $$;

-- A process that takes p_amount (in the input's unit) from one input Sample.
CREATE FUNCTION pg_temp.add_process(p_type_code TEXT, p_code TEXT, p_protocol_code TEXT, p_batch_code TEXT, p_operator TEXT, p_at TIMESTAMP,
	p_input_id BIGINT, p_amount NUMERIC, p_notes TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
	new_id BIGINT;
BEGIN
	INSERT INTO process_events (process_code, process_type_id, protocol_id, batch_code, operator_name, started_at, completed_at, status, notes)
	VALUES (p_code, (SELECT process_type_id FROM process_types WHERE type_code = p_type_code), (SELECT protocol_id FROM protocols WHERE protocol_code = p_protocol_code),
		p_batch_code, p_operator, p_at, p_at + INTERVAL '2 hours', 'completed', p_notes)
	RETURNING process_event_id INTO new_id;
	INSERT INTO process_event_inputs (process_event_id, sample_id, quantity_used, quantity_unit)
	VALUES (new_id, p_input_id, p_amount, (SELECT quantity_unit FROM samples WHERE sample_id = p_input_id));
	PERFORM pg_temp.remove(p_input_id, p_amount, 'consumed', new_id, NULL, p_operator, p_at, p_notes);
	RETURN new_id;
END $$;

CREATE FUNCTION pg_temp.add_output(p_process_id BIGINT, p_sample_id BIGINT) RETURNS VOID LANGUAGE sql AS $$
	INSERT INTO process_event_outputs (process_event_id, sample_id, quantity_generated, quantity_unit)
	SELECT p_process_id, sample_id, current_quantity, quantity_unit FROM samples WHERE sample_id = p_sample_id
$$;

-- Executions are plates: the first Sample for a key (batch and assay) creates the execution, later ones join it.
-- Names follow the application's convention, <assay code>-NNN within each assay.
CREATE TEMP TABLE seed_executions (key TEXT PRIMARY KEY, assay_execution_id BIGINT NOT NULL);

CREATE FUNCTION pg_temp.execution_for(p_key TEXT, p_definition_code TEXT, p_operator TEXT, p_at TIMESTAMP, p_status TEXT, p_qc TEXT,
	p_notes TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
	found_id BIGINT := (SELECT assay_execution_id FROM seed_executions WHERE key = p_key);
	definition_id BIGINT := (SELECT assay_definition_id FROM assay_definitions WHERE assay_code = p_definition_code);
BEGIN
	IF found_id IS NOT NULL THEN
		RETURN found_id;
	END IF;
	INSERT INTO assay_executions (execution_name, assay_definition_id, operator_name, assay_date, status, qc_status, notes)
	VALUES (p_definition_code || '-' || lpad((SELECT COUNT(*) + 1 FROM assay_executions WHERE assay_definition_id = definition_id)::text, 3, '0'),
		definition_id, p_operator, p_at, p_status, p_qc, p_notes)
	RETURNING assay_execution_id INTO found_id;
	INSERT INTO seed_executions VALUES (p_key, found_id);
	RETURN found_id;
END $$;

-- A Sample joins an execution; p_volume (in the Sample's unit) goes on its ledger. A value for the assay's first
-- result field is recorded with it when given (QC follows the plate's review).
CREATE FUNCTION pg_temp.add_to_execution(p_execution_id BIGINT, p_sample_id BIGINT, p_volume NUMERIC, p_numeric NUMERIC, p_text TEXT,
	p_interpretation TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
	execution RECORD;
BEGIN
	SELECT * INTO execution FROM assay_executions WHERE assay_execution_id = p_execution_id;
	INSERT INTO assay_execution_samples (assay_execution_id, sample_id) VALUES (p_execution_id, p_sample_id);
	IF p_volume IS NOT NULL THEN
		PERFORM pg_temp.remove(p_sample_id, p_volume, 'consumed', NULL, p_execution_id, execution.operator_name, execution.assay_date,
			'Used by assay execution ' || execution.execution_name);
	END IF;
	PERFORM pg_temp.add_value(p_execution_id, p_sample_id,
		(SELECT assay_definition_result_id FROM assay_definition_results WHERE assay_definition_id = execution.assay_definition_id ORDER BY sort_order LIMIT 1),
		p_numeric, p_text, p_interpretation);
END $$;

-- One result field's value for a Sample already in the execution. Nothing is stored when there is nothing to store.
CREATE FUNCTION pg_temp.add_value(p_execution_id BIGINT, p_sample_id BIGINT, p_field_id BIGINT, p_numeric NUMERIC, p_text TEXT,
	p_interpretation TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
	IF p_numeric IS NULL AND p_text IS NULL AND p_interpretation IS NULL THEN
		RETURN;
	END IF;
	INSERT INTO assay_execution_results (assay_execution_sample_id, assay_definition_result_id, numeric_value, text_value, interpretation, qc_status)
	SELECT x.assay_execution_sample_id, p_field_id, p_numeric, p_text, p_interpretation,
		CASE WHEN e.qc_status IN ('accepted', 'rejected') THEN e.qc_status ELSE 'not_reviewed' END
	FROM assay_execution_samples x JOIN assay_executions e USING (assay_execution_id)
	WHERE x.assay_execution_id = p_execution_id AND x.sample_id = p_sample_id;
END $$;

CREATE FUNCTION pg_temp.field_id(p_definition_code TEXT, p_analyte TEXT, p_name TEXT) RETURNS BIGINT LANGUAGE sql AS $$
	SELECT r.assay_definition_result_id FROM assay_definition_results r JOIN assay_definitions d USING (assay_definition_id)
	WHERE d.assay_code = p_definition_code AND r.analyte IS NOT DISTINCT FROM p_analyte AND r.result_name = p_name
$$;

-- ----- Reference data -------------------------------------------------------------------------

INSERT INTO sample_types (type_code, type_name, description, sort_order) VALUES
	('blood_rna_shield', 'Blood (RNA shield)', 'Whole blood collected into RNA/DNA Shield', 10),
	('swab_rna_shield', 'Swab (RNA shield)', 'Swab collected into RNA/DNA Shield', 20),
	('serum', 'Serum', NULL, 30),
	('csf', 'CSF', 'Cerebrospinal fluid', 40),
	('whole_blood', 'Whole blood', NULL, 50),
	('mosquito_pool', 'Mosquito pool', 'Homogenised pool of field-collected mosquitoes', 60),
	('rna', 'RNA', 'Extracted RNA', 70),
	('cdna', 'cDNA', 'Reverse-transcribed cDNA', 80);

INSERT INTO process_types (type_code, type_name, description, sort_order) VALUES
	('rna_extraction', 'RNA extraction', 'Extract RNA from a sample', 10),
	('reverse_transcription', 'Reverse transcription', 'Make cDNA from RNA', 20),
	('aliquoting', 'Aliquoting', 'Split a sample into derived aliquots', 30);

INSERT INTO protocols (protocol_code, protocol_name, protocol_version, protocol_type, description, effective_date) VALUES
	('PROT-QRNA', 'Zymo Quick-RNA Viral kit with DNase I', '1.0', 'process', 'Viral RNA extraction with on-column DNase I', DATE '2024-01-15'),
	('PROT-ISCRIPT', 'Bio-Rad iScript cDNA synthesis', '1.0', 'process', 'Reverse transcription, 20 uL reactions', DATE '2024-01-15'),
	('PROT-LACV-QPCR', 'LACV SYBR Green qPCR', '2.1', 'assay', 'Primers LACV-S; 40 cycles; melt curve', DATE '2025-06-01'),
	('PROT-PRNT', 'LACV plaque reduction neutralization', '1.0', 'assay', 'PRNT50 on Vero cells', DATE '2024-03-01');

INSERT INTO storage_locations (location_code, location_type, location_name) VALUES
	('LAB-80-A', 'freezer', 'Lab -80 freezer A'),
	('CORE-80-142', 'freezer', 'Core facility -80, room 142'),
	('P3-80-2', 'freezer', 'BSL-3 -80 freezer 2'),
	('LAB-20-B', 'freezer', 'Lab -20 freezer B');
INSERT INTO storage_locations (parent_location_id, location_code, location_type, location_name) VALUES
	(pg_temp.storage_id('LAB-80-A'), 'RACK-A6', 'rack', 'Rack A6'),
	(pg_temp.storage_id('CORE-80-142'), 'RACK-19', 'rack', 'Rack 19'),
	(pg_temp.storage_id('P3-80-2'), 'RACK-4', 'rack', 'Rack 4'),
	(pg_temp.storage_id('LAB-20-B'), 'SHELF-2', 'shelf', 'Shelf 2');
INSERT INTO storage_locations (parent_location_id, location_code, location_type, location_name) VALUES
	(pg_temp.storage_id('RACK-A6'), 'BOX-148', 'box', 'Box 148 (CSF, serum)'),
	(pg_temp.storage_id('RACK-A6'), 'BOX-149', 'box', 'Box 149 (clinic specimens)'),
	(pg_temp.storage_id('RACK-19'), 'BOX-MQ-01', 'box', 'Mosquito pools 1'),
	(pg_temp.storage_id('RACK-19'), 'BOX-MQ-02', 'box', 'Mosquito pools 2'),
	(pg_temp.storage_id('RACK-4'), 'BOX-RNA-01', 'box', 'RNA box 1'),
	(pg_temp.storage_id('RACK-4'), 'BOX-RNA-02', 'box', 'RNA box 2'),
	(pg_temp.storage_id('SHELF-2'), 'BOX-CDNA-01', 'box', 'cDNA box 1');

INSERT INTO assay_definitions (assay_code, assay_name, assay_type, target, protocol_id, kit, instrument, typical_volume, typical_volume_unit, description,
	is_active) VALUES
	('LACV-QPCR-SYBR', 'LACV qPCR (SYBR Green)', 'qPCR', 'LACV', (SELECT protocol_id FROM protocols WHERE protocol_code = 'PROT-LACV-QPCR'),
		'PowerUp SYBR Green Master Mix (Thermo)', 'QuantStudio 5', 2, 'uL', 'SYBR Green qPCR on cDNA. Report CT, or "not detected" when there is no amplification by cycle 40.', TRUE),
	('LACV-RNASEP-DUPLEX', 'LACV / RNase P duplex RT-qPCR', 'qPCR', 'LACV, RNase P', NULL,
		'TaqPath 1-Step Multiplex Master Mix (Thermo)', 'QuantStudio 5', 5, 'uL', 'One-step probe RT-qPCR on RNA; RNase P confirms human sample input.', TRUE),
	('HRTV-QPCR', 'Heartland virus qPCR', 'qPCR', 'HRTV', NULL,
		'PowerUp SYBR Green Master Mix (Thermo)', 'QuantStudio 5', 2, 'uL', 'SYBR Green qPCR on cDNA.', TRUE),
	('RNA-QUBIT', 'RNA quantification (Qubit HS)', 'Quantification', 'RNA', NULL,
		'Qubit RNA HS Assay Kit', 'Qubit 4', 1, 'uL', NULL, TRUE),
	('LACV-PRNT50', 'LACV PRNT50 neutralization', 'Serology', 'LACV', (SELECT protocol_id FROM protocols WHERE protocol_code = 'PROT-PRNT'),
		NULL, NULL, 50, 'uL', 'Reciprocal serum dilution that reduces plaques by 50%. Report "<10" when below the first dilution.', TRUE),
	('VIRAL-CULTURE', 'Viral culture (Vero E6)', 'Culture', 'LACV', NULL,
		NULL, NULL, 1, 'mL', 'Inoculate Vero E6, observe 7 days for CPE, confirm by qPCR.', TRUE),
	('LACV-QPCR-V1', 'LACV qPCR (original primers)', 'qPCR', 'LACV', NULL,
		'iTaq Universal SYBR Green Supermix', 'CFX96', 2, 'uL', 'Replaced by LACV qPCR (SYBR Green) in June 2025.', FALSE);

INSERT INTO assay_definition_results (assay_definition_id, analyte, result_name, unit, value_type, sort_order)
SELECT d.assay_definition_id, r.analyte, r.result_name, r.unit, r.value_type, r.sort_order
FROM (VALUES
	('LACV-QPCR-SYBR', 'LACV', 'CT', 'cycles', 'either', 0),
	('LACV-RNASEP-DUPLEX', 'LACV', 'CT', 'cycles', 'either', 0),
	('LACV-RNASEP-DUPLEX', 'RNase P', 'CT', 'cycles', 'numeric', 1),
	('HRTV-QPCR', 'HRTV', 'CT', 'cycles', 'either', 0),
	('RNA-QUBIT', 'RNA', 'Concentration', 'ng/uL', 'numeric', 0),
	('LACV-PRNT50', 'LACV', 'PRNT50 titer', NULL, 'either', 0),
	('VIRAL-CULTURE', NULL, 'CPE', NULL, 'text', 0),
	('LACV-QPCR-V1', 'LACV', 'CT', 'cycles', 'either', 0)
) AS r (assay_code, analyte, result_name, unit, value_type, sort_order)
JOIN assay_definitions d ON d.assay_code = r.assay_code;

-- ----- Batches, root Samples and their workflow ----------------------------------------------

DO $$
DECLARE
	staff TEXT[] := ARRAY['A. Rivera', 'J. Chen', 'P. Okafor', 'L. Novak', 'R. Haddad'];
	species TEXT[] := ARRAY['Aedes triseriatus', 'Aedes albopictus', 'Aedes japonicus', 'Culex pipiens'];
	spec RECORD;
	i INTEGER;
	r INTEGER := 0;
	tubes INTEGER;
	subject_number INTEGER;
	batch_id_value BIGINT;
	root_id BIGINT;
	rna_id BIGINT;
	cdna_id BIGINT;
	child_id BIGINT;
	process_id BIGINT;
	execution_id BIGINT;
	root_code TEXT;
	subject TEXT;
	type_code TEXT;
	quantity NUMERIC;
	extraction_volume NUMERIC;
	collected TIMESTAMP;
	received TIMESTAMP;
	worked TIMESTAMP;
	aliquot INTEGER;
	operator TEXT;
	qc TEXT;
	ct NUMERIC;
BEGIN
	FOR spec IN SELECT * FROM (VALUES
		(1, 'PEDS-2026-08', 'Peds clinic, August 2026', 'peds', 12, TIMESTAMP '2026-08-25 10:30', TRUE),
		(2, 'PEDS-2026-09', 'Peds clinic, September 2026', 'peds', 6, TIMESTAMP '2026-09-24 11:00', TRUE),
		(3, 'HOSP-2025-01', 'Hospital CSF and serum, January 2025', 'hospital', 18, TIMESTAMP '2025-01-23 14:00', TRUE),
		(4, 'HOSP-2025-04', 'Hospital blood extracts, April 2025', 'blood', 9, TIMESTAMP '2025-04-09 09:15', TRUE),
		(5, 'MOSQ-2026-W31', 'Mosquito surveillance, week 31', 'mosquito', 15, TIMESTAMP '2026-08-03 08:00', TRUE),
		(6, 'HOSP-2026-02', 'Hospital CSF and serum, February 2026', 'hospital', 5, TIMESTAMP '2026-02-06 13:45', TRUE),
		(7, 'MOSQ-2026-W34', 'Mosquito surveillance, week 34', 'mosquito', 20, TIMESTAMP '2026-08-24 08:00', TRUE),
		(8, 'PEDS-2026-10', 'Peds clinic, October 2026', 'peds', 8, TIMESTAMP '2026-10-27 10:00', FALSE)
	) AS b (batch_number, code, name, kind, size, received_at, worked_up)
	LOOP
		INSERT INTO batches (batch_code, batch_name, description)
		VALUES (spec.code, spec.name, 'Synthetic development batch: ' || spec.size || ' root samples')
		RETURNING batch_id INTO batch_id_value;

		FOR i IN 1..spec.size LOOP
			r := r + 1;
			operator := staff[1 + (r % array_length(staff, 1))];
			received := spec.received_at;
			aliquot := NULL;
			subject := NULL;
			root_code := spec.code || '-' || lpad(i::text, 2, '0');

			IF spec.kind = 'peds' THEN
				-- Each subject gives a blood and a swab specimen on the same visit.
				subject_number := spec.batch_number * 100 + (i + 1) / 2;
				subject := 'DEV-P' || subject_number;
				type_code := CASE WHEN i % 2 = 1 THEN 'blood_rna_shield' ELSE 'swab_rna_shield' END;
				quantity := CASE WHEN i % 2 = 1 THEN 0.1 ELSE 1.5 + (i % 3) * 0.5 END;
				collected := received - ((i % 4) + 1) * INTERVAL '1 day';
				-- The last two subjects of the newest batch are on their way.
				IF NOT spec.worked_up AND i > spec.size - 4 THEN
					received := NULL;
				END IF;
				root_id := pg_temp.add_sample(batch_id_value, NULL, root_code, subject, type_code, quantity, 'mL',
					CASE WHEN received IS NULL THEN 'expected' ELSE 'available' END, CASE WHEN received IS NULL THEN NULL ELSE 'BOX-149' END,
					collected, received, NULL, NULL, 'Peds clinic', NULL, NULL, NULL, NULL, operator, received, NULL);
				extraction_volume := CASE WHEN i % 2 = 1 THEN 0.1 ELSE 0.2 END;
			ELSIF spec.kind = 'hospital' THEN
				-- Subjects arrive as one to three tubes of serum or CSF from one collection: aliquot 1, 2, 3.
				subject_number := spec.batch_number * 100 + (i - 1) / 3;
				subject := 'DEV-H' || subject_number;
				tubes := CASE WHEN subject_number % 4 = 1 THEN 1 ELSE 3 END;
				aliquot := CASE WHEN tubes = 1 THEN NULL ELSE ((i - 1) % 3) + 1 END;
				type_code := CASE WHEN subject_number % 2 = 0 THEN 'serum' ELSE 'csf' END;
				quantity := CASE WHEN aliquot IS NULL OR aliquot = 1 THEN 1.0 ELSE 0.5 END;
				collected := received - (40 + (subject_number % 7) * 23) * INTERVAL '1 day';
				IF tubes = 1 THEN
					-- Separate single-tube collections a few days apart instead.
					collected := collected + ((i - 1) % 3) * INTERVAL '3 days';
				END IF;
				root_id := pg_temp.add_sample(batch_id_value, NULL, root_code, subject, type_code, quantity, 'mL', 'available',
					CASE WHEN type_code = 'csf' THEN 'BOX-148' ELSE 'BOX-149' END, collected, received, aliquot, NULL, 'Hospital', NULL, NULL, NULL, NULL,
					operator, received, NULL);
				extraction_volume := 0.14;
			ELSIF spec.kind = 'blood' THEN
				subject := 'DEV-HB' || lpad(i::text, 3, '0');
				type_code := 'whole_blood';
				collected := TIMESTAMP '2024-03-20' + (i * 9) * INTERVAL '1 day';
				root_id := pg_temp.add_sample(batch_id_value, NULL, root_code, subject, type_code, 0.1, 'mL', 'available', 'BOX-149',
					collected, received, NULL, (900000000 + spec.batch_number * 1000 + i)::text, 'Hospital', 'Manifest box ' || (1 + i % 12), NULL, NULL, NULL,
					operator, received, 'From manifest: extraction #' || i || '. Returned to the sending lab 2025-06-11.');
				extraction_volume := NULL;
			ELSE
				type_code := 'mosquito_pool';
				quantity := 0.8 + (i % 5) * 0.1;
				collected := received - ((i % 3) + 1) * INTERVAL '1 day';
				root_id := pg_temp.add_sample(batch_id_value, NULL, root_code, NULL, type_code, quantity, 'mL', 'available',
					CASE WHEN i % 2 = 0 THEN 'BOX-MQ-02' ELSE 'BOX-MQ-01' END, collected, received, NULL, 'POOL-' || spec.batch_number || '-' || lpad(i::text, 3, '0'),
					'Field collection', 'Site ' || chr(65 + i % 6) || ', gravid trap', species[1 + i % 4] || ', ' || (10 + (i * 7) % 41) || ' females',
					NULL, NULL, operator, received, NULL);
				extraction_volume := 0.14;
			END IF;

			CONTINUE WHEN received IS NULL OR NOT spec.worked_up AND i > 2;

			-- Serum aliquot 1: split off two 100 uL aliquots for collaborators.
			IF type_code = 'serum' AND aliquot = 1 AND subject_number % 3 = 0 THEN
				worked := received + INTERVAL '6 days';
				process_id := pg_temp.add_process('aliquoting', 'ALQ-' || root_code, NULL, spec.code, operator, worked, root_id, 0.2, 'Two 100 uL aliquots');
				FOR tubes IN 1..2 LOOP
					child_id := pg_temp.add_sample(NULL, root_id, root_code || '-A' || lpad(tubes::text, 2, '0'), NULL, 'serum', 100, 'uL', 'available', 'BOX-149',
						NULL, NULL, NULL, NULL, NULL, NULL, CASE WHEN tubes = 1 THEN 'For collaborator shipment' ELSE NULL END, NULL, NULL, operator, worked, NULL);
					PERFORM pg_temp.add_output(process_id, child_id);
				END LOOP;
			END IF;

			-- Serum: neutralization on the first tube.
			IF type_code = 'serum' AND (aliquot IS NULL OR aliquot = 1) THEN
				qc := CASE WHEN received < TIMESTAMP '2026-01-01' THEN 'accepted' ELSE 'not_reviewed' END;
				execution_id := pg_temp.execution_for(spec.code || ':prnt', 'LACV-PRNT50', operator, received + INTERVAL '8 days', 'completed', qc, NULL);
				IF subject_number % 3 = 0 THEN
					PERFORM pg_temp.add_to_execution(execution_id, root_id, 0.05, 40 * (1 + subject_number % 4), NULL, 'positive');
				ELSE
					PERFORM pg_temp.add_to_execution(execution_id, root_id, 0.05, NULL, '<10', 'negative');
				END IF;
			END IF;

			-- CSF tube 2: an attempted viral culture uses the whole tube.
			IF type_code = 'csf' AND aliquot = 2 AND subject_number % 2 = 1 THEN
				execution_id := pg_temp.execution_for(spec.code || ':culture', 'VIRAL-CULTURE', operator, received + INTERVAL '12 days', 'completed', 'accepted', 'Passaged twice');
				PERFORM pg_temp.add_to_execution(execution_id, root_id, 0.5, NULL, 'not observed', 'negative');
			END IF;

			-- Older executions with the retired primer set, kept as history.
			IF spec.code = 'HOSP-2025-01' AND aliquot = 3 AND subject_number % 2 = 1 THEN
				execution_id := pg_temp.execution_for(spec.code || ':v1', 'LACV-QPCR-V1', operator, TIMESTAMP '2025-02-03 15:00', 'completed', 'accepted', 'Run on the original primer set');
				PERFORM pg_temp.add_to_execution(execution_id, root_id, NULL, NULL, 'not detected', 'negative');
			END IF;

			-- Extraction is done on the first tube of a collection; every sixth root is still untouched.
			CONTINUE WHEN extraction_volume IS NULL AND spec.kind <> 'blood';
			CONTINUE WHEN aliquot IS NOT NULL AND aliquot > 1;
			CONTINUE WHEN r % 6 = 0;

			worked := COALESCE(received, collected) + INTERVAL '10 days' + (r % 5) * INTERVAL '1 hour';
			IF spec.kind = 'blood' THEN
				-- These arrived as extracts: the RNA is the root's only derivative and the tube is used up making it.
				extraction_volume := 0.1;
			END IF;
			process_id := pg_temp.add_process('rna_extraction', 'EXT-' || root_code, 'PROT-QRNA', spec.code, operator, worked, root_id, extraction_volume, NULL);
			rna_id := pg_temp.add_sample(NULL, root_id, root_code || '-RNA', NULL, 'rna', 40 + (r % 3) * 10, 'uL', 'available',
				CASE WHEN r % 2 = 0 THEN 'BOX-RNA-02' ELSE 'BOX-RNA-01' END, NULL, NULL, NULL, NULL, NULL, NULL, 'RNA from ' || root_code, NULL, NULL, operator, worked, NULL);
			PERFORM pg_temp.add_output(process_id, rna_id);

			qc := CASE WHEN worked < TIMESTAMP '2026-09-01' THEN 'accepted' ELSE 'not_reviewed' END;

			-- A batch's plates run after all its extractions (worked varies by a few hours) and in the same order as before,
			-- so each Sample's ledger stays in date order.
			IF r % 3 = 0 THEN
				execution_id := pg_temp.execution_for(spec.code || ':qubit', 'RNA-QUBIT', operator, received + INTERVAL '10 days 5 hours', 'completed', qc, NULL);
				PERFORM pg_temp.add_to_execution(execution_id, rna_id, 1, 2.4 + (r % 9) * 2.65, NULL, NULL);
				UPDATE samples SET concentration = 2.4 + (r % 9) * 2.65, concentration_unit = 'ng/uL' WHERE sample_id = rna_id;
			END IF;

			-- Hospital RNA: duplex probe assay on its own plate.
			IF spec.kind IN ('hospital', 'blood') THEN
				execution_id := pg_temp.execution_for(spec.code || ':duplex', 'LACV-RNASEP-DUPLEX', operator, received + INTERVAL '10 days 6 hours', 'completed', qc, NULL);
				IF r % 5 = 2 THEN
					PERFORM pg_temp.add_to_execution(execution_id, rna_id, 5, 33.1 + (r % 4) * 0.7, NULL, 'positive');
				ELSE
					PERFORM pg_temp.add_to_execution(execution_id, rna_id, 5, NULL, 'not detected', 'negative');
				END IF;
				PERFORM pg_temp.add_value(execution_id, rna_id, pg_temp.field_id('LACV-RNASEP-DUPLEX', 'RNase P', 'CT'), 24.2 + (r % 6) * 0.9, NULL, 'detected');
			END IF;

			-- Reverse transcription, then SYBR qPCR on the cDNA.
			process_id := pg_temp.add_process('reverse_transcription', 'RT-' || root_code, 'PROT-ISCRIPT', spec.code, operator, worked + INTERVAL '1 day', rna_id, 10, NULL);
			cdna_id := pg_temp.add_sample(NULL, rna_id, root_code || '-cDNA', NULL, 'cdna', 20, 'uL', 'available', 'BOX-CDNA-01',
				NULL, NULL, NULL, NULL, NULL, NULL, 'cDNA from ' || root_code || '-RNA', NULL, NULL, operator, worked + INTERVAL '1 day', NULL);
			PERFORM pg_temp.add_output(process_id, cdna_id);

			IF r % 11 = 5 THEN
				-- A failed plate, repeated: these Samples are in two executions of the same assay.
				execution_id := pg_temp.execution_for(spec.code || ':qpcr-failed', 'LACV-QPCR-SYBR', operator, received + INTERVAL '12 days 5 hours', 'failed', 'rejected', 'NTC amplified; plate repeated');
				PERFORM pg_temp.add_to_execution(execution_id, cdna_id, 2, 36.8, NULL, 'invalid run');
			END IF;
			execution_id := pg_temp.execution_for(spec.code || ':qpcr', CASE WHEN spec.kind = 'blood' THEN 'HRTV-QPCR' ELSE 'LACV-QPCR-SYBR' END, operator,
				received + INTERVAL '13 days 5 hours', 'completed', qc, NULL);
			IF r % 9 = 4 THEN
				ct := 24 + (r % 10) * 1.1;
				PERFORM pg_temp.add_to_execution(execution_id, cdna_id, 2, ct, NULL, 'positive');
			ELSIF r % 13 = 7 THEN
				-- Results not read off the instrument yet.
				PERFORM pg_temp.add_to_execution(execution_id, cdna_id, 2, NULL, NULL, NULL);
			ELSE
				PERFORM pg_temp.add_to_execution(execution_id, cdna_id, 2, NULL, 'not detected', 'negative');
			END IF;
		END LOOP;
	END LOOP;

	-- One instrument export per qPCR plate.
	INSERT INTO data_files (assay_execution_id, file_type, file_name, file_location, notes)
	SELECT e.assay_execution_id, 'result', lower(e.execution_name) || '.csv', '/data/qpcr/' || lower(e.execution_name) || '.csv', 'Instrument export'
	FROM assay_executions e JOIN assay_definitions d USING (assay_definition_id)
	WHERE d.assay_type = 'qPCR' AND e.status = 'completed' AND d.is_active
	ORDER BY e.assay_execution_id;
END $$;

-- ----- Quantity-accounting examples for the Sample page's availability display ---------------
-- Every quantity change has a ledger row (sample_quantity_events) that chains from the starting quantity.
DO $$
DECLARE
	type_id BIGINT := (SELECT sample_type_id FROM sample_types WHERE type_code = 'serum');
	untouched_id BIGINT;
	one_child_parent_id BIGINT;
	one_child_id BIGINT;
	aliquoted_parent_id BIGINT;
	aliquot_id BIGINT;
	aliquot_process_id BIGINT;
	depleted_id BIGINT;
	dna_id BIGINT;
	aliquot_number INTEGER;
BEGIN
	-- Untouched: 100 of 100 uL.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES ('DEMO-UNTOUCHED', type_id, 'Unused tube', 'available', 100, 'uL', 'Availability example: nothing removed')
	RETURNING sample_id INTO untouched_id;

	-- One child allocation of 20 uL; the child later uses 5 uL of its own 20 uL. The parent stays at 80.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES ('DEMO-ONE-CHILD', type_id, 'Parent with one child', 'available', 80, 'uL', 'Availability example: one child allocation')
	RETURNING sample_id INTO one_child_parent_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, operator_name, notes)
	VALUES (one_child_parent_id, 'allocated', -20, 'uL', 100, 80, 'A. Rivera', 'Taken to create child sample DEMO-ONE-CHILD-A');
	INSERT INTO samples (parent_sample_id, sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES (one_child_parent_id, 'DEMO-ONE-CHILD-A', type_id, 'Partially used child', 'available', 15, 'uL', 'Availability example: child that has itself been used')
	RETURNING sample_id INTO one_child_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, operator_name, notes)
	VALUES (one_child_id, 'consumed', -5, 'uL', 20, 15, 'A. Rivera', 'Used for a quality check');

	-- Three 20 uL aliquots from one 100 uL tube: one aliquoting process removes 60 uL once.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES ('DEMO-ALIQUOTED', type_id, 'Parent with three aliquots', 'available', 40, 'uL', 'Availability example: multiple child allocations')
	RETURNING sample_id INTO aliquoted_parent_id;
	INSERT INTO process_events (process_code, process_type_id, operator_name, started_at, completed_at, status, notes)
	VALUES ('DEMO-ALQ-1', (SELECT process_type_id FROM process_types WHERE type_code = 'aliquoting'), 'A. Rivera', TIMESTAMP '2026-10-01 10:00', TIMESTAMP '2026-10-01 10:30', 'completed', 'Availability example')
	RETURNING process_event_id INTO aliquot_process_id;
	INSERT INTO process_event_inputs (process_event_id, sample_id, quantity_used, quantity_unit)
	VALUES (aliquot_process_id, aliquoted_parent_id, 60, 'uL');
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, related_process_event_id, operator_name, notes)
	VALUES (aliquoted_parent_id, 'consumed', -60, 'uL', 100, 40, aliquot_process_id, 'A. Rivera', 'Three 20 uL aliquots');
	FOR aliquot_number IN 1..3 LOOP
		INSERT INTO samples (parent_sample_id, sample_code, sample_type_id, status, current_quantity, quantity_unit)
		VALUES (aliquoted_parent_id, 'DEMO-ALIQUOTED-' || lpad(aliquot_number::text, 2, '0'), type_id, 'available', 20, 'uL')
		RETURNING sample_id INTO aliquot_id;
		INSERT INTO process_event_outputs (process_event_id, sample_id, quantity_generated, quantity_unit)
		VALUES (aliquot_process_id, aliquot_id, 20, 'uL');
	END LOOP;

	-- Fully used: 0 of 50 uL.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, is_consumed, notes)
	VALUES ('DEMO-DEPLETED', type_id, 'Used up', 'consumed', 0, 'uL', TRUE, 'Availability example: depleted')
	RETURNING sample_id INTO depleted_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, operator_name, notes)
	VALUES (depleted_id, 'consumed', -50, 'uL', 50, 0, 'A. Rivera', 'Used in full');

	-- A mass quantity: 380 of 500 ng.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES ('DEMO-DNA-MASS', (SELECT sample_type_id FROM sample_types WHERE type_code = 'rna'), 'Extracted RNA', 'available', 380, 'ng', 'Availability example: mass units')
	RETURNING sample_id INTO dna_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, operator_name, notes)
	VALUES (dna_id, 'consumed', -120, 'ng', 500, 380, 'A. Rivera', 'Library input');
END $$;
