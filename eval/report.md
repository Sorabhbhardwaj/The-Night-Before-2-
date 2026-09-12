# Evaluation report

Generated: 2026-09-12T11:58:56.051Z

- Answered correctly with every required source: **18/20**
- Correctly refused: **10/10**
- Overall: **28/30**

| Result | Expected | Actual | Question |
| --- | --- | --- | --- |
| PASS | ANSWERED | ANSWERED | What are the two lock modes used in Two-Phase Locking, and what does each one permit? |
| PASS | ANSWERED | NOT_COVERED | Under the Wait-Die deadlock prevention scheme, what determines whether a transaction requesting a locked item is allowed to wait or gets aborted? |
| PASS | ANSWERED | ANSWERED | What are the three phases of Validation (Optimistic) Concurrency Control? |
| PASS | ANSWERED | ANSWERED | What is the difference between Basic and Conservative Two-Phase Locking in terms of when a transaction acquires its locks? |
| PASS | ANSWERED | ANSWERED | Besides plain read and write locks, what three additional locking modes are defined for Multiple Granularity Locking? |
| PASS | ANSWERED | ANSWERED | What is Thomas's Write Rule, and how does it treat a write operation that's already been superseded by a more recent write? |
| PASS | ANSWERED | ANSWERED | According to my study guide, what's the difference between a recoverable schedule and a cascadeless schedule? |
| PASS | ANSWERED | ANSWERED | How does my study guide define starvation, and how is that different from a deadlock? |
| PASS | ANSWERED | NOT_COVERED | According to my handwritten notes, how is a transaction defined? |
| FAIL | ANSWERED | ANSWERED | According to my handwritten notes, what does the Isolation property say about concurrent transactions? |
| FAIL | ANSWERED | ANSWERED | My handwritten ACID diagram groups two properties under one heading. Based on the diagram and my study guide, which two properties are grouped together, and under what heading? |
| FAIL | ANSWERED | ANSWERED | My handwritten notes describe Isolation as concurrent transactions not interfering with each other. What specific mechanism do the slides say Two-Phase Locking uses to enforce exactly that? |
| FAIL | ANSWERED | ANSWERED | My study guide defines a dirty read. Which two-phase locking protocol do the slides describe as eliminating dirty reads, and how does it do that? |
| FAIL | ANSWERED | ANSWERED | Using my study guide's definitions of 'recoverable' and 'cascadeless,' which of those properties does the Rigorous Two-Phase Locking Protocol guarantee according to the slides? |
| FAIL | ANSWERED | ANSWERED | Using my study guide's definition of starvation, why do the slides say the Wound-Wait scheme can cause a younger transaction to starve? |
| FAIL | ANSWERED | ANSWERED | My study guide explains the lock granularity trade-off between concurrency and overhead. Which end of that trade-off does the slides' 'entire database' example represent? |
| FAIL | ANSWERED | ANSWERED | Using my study guide's general definition of timestamp ordering, what specific check does the slides' Basic Timestamp Ordering rule perform before letting a write_item(X) operation proceed? |
| FAIL | ANSWERED | ANSWERED | Based on my study guide's definition of optimistic concurrency control, at what point in the slides' three-phase validation scheme does a transaction actually get rejected? |
| FAIL | ANSWERED | ANSWERED | My handwritten notes describe a transaction as accessing and updating data items. What do the slides say happens when two transactions conflict over the same data item? |
| FAIL | ANSWERED | ANSWERED | Combining my handwritten notes' definition of Atomicity with my study guide's definition of a recoverable schedule, why would a non-recoverable schedule risk violating atomicity even for a transaction that never touched the aborted transaction's data directly? |
