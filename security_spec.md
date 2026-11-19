# Security Specification — Tin Học Số Lữ Đoàn Tên Lửa 490

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every unmatched document path under `/databases/{database}/documents` is explicitly denied (`allow read, write: if false;`).
2. **Verified Identity Mandate**: All reads and writes require Firebase Authentication with `request.auth.token.email_verified == true`. Unverified emails (even matching the admin address) are rejected.
3. **PII & Credential Isolation (`/managed_accounts`)**: Unit account credentials (`username`, `password`) are isolated in `/managed_accounts/{accountId}` and are strictly restricted to verified administrators (`isAdmin()` / `isBootstrappedAdmin()`). Regular verified users cannot `get`, `list`, `create`, `update`, or `delete` any managed account.
4. **Master Gate & Global Consistency**:
   - A `TopicQuestion` in `/topics/{topicId}/questions/{questionId}` can only exist when its parent `/topics/{topicId}` exists and `data.topicId == topicId`.
   - A `QuizAttempt` in `/attempts/{attemptId}` can only be created when its referenced `/topics/{topicId}` exists.
   - An `HonorEntry` in `/honor_entries/{entryId}` can only be created atomically alongside its paired `/attempts/{entryId}` (`existsAfter`).
5. **Identity Integrity & Immutability**:
   - On `QuizAttempt` and `HonorEntry` creation, `ownerUid` MUST equal `request.auth.uid`.
   - `createdAt`, `id`, `ownerUid`, `topicId`, and `scope` are immutable after creation.
   - Submitted attempts carry terminal `status == 'submitted'` and cannot be altered by regular users after submission (admin-only override for corrections).
6. **Temporal Integrity & Volumetric Bounds**:
   - All `createdAt` fields must equal `request.time` on create; all `updatedAt` fields must equal `request.time` on create and update.
   - Every string, ID, list (`options.size() == 4`), and map (`answers.size() <= 500`) enforces explicit size limits and regex checks (`^[a-zA-Z0-9_\-]+$`).
7. **Secure List Queries**: No `allow list` uses `get()` or `exists()`, and every `allow list` explicitly evaluates `resource.data` (`existing()`).

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unverified Admin Email Spoof**: User with `email: 'nguyenquyduong1611998@gmail.com'`, `email_verified: false` tries to read `/managed_accounts/acc-admin-01`. -> **PERMISSION_DENIED**
2. **Non-Admin Credential Theft**: Regular verified user (`uid: 'user-a'`) attempts `get` or `list` on `/managed_accounts`. -> **PERMISSION_DENIED**
3. **Self-Assigned Admin Escalation**: Regular verified user (`uid: 'user-a'`) attempts to create `/admins/user-a`. -> **PERMISSION_DENIED**
4. **Shadow Field Injection on Topic Create**: Admin attempts to create `/topics/topic-new` with an extra ghost field `{ isFeatured: true }`. -> **PERMISSION_DENIED**
5. **Identity Spoofing on Attempt Create**: Regular verified user (`uid: 'user-a'`) submits `/attempts/att-spoof` with `ownerUid: 'user-b'`. -> **PERMISSION_DENIED**
6. **Orphaned Attempt Write**: User attempts to create `/attempts/att-orphan` referencing non-existent `topicId: 'topic-does-not-exist'`. -> **PERMISSION_DENIED**
7. **Terminal State Tampering**: Regular verified user (`uid: 'user-a'`) attempts to `update` their already-submitted `/attempts/att-1` to change `score10: 10` and `grade: 'Giỏi'`. -> **PERMISSION_DENIED**
8. **ID Poisoning Attack**: User attempts to create `/attempts/<150-char-invalid-id$!>` violating `isValidId()`. -> **PERMISSION_DENIED**
9. **Client Timestamp Forgery**: User attempts to create `/attempts/att-time` with a backdated `createdAt` timestamp instead of `request.time`. -> **PERMISSION_DENIED**
10. **Array Option Poisoning on Question**: Admin attempts to create `/topics/topic-1/questions/q-bad` with `options: ['A', 'B']` (size != 4) or non-string option `[123, 'B', 'C', 'D']`. -> **PERMISSION_DENIED**
11. **Non-Atomic Orphaned Honor Entry**: User attempts to create `/honor_entries/att-fake` without creating `/attempts/att-fake` in the same batch (`existsAfter` fails). -> **PERMISSION_DENIED**
12. **Blanket Query Scraping on Attempts**: Regular verified user (`uid: 'user-a'`) queries `/attempts` without filtering `ownerUid == 'user-a'` (attempting to read another user's attempt). -> **PERMISSION_DENIED**
