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

## 5. Bằng chứng vận hành do người dùng cung cấp — 27/11/2026

Các kết quả dưới đây là quan sát từ ảnh Cloudflare Dashboard/CMD do người vận hành chia sẻ, **không phải** việc trợ lý truy cập database hoặc thực thi thử nghiệm thay người dùng.

- Cloudflare Access: Preview access hiển thị chính sách hạn chế; policy `Allow Members - Cloudflare Pages` với một rule `Emails` chỉ định một địa chỉ (không ghi email vào tài liệu). Enforcement trực tiếp trên URL Preview vẫn **UNVERIFIED**.
- Pages Preview binding trên Dashboard: `AUTH_DB_PREVIEW → duongtrcnhiem-auth-preview`. Đây là bằng chứng cấu hình giao diện; deployment SHA và runtime binding còn **UNVERIFIED**.
- D1 Preview Dashboard: 8 bảng (2 bảng DEMO căn bản, 5 bảng Phase 5 và `synthetic_graded_attempts`), Time Travel có cửa sổ khôi phục. Các bảng Phase 6 phiên thi riêng chưa được thấy trong ảnh.
- Wrangler đã xuất SQL Preview về máy cục bộ thành công: 12,145 byte; đã tính SHA-256 nhưng **không lưu hash vào tài liệu**. Không tải bản SQL lên GitHub.
- Static inspector `--preview`: `SQL_EXPORT_STRUCTURE_REVIEW_ONLY`; 2 bảng căn bản và synthetic schema có các cột kiểm tra bắt buộc. Tính toàn vẹn và importability ở công cụ static vẫn báo false theo thiết kế.
- Người vận hành chạy Node.js `node:sqlite` trên máy cục bộ (SQLite 3.54.1). Bản export được nạp vào **SQLite :memory:**; kết quả màn hình: `Restore: SUCCESS`, `Integrity: ok`, `Foreign key errors: 0`, `Tables: 8`. Đây là **LOCAL RESTORE SMOKE PASS**, không chứng minh hàng dữ liệu đầy đủ, phục hồi D1 remote, hoặc backup đúng trạng thái live mới nhất.

**Quyết định:** Gate kiểm thử khôi phục SQLite cục bộ được ghi nhận đã đạt ở mức smoke test; gate Cloudflare Access enforcement, tính khớp dữ liệu live, schema Phase 6, backup/restore D1 remote và phê duyệt vận hành vẫn **BLOCKED / UNVERIFIED**. Không bật `PHASE6_*`, không migration, không merge, không đổi Production.

## 6. Bằng chứng operator cung cấp — Bước 134–136

- Bước 134: `node --test tests/phase6f-offline-recovery-100students.test.mjs` trả `pass 2`, `fail 0`, gồm thử nghiệm 100 học viên giả, migrations additive trên bộ dữ liệu tổng hợp cô lập. Không phải load test D1 thật.
- Bước 135: Người vận hành tải export D1 Preview (đã kiểm tra cấu trúc) vào SQLite `:memory:`, áp dụng lần lượt 6B, 6C, 6A, 6D; bốn script đều trả PASS. SQLite báo `Tables before: 8 after: 14`, `Integrity: ok`, `Foreign key errors: 0`. Số 14 có thể gồm bảng nội bộ SQLite; không khẳng định 14 bảng ứng dụng.
- Bước 136: Trên cùng quy trình kiểm thử RAM, người vận hành lấy snapshot số bản ghi và SHA-256 của các dòng cho **8 bảng ứng dụng gốc**, rồi áp dụng bốn SQL dự thảo và so sánh. Cả 8 bảng báo `UNCHANGED`; `Original data preserved: YES`; `Integrity: ok`; `Foreign key errors: 0`.
- Các bằng chứng là ảnh CMD do operator cung cấp, không phải kết quả thực thi trực tiếp của trợ lý. Chưa kiểm chứng tình trạng dữ liệu D1 live hiện tại, test restore D1 remote, Cloudflare Access enforcement, hoặc phê duyệt migration.

**Quyết định:** đánh dấu PASS cho kiểm thử bảo toàn 8 bảng của **bản sao SQLite RAM**. Giữ `deploymentAllowed:false`, PR Draft, mọi cờ Phase 6 OFF; không thực thi draft SQL trên Cloudflare khi chưa có phê duyệt và review chuyên biệt.

## 7. Bước 137–138: Bảng và trigger trên bản sao SQLite RAM

Ảnh CMD do người vận hành cung cấp cho thấy sau khi nạp export D1 Preview vào `:memory:` và áp dụng các SQL Phase 6 **chỉ cục bộ**:

- Bước 137: Có chính xác 5 bảng ứng dụng `phase6_*`: `phase6_admin_draft_events`, `phase6_admin_drafts`, `phase6_admin_publications`, `phase6_exam_sessions`, `phase6_exam_submissions`.
- Bước 138: Có đúng 12 trigger `phase6_*`, gồm 3 trigger admin draft, 3 trigger publication, 3 trigger session và 3 trigger submission.
- Đây là **schema presence checks**, không chứng minh tất cả hành vi bảo vệ trigger; nghiệm thu D1 cloud còn BLOCKED. Không thay đổi dữ liệu live, không bật flags, không merge.

## 8. Bước 139 — Kiểm thử nhật ký Admin Draft

Theo ảnh CMD từ người vận hành ngày 27/11/2026, phép thử độc lập bằng Node.js `node:sqlite` `:memory:` chỉ nạp `serverless/d1-phase6b-synthetic-admin-drafts-draft.sql`; tạo một draft toán giả, cập nhật phút làm bài từ 15 lên 30 và xóa draft. Kết quả:
- `Audit events: create,save,delete`
- `Result: PASS`

Kết luận: các trigger audit cho tạo/sửa/xóa hoạt động đúng thứ tự trên schema giả lập. Đây không phải bằng chứng bảo mật truy cập Admin, không phải kiểm thử với D1 Cloudflare thật; không có dữ liệu thật nào được gửi vào GitHub.

Chưa thay đổi trạng thái Draft hoặc gate triển khai. Vẫn giữ Phase 6 flags OFF và tuyệt đối không tự chạy SQL dự thảo lên D1 Cloudflare.

## 9. Bước 140 — Giới hạn thời lượng bản nháp Admin (operator screenshot)

Người vận hành chạy bài thử Node.js `node:sqlite` trong RAM với duy nhất SQL draft Phase 6B và 4 trường hợp. Kết quả ảnh CMD:

- `Minutes 0: PASS` — giá trị dưới mức được từ chối.
- `Minutes 1: PASS` — giá trị nhỏ nhất được chấp nhận.
- `Minutes 240: PASS` — giá trị lớn nhất được chấp nhận.
- `Minutes 241: PASS` — giá trị trên mức được từ chối.
- `Drafts: 2 Audit events: 2`; `Result: PASS`.

Đây là test ràng buộc cơ sở dữ liệu **đối với draft Admin**, không phải test thời gian của phiên thi live; không kết nối Cloudflare, không sửa file export. Chưa có phê duyệt bật tính năng hay triển khai D1.
