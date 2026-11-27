# Phase 7L — Sổ bằng chứng nghiệm thu / Bước 117

Ngày tạo: 2026-11-27. PR: #36, base `feature/staging-demo-quiz-pilot`.
**Không có kiểm thử live nào được thực hiện bằng tài liệu này.**
Không ghi token, cookie, UID, đáp án, bản sao database, hoặc dữ liệu cá nhân.

## 1. Bằng chứng hiện có (không suy diễn)

| Mục | Tình trạng | Bằng chứng / giới hạn |
| --- | --- | --- |
| PR #35 | VERIFIED MERGED | GitHub PR #35, merged_at 2026-11-27T08:43:08Z |
| PR #36 | OPEN / DRAFT | GitHub PR #36, thêm checklist; chưa gộp |
| Bài test giả lập mất mạng | SOURCE PRESENT, NOT EXECUTED HERE | `tests/phase7k-offline-start-submit-browser.test.ts` đã có trong Staging; mô phỏng start/submit thất lạc response, read D1, UID và deadline |
| CI trên HEAD PR #36 | UNVERIFIED | Lúc kiểm tra, GitHub API trả về 0 combined status checks và 0 PR-triggered workflow runs; **không đồng nghĩa PASS hoặc FAIL** |
| Kiểm thử vật lý iPhone/PC | NOT RUN | Chưa xác nhận trên hai thiết bị thật |
| Cloudflare Access Preview | BLOCKED / UNVERIFIED | Cần bằng chứng chính sách và enforcement của operator trước live |
| AUTH_DB_PREVIEW / secrets | BLOCKED / UNVERIFIED | Không thể suy ra D1 binding chỉ từ mã nguồn hoặc check build |
| Backup + restore Preview D1 | BLOCKED / UNVERIFIED | Cần backup và rehearsal riêng trong môi trường cô lập |
| Phase 6 flags | KEEP OFF | Không yêu cầu đổi cấu hình trên Dashboard |
| Website main / Production | UNCHANGED BY PR #36 | Không có thao tác triển khai production trong bước này |

## 2. Phiếu kết quả khi được phép nghiệm thu

Điền `PASS`, `FAIL` hoặc `BLOCKED` **chỉ sau khi tự thực hiện trên môi trường được cấp quyền**.
Ghi tối đa: thời gian, hostname Preview, commit SHA, loại thiết bị, mã lỗi không nhạy cảm và quan sát thực tế.

| ID | Kịch bản | Kết quả | Ghi chú không nhạy cảm |
| --- | --- | --- | --- |
| L01 | Mất response sau start, đọc lại đúng session/deadline | BLOCKED | Chờ đủ điều kiện trước live |
| L02 | PWA offline fallback, không khôi phục đáp án chưa nộp | BLOCKED | Chờ đủ điều kiện trước live |
| L03 | Submit đã commit, mất response, đọc lại điểm D1 | BLOCKED | Chờ đủ điều kiện trước live |
| L04 | Submit chưa commit, đọc null, chỉ nộp thủ công khi còn giờ | BLOCKED | Chờ đủ điều kiện trước live |
| L05 | Từ chối submit sau expiresAt từ server | BLOCKED | Chờ đủ điều kiện trước live |
| L06 | PC/iPhone cùng UID, deadline giống nhau | BLOCKED | Chờ đủ điều kiện trước live |
| L07 | UID khác không xem dữ liệu của UID trước | BLOCKED | Chờ đủ điều kiện trước live |
| L08 | Admin tổng hợp trùng bản ghi D1 | BLOCKED | Chờ đủ điều kiện trước live |
| L09 | Offline khi đọc kết quả, không tự nộp lại | BLOCKED | Chờ đủ điều kiện trước live |
| L10 | Reload/đổi tài khoản không hiện dữ liệu UID cũ | BLOCKED | Chờ đủ điều kiện trước live |

## 3. Quy trình kiểm chứng tiếp theo

1. Xác minh CI cho **SHA mới nhất** và xem logs nếu check thất bại. Không suy đoán từ trạng thái trống.
2. Review Cloudflare Access, hostname Preview, `AUTH_DB_PREVIEW`, backup/restore và feature flags với người quản trị.
3. Khi được phê duyệt riêng, chạy test live **chỉ với dữ liệu DEMO giả** trên PC/iPhone và điền từng hàng. Nếu bất kỳ gate nào chưa đạt: dừng.
4. Không gộp PR #36 hoặc bật Phase 6 chỉ vì tài liệu đã đầy đủ.

**Không kiểm thử trực tiếp với B/C/D, không chạy migration, không đổi Firebase/Cloudflare/D1, không bật cờ, không deploy main.**

## 4. Rà soát mã nguồn bảo vệ Preview (27/11/2026)

Đã đọc trực tiếp các tệp trên `feature/staging-demo-quiz-pilot`. Những kết luận sau **chỉ xác nhận thiết kế trong mã**, không chứng minh Cloudflare Dashboard đang cấu hình đúng hoặc API live đã được nghiệm thu.

| Kiểm tra | Kết quả rà soát mã | Nguồn |
| --- | --- | --- |
| D1 Preview tách biệt | SOURCE VERIFIED: hostname Preview chính xác ánh xạ `AUTH_DB_PREVIEW`; nếu thiếu không fallback `AUTH_DB` | `functions/_shared/staging-db-binding.mjs`, `tests/phase4-preview-d1-binding.test.mjs` |
| Hostname allowlist | SOURCE VERIFIED: canonical và branch alias chính xác, Preview cần opt-in riêng | `functions/_shared/phase4-host-guard.mjs`, `tests/phase4-pinned-host.test.mjs` |
| Fail closed với host không hợp lệ | TEST CASES PRESENT, NOT EXECUTED HERE: case HTTPS/host spoof, hash alias, disabled flags | `tests/phase4-pinned-host.test.mjs` |
| Không tự retry submit khi mất mạng | TEST CASES PRESENT, NOT EXECUTED HERE: PC/iPhone, kết quả trên D1 giả, deadline máy chủ | `tests/phase7k-offline-start-submit-browser.test.ts` |
| Cloudflare Access | NOT VERIFIED | Cần mở Dashboard và xem policy/enforcement thực tế |
| Binding và backup D1 trên Cloudflare | NOT VERIFIED | Mã nguồn không chứng minh trạng thái resource live |
| CI PR #36 HEAD `7488bd103d4ef4d3b9ca930e600fab30940adde0` | NO STATUS / NO PR-WORKFLOW RETURNED khi kiểm tra | GitHub API; không suy ra thành công/thất bại |

**Kết luận:** chưa đủ điều kiện chạy nghiệm thu PC/iPhone live hoặc bật Phase 6. Tiếp tục giữ mọi live case BLOCKED và PR Draft.
