-- Deterministic development data. Each loop creates one linked workflow example:
-- a root sample in a shipping batch, a derived sample produced by a process event,
-- quantity and storage history, and an assay with a result and data file.
DO $$
DECLARE
	item INTEGER;
	batch_id_value BIGINT;
	root_sample_id BIGINT;
	child_sample_id BIGINT;
	process_event_id_value BIGINT;
	assay_id_value BIGINT;
	storage_location_id_value BIGINT;
	sample_type_id_value BIGINT;
	process_type_id_value BIGINT;
	protocol_id_value BIGINT;
	assay_definition_id_value BIGINT;
	assay_run_id_value BIGINT;
	parent_location_id_value BIGINT;
BEGIN
	FOR item IN 1..50 LOOP
		INSERT INTO sample_types (type_code, type_name, description, sort_order)
		VALUES ('sample_type_' || lpad(item::text, 3, '0'), 'Sample type ' || item, 'Seeded sample type', item)
		RETURNING sample_type_id INTO sample_type_id_value;

		INSERT INTO process_types (type_code, type_name, description, sort_order)
		VALUES ('process_type_' || lpad(item::text, 3, '0'), 'Process type ' || item, 'Seeded process type', item)
		RETURNING process_type_id INTO process_type_id_value;

		INSERT INTO protocols (protocol_code, protocol_name, protocol_version, protocol_type, description, effective_date)
		VALUES ('PROT-' || lpad(item::text, 3, '0'), 'Seeded protocol ' || item, '1.0', CASE WHEN item % 2 = 0 THEN 'assay' ELSE 'process' END, 'Seeded protocol', CURRENT_DATE - item)
		RETURNING protocol_id INTO protocol_id_value;

		INSERT INTO batches (batch_code, batch_name, description)
		VALUES ('BATCH-' || lpad(item::text, 3, '0'), 'Seeded batch ' || item, 'Seeded shipping batch')
		RETURNING batch_id INTO batch_id_value;

		IF item <= 5 THEN
			INSERT INTO storage_locations (location_code, location_type, location_name, description)
			VALUES ('FREEZER-' || lpad(item::text, 2, '0'), 'freezer', 'Seeded freezer ' || item, 'Seeded parent storage location')
			RETURNING storage_location_id INTO storage_location_id_value;
		ELSE
			SELECT storage_location_id INTO parent_location_id_value
			FROM storage_locations
			WHERE location_code = 'FREEZER-' || lpad((((item - 6) % 5) + 1)::text, 2, '0');
			INSERT INTO storage_locations (parent_location_id, location_code, location_type, location_name, description)
			VALUES (parent_location_id_value, 'BOX-' || lpad(item::text, 3, '0'), 'box', 'Seeded box ' || item, 'Seeded child storage location')
			RETURNING storage_location_id INTO storage_location_id_value;
		END IF;

		-- Only root samples belong to a shipping batch.
		INSERT INTO samples (batch_id, sample_code, sample_type_id, label, source_type, source_description, collection_date, received_date, status,
			current_quantity, quantity_unit, concentration, concentration_unit, storage_location_id, notes)
		VALUES (batch_id_value, 'SAMPLE-' || lpad(item::text, 3, '0') || '-ROOT', sample_type_id_value, 'Root sample ' || item, 'Seed source', 'Root sample ' || item,
			CURRENT_TIMESTAMP - (item || ' days')::interval, CURRENT_TIMESTAMP - (item || ' days')::interval, 'available',
			50, 'uL', 10, 'ng/uL', storage_location_id_value, 'Seeded root')
		RETURNING sample_id INTO root_sample_id;

		INSERT INTO samples (parent_sample_id, sample_code, sample_type_id, label, source_type, source_description, status,
			current_quantity, quantity_unit, concentration, concentration_unit, storage_location_id, notes)
		VALUES (root_sample_id, 'SAMPLE-' || lpad(item::text, 3, '0') || '-CHILD', sample_type_id_value, 'Child sample ' || item, 'Seed workflow', 'Child sample ' || item, 'available',
			50, 'uL', 5, 'ng/uL', storage_location_id_value, 'Seeded child')
		RETURNING sample_id INTO child_sample_id;

		INSERT INTO process_events (process_code, process_type_id, protocol_id, batch_code, operator_name, started_at, completed_at, status, notes)
		VALUES ('PROCESS-' || lpad(item::text, 3, '0'), process_type_id_value, protocol_id_value, 'BATCH-' || lpad(item::text, 3, '0'), 'Seed Operator ' || item, CURRENT_TIMESTAMP - (item || ' hours')::interval, CURRENT_TIMESTAMP - ((item - 1) || ' hours')::interval, 'completed', 'Seeded transformation')
		RETURNING process_event_id INTO process_event_id_value;

		INSERT INTO process_event_inputs (process_event_id, sample_id, quantity_used, quantity_unit, notes)
		VALUES (process_event_id_value, root_sample_id, 50, 'uL', 'Seeded input');
		INSERT INTO process_event_outputs (process_event_id, sample_id, quantity_generated, quantity_unit, notes)
		VALUES (process_event_id_value, child_sample_id, 50, 'uL', 'Seeded output');
		INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, related_process_event_id, operator_name, notes)
		VALUES (root_sample_id, 'consumed', -50, 'uL', 100, 50, process_event_id_value, 'Seed Operator ' || item, 'Seeded quantity change');

		INSERT INTO storage_events (sample_id, to_location_id, event_type, operator_name, notes)
		VALUES (root_sample_id, storage_location_id_value, 'stored', 'Seed Operator ' || item, 'Seeded storage event'),
			(child_sample_id, storage_location_id_value, 'stored', 'Seed Operator ' || item, 'Seeded storage event');

		INSERT INTO assay_definitions (assay_code, assay_name, assay_type, target, protocol_id, description)
		VALUES ('ASSAY-DEF-' || lpad(item::text, 3, '0'), 'Seeded assay definition ' || item, 'screening', 'Target ' || item, protocol_id_value, 'Seeded definition')
		RETURNING assay_definition_id INTO assay_definition_id_value;
		INSERT INTO assay_runs (run_code, run_type, instrument, platform, operator_name, status, notes)
		VALUES ('RUN-' || lpad(item::text, 3, '0'), 'screening', 'Instrument ' || item, 'Platform ' || item, 'Seed Operator ' || item, 'completed', 'Seeded run')
		RETURNING assay_run_id INTO assay_run_id_value;
		INSERT INTO assays (assay_instance_code, sample_id, assay_definition_id, assay_run_id, operator_name, assay_date, status, qc_status, notes)
		VALUES ('ASSAY-' || lpad(item::text, 3, '0'), child_sample_id, assay_definition_id_value, assay_run_id_value, 'Seed Operator ' || item, CURRENT_TIMESTAMP, 'completed', CASE WHEN item % 2 = 0 THEN 'accepted' ELSE 'not_reviewed' END, 'Seeded assay')
		RETURNING assay_id INTO assay_id_value;
		INSERT INTO assay_results (assay_id, analyte, result_name, numeric_value, text_value, unit, interpretation, qc_status)
		VALUES (assay_id_value, 'Analyte ' || item, 'Result ' || item, item * 1.25, CASE WHEN item % 2 = 0 THEN 'positive' ELSE 'negative' END, 'Ct', 'Seeded result', CASE WHEN item % 2 = 0 THEN 'accepted' ELSE 'not_reviewed' END);
		INSERT INTO data_files (assay_id, sample_id, file_type, file_name, file_location, checksum_sha256, notes)
		VALUES (assay_id_value, child_sample_id, 'result', 'seed-result-' || lpad(item::text, 3, '0') || '.csv', '/seed/data/result-' || item || '.csv', lpad(md5('seed-file-' || item), 64, '0'), 'Seeded file');
	END LOOP;
END $$;

-- Quantity-accounting examples for the Sample page's availability display. Every quantity
-- change has a ledger row (sample_quantity_events) that chains from the starting quantity.
DO $$
DECLARE
	type_id BIGINT := (SELECT sample_type_id FROM sample_types WHERE type_code = 'sample_type_001');
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
	VALUES (one_child_parent_id, 'allocated', -20, 'uL', 100, 80, 'Seed Operator', 'Taken to create child sample DEMO-ONE-CHILD-A');
	INSERT INTO samples (parent_sample_id, sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES (one_child_parent_id, 'DEMO-ONE-CHILD-A', type_id, 'Partially used child', 'available', 15, 'uL', 'Availability example: child that has itself been used')
	RETURNING sample_id INTO one_child_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, operator_name, notes)
	VALUES (one_child_id, 'consumed', -5, 'uL', 20, 15, 'Seed Operator', 'Used for a quality check');

	-- Three 20 uL aliquots from one 100 uL tube: one aliquoting process removes 60 uL once.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES ('DEMO-ALIQUOTED', type_id, 'Parent with three aliquots', 'available', 40, 'uL', 'Availability example: multiple child allocations')
	RETURNING sample_id INTO aliquoted_parent_id;
	INSERT INTO process_types (type_code, type_name, description, sort_order)
	VALUES ('aliquoting', 'Aliquoting', 'Split a sample into derived aliquots', 0)
	ON CONFLICT (type_code) DO NOTHING;
	INSERT INTO process_events (process_code, process_type_id, operator_name, started_at, completed_at, status, notes)
	VALUES ('DEMO-ALQ-1', (SELECT process_type_id FROM process_types WHERE type_code = 'aliquoting'), 'Seed Operator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'completed', 'Availability example')
	RETURNING process_event_id INTO aliquot_process_id;
	INSERT INTO process_event_inputs (process_event_id, sample_id, quantity_used, quantity_unit)
	VALUES (aliquot_process_id, aliquoted_parent_id, 60, 'uL');
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, related_process_event_id, operator_name, notes)
	VALUES (aliquoted_parent_id, 'consumed', -60, 'uL', 100, 40, aliquot_process_id, 'Seed Operator', 'Three 20 uL aliquots');
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
	VALUES (depleted_id, 'consumed', -50, 'uL', 50, 0, 'Seed Operator', 'Used in full');

	-- A mass quantity: 380 of 500 ng.
	INSERT INTO samples (sample_code, sample_type_id, label, status, current_quantity, quantity_unit, notes)
	VALUES ('DEMO-DNA-MASS', type_id, 'Extracted DNA', 'available', 380, 'ng', 'Availability example: mass units')
	RETURNING sample_id INTO dna_id;
	INSERT INTO sample_quantity_events (sample_id, event_type, quantity_change, quantity_unit, quantity_before, quantity_after, operator_name, notes)
	VALUES (dna_id, 'consumed', -120, 'ng', 500, 380, 'Seed Operator', 'Library input');
END $$;
