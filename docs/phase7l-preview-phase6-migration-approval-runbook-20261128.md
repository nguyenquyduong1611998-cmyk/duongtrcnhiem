# Bước 177 — Runbook phê duyệt migration Phase 6 cho D1 Preview (chưa triển khai)

Ngày rà soát: 28/11/2026. Hồ sơ PR #36 (Draft); mã Staging tại HEAD gộp PR35 (`75f2d814b0ef70b5a4ae7118885cd2e0548e69a8`). **Chưa áp dụng Phase 6 trên Cloudflare Preview, chưa bật API flags.**

## I. Phạm vi, dữ liệu và bằng chứng đã có

- **Đích duy nhất sau khi được phê duyệt:** D1 `duongtrcnhiem-auth-preview`, Pages Preview binding `AUTH_DB_PREVIEW`; không nhầm `duongtrcnhiem-auth-staging`, `duongtrcnhiem-restore-test`, `duongtrcnhiem-restore-20261128`, Pages Production hay `main`.
- **Baseline trực tiếp D1 Preview Bước 166:** 8 bảng ứng dụng, 14 hàng: `demo_students=5, login_attempts=0, synthetic_graded_attempts=3, phase5_content_topics=1, phase5_content_versions=1, phase5_content_questions=1, phase5_content_answer_keys=1, phase5_content_attempts=2`. Bước 165 truy vấn 0 bảng `phase6_%`.
- **Backup mới:** `preview-backup-20261128-prephase6.sql`, 12.145 bytes, SHA-256 do operator kiểm tra cục bộ. Operator đã xác nhận 5 account/14 rows chỉ là DEMO được quyền nhân bản. Backup đã import thành công lên **D1 mới, cô lập** `duongtrcnhiem-restore-20261128`: 8/8 bảng khớp số hàng, `PRAGMA quick_check = ok`, `PRAGMA foreign_key_check = 0` (Bước 171–176). Không lưu SQL/password hash/UID/tokens trong repository.
- **Thử migration trên bản backup 28/11 tại SQLite RAM:** 8 bảng gốc `UNCHANGED` (hash dữ liệu), đủ 5 bảng và 12 trigger Phase6, `integrity_check = ok`, `foreign_key_check = 0` (Bước 170). Trên `restore-test` đã xác nhận 5 bảng Phase 6 và 12 trigger. Không coi SQLite/D1 lab PASS là tự động cho phép triển khai vào D1 Preview.
- **Flags:** operator xác nhận chưa cấu hình `PHASE6_STUDENT_TIMED_EXAM_ENABLED`, `PHASE6_RESULTS_READONLY_ENABLED`, `PHASE6_ADMIN_RESULTS_ENABLED` trên Pages Preview. Giữ OFF trong suốt migration. Cờ `VITE_PHASE6F_PWA_PREVIEW_UI=true` là PWA UI build-time, không bật API Phase6.

## II. Rà soát chính xác các migration tại Staging PR35

| Thứ tự | File SQL | Tác động lược đồ | Điều kiện phụ thuộc |
| --- | --- | --- | --- |
| 1 | `serverless/d1-phase6b-synthetic-admin-drafts-draft.sql` | 2 bảng `phase6_admin_drafts`, `phase6_admin_draft_events`; 1 index, 3 audit triggers | Không tham chiếu bảng cũ; giới hạn minutes 1–240, dữ liệu toán giả |
| 2 | `serverless/d1-phase6c-publication-metadata-draft.sql` | 1 bảng `phase6_admin_publications`; 1 index, 3 triggers | FK `(draft_id,revision)` đến `phase5_content_versions`; yêu cầu bản published |
| 3 | `serverless/d1-phase6-timed-sessions-draft.sql` | 1 bảng `phase6_exam_sessions`; 1 index, 3 triggers | FK đến Phase5 versions; số câu/giới hạn thời gian phải khớp bản published, DB clock |
| 4 | `serverless/d1-phase6d-timed-submissions-draft.sql` | 1 bảng `phase6_exam_submissions`; 1 index, 3 triggers | FK tới 6A sessions và Phase5 versions; trigger tham chiếu 6C publications và `demo_students.active=1` |

Các file được rà soát tại GitHub: chỉ `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`, không có DML thay đổi bảng Phase4/5. Trigger 6B có `INSERT` trong thân trigger để ghi log khi có thao tác Admin, không phải seed dữ liệu chạy lúc migration. Đã chứng minh tính cộng thêm **trong bài thử cục bộ**, chưa xác nhận chính sách thao tác từ xa hoặc hiệu ứng từ request đồng thời. `IF NOT EXISTS` **không xác thực đúng cấu trúc khi tên đối tượng đã tồn tại**; nếu thấy tạo dở, không tự chạy lại toàn bộ file.

**Các điểm cần review cuối trước khi ghi từ xa:**
- D1 Preview hiện không có `phase6_%` tables; so sánh toàn bộ 8 bảng và `sqlite_master` với baseline trước khi bắt đầu.
- Đối chiếu SHA/nhánh của 4 file SQL và stop nếu mã thay đổi so với bản đã rà soát.
- Lúc migration **không có phiên thi thật hoặc tác vụ ghi dữ liệu**; một tài khoản có thể vẫn dùng API Phase5 demo trên Pages Preview nên chọn thời điểm không hoạt động.
- D1 `foreign_keys` mặc định được thực thi; không tùy tiện disable. DDL tạo schema với `IF NOT EXISTS` có thể phát sinh trạng thái một phần khi file gặp lỗi; mỗi file phải có hậu kiểm ngay.
- Chưa chạy kiểm thử D1 remote đầy đủ phiên thi/đọc điểm A/B/Admin, stale JWT, mất mạng, thiết bị, hạn mức 30/60/100, và chưa có phê duyệt sử dụng dữ liệu thật.

## III. Phương án an toàn và rollback

**Trước khi chạy remote migration (CHƯA THỰC HIỆN):**
1. D1 Preview binding và database Name/ID xác nhận lại qua Dashboard/CLI; không gửi UUID/secret vào PR.
2. Đảm bảo backup 28/11 còn phù hợp thời điểm triển khai; nếu dữ liệu đổi, phải export mới, bảo quản offline và kiểm chứng. Bản backup đã qua kiểm tra khôi phục D1 độc lập ngày 28/11.
3. Kiểm tra Time Travel **chỉ đọc**: `npx wrangler d1 time-travel info duongtrcnhiem-auth-preview`. Lưu bookmark ở hồ sơ vận hành riêng, không yêu cầu công bố nguyên bookmark. Cloudflare D1 hỗ trợ Time Travel mặc định, **7 ngày Free / 30 ngày Paid**, theo https://developers.cloudflare.com/d1/reference/time-travel/. Nếu không hỗ trợ hoặc không trả bookmark hợp lệ: STOP.
4. Được chủ database phê duyệt rõ **tên target, phạm vi DEMO, 4 file đúng thứ tự, khoảng thời gian, người chịu trách nhiệm, và tiêu chí hậu kiểm**. Đây là gate riêng sau Bước 177.
5. Nếu phê duyệt: chạy mỗi file SQL **một lần**, theo thứ tự 6B → 6C → 6A → 6D, chỉ trên target Preview. Sau **mỗi** file: query metadata các object mới, check lỗi, ghi nhận kết quả; không chạy tiếp nếu bất thường. Không dùng `--yes`.

**Sau mỗi file / toàn bộ (CHƯA THỰC HIỆN):**
- Bảng Phase 6 phải lần lượt là 2 → 3 → 4 → 5 và trigger Phase6 là 3 → 6 → 9 → 12; nếu không khớp, dừng.
- 8 bảng cũ phải còn đủ; 8 row counts theo baseline tại thời điểm preflight và `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0 dòng.
- Thống kê counts chỉ có thể cho thấy số hàng, không thay thế so sánh hashes hoặc quyền người dùng.

**Khi lỗi (CHƯA THỰC HIỆN):**
- DỪNG ngay, không tự động retry file và không xóa bảng/trigger thủ công.
- GIỮ flags API Phase6 OFF, không deploy hay merge PR36.
- Dùng read-only metadata để xác định đối tượng đã tạo dở; xuất snapshot mới của trạng thái lỗi (nếu cần) và lưu log sạch, báo người có quyền.
- Đánh giá tác động của các thay đổi phát sinh sau bookmark. Cloudflare `time-travel restore` **ghi đè tại chỗ và hủy truy vấn đang chạy**; chỉ thực hiện theo phê duyệt khôi phục riêng, không tự động khôi phục từ ChatGPT. Giữ nguyên database phục hồi độc lập trước đó. Tham khảo https://developers.cloudflare.com/d1/reference/time-travel/.
- Không coi tạo bảng trống/rollback là xóa an toàn; giữ nguyên trạng thái cho điều tra và quyết định theo phê duyệt.

## IV. Quyết định gate hiện tại

| Gate | Kết quả |
| --- | --- |
| 4 SQL draft source review ở mức tác động cấu trúc | **REVIEWED** (không thấy DML thay đổi bảng cũ) |
| Backup D1 Preview và restore lên D1 độc lập | **PASS** (counts/integrity/FK) |
| Migration trên backup mới trong RAM | **PASS** (5 tables/12 triggers/data unchanged) |
| D1 Time Travel bookmark hiện tại | **PENDING** |
| Authorization cho SQL draft chạy trên D1 Preview | **NOT GRANTED** |
| Phase6 API flags và signed Preview thực tế | **OFF / NOT TESTED** |
| GO cho thi thật / Production | **NO-GO** |

**Bước tiếp theo duy nhất cần operator:** chạy lệnh `npx wrangler d1 time-travel info duongtrcnhiem-auth-preview` **chỉ đọc**, xác nhận Time Travel hỗ trợ và có bookmark khôi phục. Tuyệt đối không nhầm với `time-travel restore`, không chạy migration hoặc import trên Preview khi chưa phê duyệt. PR36 giữ DRAFT.
