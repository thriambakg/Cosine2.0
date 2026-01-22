# SEC Search Timeout Issue Analysis

## Problem Description

When a SEC search Lambda times out (e.g., at page 44/48), the job remains stuck in `IN_PROGRESS` status and doesn't get picked up by another Lambda invocation to continue from where it left off.

## Root Cause

1. **No Resume Logic**: The `process_async_search` function always starts from page 1, regardless of whether the job already exists in `IN_PROGRESS` status.

2. **No Intermediate Result Storage**: Intermediate results (`all_results`) are only stored in memory. When the Lambda times out, these results are lost.

3. **No Timeout Detection**: There's no mechanism to detect that a job has been stuck in `IN_PROGRESS` for too long (indicating a timeout).

4. **No Automatic Retry**: AWS Lambda doesn't automatically retry async invocations when they timeout. When a Lambda times out, the async invocation is considered "failed" from AWS's perspective, but the job status in DynamoDB remains `IN_PROGRESS`.

## Current Flow (Problematic)

1. User starts search → `handle_search` creates job and invokes `process_async_search` asynchronously
2. `process_async_search` starts from page 1, processes pages sequentially
3. Lambda times out at page 44/48
4. Job status in DynamoDB shows `IN_PROGRESS` with progress at page 44/48
5. Intermediate results are lost (they were only in memory)
6. User runs search again → `handle_search` finds existing job, returns job_id (job is stuck)

## Proposed Solutions

### Option 1: Simple Timeout Detection (Recommended for Quick Fix)

When `process_async_search` is called:
- Check if job is already `IN_PROGRESS`
- If yes, check `updated_at` timestamp
- If job has been `IN_PROGRESS` for > 15 minutes (Lambda timeout is typically 15 min), mark as `FAILED` and start fresh
- This allows the user to retry the search

**Pros**: Simple, quick to implement
**Cons**: Doesn't preserve progress, user has to start over

### Option 2: Intermediate Result Storage (Recommended for Full Fix)

Store intermediate results periodically (e.g., every 10-20 pages) in S3:
- When `process_async_search` is called, check if job is `IN_PROGRESS`
- If yes, load intermediate results from S3 and resume from last completed page + 1
- Store intermediate results in S3 periodically during processing
- When resuming, merge with existing results

**Pros**: Preserves progress, allows true resumption
**Cons**: More complex, requires S3 storage, adds latency

### Option 3: Hybrid Approach

Combine Option 1 and Option 2:
- Store intermediate results periodically
- Detect timeout and resume automatically
- Fall back to Option 1 if resume fails

## Recommendation

For immediate fix: Implement Option 1 to unblock users
For long-term fix: Implement Option 2 for better user experience









