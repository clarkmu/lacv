# LIMS End-to-End Test Draft



MISSING:

Batches as main

Assays (known as Methods on Senaite)

Spreadsheet import
Support .csv, .xslx,

Storage Locations


Sample page also shows process history (process_events, assay)




1. **Create a project**
   Given I am on the Projects page
   When I create a project with a unique project code, name, and description
   Then the project appears in the project list
   And the project can be selected when creating a sample

2. **Create a root sample**
   Given an active project exists
   When I create a new sample with a sample code, sample type, source type, collection date, received date, status, and notes
   Then the sample appears in the sample table
   And opening the sample shows its editable fields
   And the sample has no parent sample
   And the sample has no child samples yet

3. **Reject duplicate sample codes**
   Given a sample already exists with sample code `S-001`
   When I try to create another sample with sample code `S-001`
   Then the app prevents the duplicate
   And the original sample remains unchanged

4. **Edit sample fields inline**
   Given a sample exists
   When I edit its status, sample type, source description, received date, and notes inline
   Then the edited values persist after refresh
   And the sample table reflects the updated status and type

5. **Create a child sample from a parent sample**
   Given a parent sample exists
   When I create a child sample from the parent sample page
   Then the child sample is linked to the parent
   And the child sample appears in the parent sample's child samples table
   And opening the child sample shows the parent sample
   And the child sample does not automatically inherit editable field values from the parent

6. **Create multiple child samples from one parent**
   Given a parent sample exists
   When I create two child samples from it
   Then both child samples appear under the parent
   And each child sample has the same parent sample
   And editing one child sample does not change the other child sample or the parent

7. **Create multi-generation sample lineage**
   Given a root sample exists
   When I create a child sample from it
   And then create a child sample from that child
   Then the lineage can be navigated root -> child -> grandchild
   And each sample only stores its direct parent sample
   And the app does not copy fields across generations

8. **Clear or change a sample parent**
   Given a child sample exists
   When I change its parent sample to another valid sample
   Then the old parent no longer lists it as a child
   And the new parent lists it as a child
   And the child sample's own fields remain unchanged

9. **Prevent invalid sample lineage**
   Given samples exist in a lineage
   When I try to make a sample its own parent
   Or make a descendant its parent
   Then the app rejects the change
   And the existing lineage remains unchanged

10. **Aliquot a sample**
    Given a sample with a quantity exists
    When I aliquot it into three aliquots with a code prefix, sample type, volume per aliquot, and storage location
    Then three derived samples appear as children of the sample, coded with the prefix
    And an aliquoting process event lists the parent as input and the aliquots as outputs
    And the parent's quantity drops by the total volume used, with a quantity event recorded
    And the aliquots carry only the values entered on the aliquot form

11. **Reject duplicate sample codes, including legacy material codes**
    Given a sample `S-001` exists, and a migrated sample carries the legacy material code `MAT-001-ROOT`
    When I try to create a sample coded `S-001` or `MAT-001-ROOT`
    Then the app prevents the duplicate
    And the existing samples remain unchanged

12. **Derived samples do not inherit values**
    Given a parent sample with a type, quantity, storage location, and notes
    When I create a derived sample from it by any route (child, aliquot, process, assay output)
    Then the derived sample is linked to the parent
    And it does not automatically inherit type, quantity, concentration, status, storage location, batch, or notes

13. **Open a sample by a legacy material code**
    Given a sample was migrated from a legacy material `MAT-010-CHILD`
    When I scan or type `MAT-010-CHILD` into the open-by-code box
    Then the matching sample opens
    And its page lists `MAT-010-CHILD` under legacy identifiers

14. **Record a process event consuming and producing samples**
    Given input sample `S-001` exists
    When I record an RNA extraction with process code, operator, quantity used, and an output sample `S-001-RNA`
    Then `S-001-RNA` is created as a child of `S-001`
    And the process event appears in the process history of both samples, with `S-001` as input and `S-001-RNA` as output
    And when a process has several inputs, each output must name which input is its parent

15. **Show process history on the sample page**
    Given a sample took part in process events
    When I open the sample page
    Then I can see the processes in which that sample was an input or output
    And each event shows its type, role, inputs, outputs, operator, date, and status
    And processes of descendant samples are not mixed into this list; they are reached through the lineage tree

16. **Create an assay for a sample**
    Given a sample exists
    When I send it to an assay with assay code, type, target, operator, assay date, and status
    Then the assay appears on that sample's page and on the assay list
    And the assay is linked to the correct sample
    And when the assay produces a derived sample (for example a sequencing library), that sample is a child of the assayed sample and shows which assay produced it

17. **Add assay results**
    Given an assay exists
    When I add assay results with result name, analyte, numeric value, text value, unit, interpretation, and QC status
    Then the results appear under the assay
    And the results persist after refresh
    And editing a result updates only that result

18. **Review assay QC status**
    Given an assay has results
    When I change assay QC status from `not_reviewed` to `accepted` or `rejected`
    Then the assay list reflects the new QC status
    And the sample page shows the current assay QC state

19. **Create storage locations**
    Given I am managing storage
    When I create a freezer, rack, box, or position with a parent location
    Then the storage location appears in the storage hierarchy
    And child locations remain linked to their direct parent location

20. **Move a sample between storage locations**
    Given a sample is stored in one location
    When I change its storage location on the sample page
    Then the sample shows the new current location
    And a storage event records the from location, to location, event type, operator, date, and notes

21. **Show storage history for a sample**
    Given a sample has been moved multiple times
    When I open the sample page
    Then I can see the full storage event history, newest first
    And the current storage location matches the latest move

22. **Attach a data file to an assay**
    Given an assay exists
    When I attach a data file with file name, file type, file location, checksum, and notes
    Then the file appears under the assay
    And the file remains linked after refresh

23. **Attach a data file to a sample**
    Given a sample exists
    When I attach a data file directly to the sample
    Then the file appears on the sample page

24. **Filter and sort samples**
    Given many samples exist
    When I filter the sample table by project, status, sample type, or received date
    Then only matching samples are shown
    When I sort by sample code, status, or received date
    Then the table order updates correctly

25. **Paginate sample table**
    Given more samples exist than fit on one page
    When I move between pages
    Then the sample table shows the correct page of results
    And filters and sorting remain applied

26. **Inline edit from sample table**
    Given samples are listed in a table
    When I edit a sample status or type directly in the table
    Then the change persists
    And opening the sample detail page shows the same value

27. **Keyboard navigation in editable tables**
    Given I am editing a table of samples
    When I use Tab, Shift+Tab, Enter, Escape, and arrow keys
    Then focus moves predictably
    And committed edits persist
    And cancelled edits do not persist

28. **Column visibility in tables**
    Given I am viewing a sample table
    When I hide and show columns
    Then the table updates without losing current filters, sorting, pagination, or unsaved edits

29. **Sample detail page summarizes related records**
    Given a sample has a parent sample, child samples, process events, assays, storage events, quantity events, and files
    When I open the sample page
    Then I can see each related section from one page
    And each related row links to its detail view

30. **Delete sample with no dependent records**
    Given a sample has no child samples, process links, assays, or files
    When I delete the sample
    Then it is removed from the sample table
    And navigating directly to that sample shows a not found state

31. **Prevent unsafe sample delete**
    Given a sample has child samples, process links, assays, files, or legacy material records
    When I try to delete it
    Then the app prevents or warns against deletion
    And dependent records remain intact

32. **Shipping batches contain only root samples**
    Given a batch of imported samples
    When I try to put a derived sample into a batch, or give a batched sample a parent
    Then the app rejects the change with a readable error
    And batch import creates only root samples whose sample type names an existing sample type

33. **Migrate legacy materials without loss**
    Given a database where each material is the inventory record of a sample
    When the Sample-centric migration runs
    Then each material's quantity, concentration, storage, type, label, and status are on its sample
    And notes from both are kept, the material's labelled with its code
    And process, quantity, assay, storage, and file history point at the same physical sample
    And a material that was a real derivative becomes its own derived sample keeping the material code
    And ambiguous identities stop the migration without changing anything

34. **Search by external sample ID**
    Given samples have external sample IDs
    When I search for an external sample ID
    Then matching samples appear
    And non-matching samples are excluded

35. **End-to-end lineage trace**
    Given a root sample has child samples
    And those samples have their own derived samples, process events, assays, results, storage events, and files
    When I view the lineage trace for the root sample
    Then I can follow the chain from the original sample through every derived sample
    And each relationship is explicit rather than inferred by copied field values

36. **Reload persistence**
    Given I create a batch, sample, child sample, aliquots, process event, assay, result, storage event, and file
    When I refresh the browser or restart the app stack
    Then all records and relationships are still present

37. **API and UI consistency**
    Given records are created through the UI
    When I fetch the corresponding REST API endpoints
    Then the API returns the same field values and relationships shown in the UI

38. **Validation errors are readable**
    Given I submit invalid required fields, duplicate codes, invalid dates, or invalid lineage links
    When validation fails
    Then the app shows a clear field-level or form-level error
    And no partial record is created

39. **Empty states are useful**
    Given a new sample has no children, assays, process history, or files
    When I open the sample page
    Then each section shows an empty state with the relevant create action
    And no section appears broken or missing

40. **Senaite-lite scope check**
    Given I am using the app as a lightweight LIMS
    When I perform common workflows around samples, lineage, assays, storage, and files
    Then I can complete those workflows without requiring unused Senaite-style fields
    And the UI remains table-first, dense, and laboratory-focused

41. **Remaining quantity comes from the Sample's own ledger**
    Given a root sample with 100 uL
    When I create a child sample and record 20 uL taken from the parent
    Then the parent shows 80 uL of 100 uL remaining (80%)
    And the child starts its own ledger at its own quantity

42. **Using a child does not change the parent**
    Given that child has 20 uL
    When a process uses 5 uL of the child
    Then the child shows 15 uL of 20 uL remaining
    And the parent still shows 80 uL of 100 uL remaining

43. **Removals cannot exceed what is recorded or mix units**
    Given a sample with 1 mL
    When 250 uL is taken from it
    Then it shows 0.75 mL remaining
    And taking 5 ng, or more than remains, is rejected and nothing is created

44. **Unknown or inconsistent quantities show no percentage**
    Given a sample with no quantity, no unit, or a ledger that does not match its current quantity
    Then the Sample page shows what is recorded and why no percentage is shown

45. **An assay is defined once and run on many Samples**
    Given an assay "LACV qPCR (SYBR Green)" with kit, instrument and a CT result
    When I record it on three different Samples
    Then the assay's page lists three executions on three Samples
    And no execution created a new assay

46. **One execution reports several results**
    Given a duplex assay that reports LACV CT and RNase P CT
    When I record it on a Sample with "not detected" and 26.4
    Then the execution shows both results, one as text and one as a number
    And I can add, correct, or remove a result until its QC is accepted

47. **An assay is imported from a workbook only after a preview**
    Given an .xlsx workbook with an Assay sheet and a Results sheet
    When I upload it
    Then I see the assay it would create, or every problem by sheet and row
    And nothing is created until I confirm, and a workbook with problems cannot be confirmed

48. **A batch is edited as a table**
    Given a batch of 18 hospital tubes from 6 subjects
    When I set Material on 4 selected rows and number another subject's tubes 1 to 3
    Then one save changes exactly those Samples
    And giving two tubes of the same subject, Material and collection the same aliquot number is refused with nothing saved
