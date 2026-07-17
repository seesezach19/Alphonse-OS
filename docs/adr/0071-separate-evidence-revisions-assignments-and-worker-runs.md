# Separate Evidence Revisions Assignments And Worker Runs

Evidence package revision, Diagnostic Assignment, dispatch, and Diagnostic Worker Run are separate immutable
records. The initial frozen package may create one unclaimed assignment under deployed policy; claim atomically
binds an eligible Passport and launches one isolated run, while retry creates a linked new assignment rather
than returning state to unclaimed. Materially changed packages create reevaluation notices by default, and only
exact policy or governed request launches another worker. Claimed work continues against its original package
unless governed cancellation occurs, and every diagnosis remains historical output of one exact assignment.
