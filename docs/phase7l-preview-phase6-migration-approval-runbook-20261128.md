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

## Bước 178 — Đã xác minh D1 Preview Time Travel (ảnh CMD operator 28/11/2026)

Người vận hành chạy **chỉ đọc** `npx wrangler d1 time-travel info duongtrcnhiem-auth-preview` với Wrangler `4.169.0`, công cụ hiển thị `Resource location: remote`, `Time Traveling...`, một **current bookmark** hợp lệ và gợi ý cú pháp `time-travel restore`. **Không thực thi lệnh restore trong ảnh.**

**Gate `D1_PREVIEW_TIME_TRAVEL_BOOKMARK_AVAILABLE: PASS`**. Giữ bookmark này trong hồ sơ vận hành cục bộ, **không chép chuỗi bookmark hoặc command restore vào GitHub/chat**. Cloudflare lưu ý bookmark có thể thay đổi do maintenance không có thay đổi SQL; trước khi migration phải ghi lại **bookmark mới ngay sát thời điểm triển khai** sau khi ngừng ghi/đối chiếu row counts.

**Rủi ro quan trọng:** `time-travel restore` ghi đè database tại chỗ và hủy request đang chạy. Việc có bookmark không tự cho phép restore hoặc migration. Theo Cloudflare Time Travel docs, bookmark chỉ còn khả dụng trong retention window của gói (Free 7 ngày, Paid 30 ngày). Bản export offline đã khôi phục được vào D1 mới là lớp bảo vệ bổ sung.

**Tình trạng tiến hành:** Đã hoàn tất review bốn SQL, kiểm thử backup RAM và D1 remote độc lập, xác minh D1 Preview binding, API Phase6 flags chưa có, current bookmark truy xuất được. **Gate còn chưa đạt: phê duyệt rõ ràng của chủ DB cho việc thực thi bốn SQL draft trên `duongtrcnhiem-auth-preview`**, kiểm tra preflight dữ liệu/đích tại thời điểm chạy và chọn thời gian ngừng sử dụng Preview. PR36 vẫn Draft, không merge; không chạy remote migration/khôi phục hay bật API từ bước 178.

## Bước 179 — Chọn thử migration trên D1 bản sao khôi phục trước (28/11/2026)

Người vận hành ủy quyền lựa chọn phương án phù hợp thay vì xác nhận riêng việc chạy trên Preview. Quyết định kỹ thuật ưu tiên **thử remote migration trên database D1 bản sao đã khôi phục** `duongtrcnhiem-restore-20261128` trước; **không** chạy trên D1 Preview trong bước này. Đây là D1 đã kiểm tra 8 bảng, 14 hàng, `quick_check: ok`, `foreign_key_check: 0`, và không xuất hiện trong hai Pages bindings đang được sử dụng. Khác với `duongtrcnhiem-restore-test` (đã có 5 bảng Phase6), database `duongtrcnhiem-restore-20261128` là bản mới import, chưa migration Phase6.

**Lý do:** PASS SQLite RAM và bảng/trigger ở D1 lab cũ chưa thay thế thử nghiệm migration với **chính backup mới** trên engine D1 remote. Việc thử ở bản sao này có rủi ro thấp hơn nhiều so với Preview đang kết nối ứng dụng.

**Trình tự bảo đảm (người vận hành thao tác thủ công, không chạy từ ChatGPT):**
1. Xác minh một lần nữa chính xác tên đích `duongtrcnhiem-restore-20261128` trước mỗi lệnh Wrangler. Nếu có bất kỳ dấu hiệu binding vào app hoặc database không còn 8 bảng ban đầu, dừng.
2. **Chỉ áp dụng 6B trước:** `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6b-synthetic-admin-drafts-draft.sql` (chỉ trên lab, không chạy Preview). Đây là **lệnh ghi remote**; đọc tên database và prompt trước xác nhận, không dùng `--yes`.
3. Nếu Wrangler báo thành công, dùng D1 Studio (read-only) kiểm tra tên bảng `phase6_admin_drafts`, `phase6_admin_draft_events` và ba trigger `phase6_admin_draft_created`, `phase6_admin_draft_saved`, `phase6_admin_draft_deleted`; kỳ vọng tổng bảng ứng dụng tăng từ 8 lên 10. Đồng thời `PRAGMA quick_check` và `PRAGMA foreign_key_check` vẫn đạt, row counts gốc giữ nguyên.
4. Nếu có lỗi hoặc kết quả khác kỳ vọng, dừng, không chạy lại file hoặc chuyển sang 6C. Điều tra trạng thái tạo dở; không tự time-travel restore, DELETE hoặc DROP.
5. Sau khi 6B PASS trên clone, xem xét tiếp từng file 6C → 6A → 6D với postflight riêng, **chỉ trên clone** trước khi lập phê duyệt cuối cho Preview.

**Giới hạn và STOP:** không ghi vào `duongtrcnhiem-auth-preview`, `duongtrcnhiem-auth-staging`, `duongtrcnhiem-restore-test`, hoặc Production; không bật `PHASE6_*`; không gộp PR36. Đây là bài rehearsal D1 remote với **dữ liệu DEMO đã được người vận hành xác nhận quyền sao chép**. Chưa coi migration Preview được phê duyệt chỉ từ sự ủy quyền chung.

## Bước 179 — Cloudflare D1 remote lab báo đã execute Phase 6B (ảnh CMD 28/11/2026)

Người vận hành chạy `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6b-synthetic-admin-drafts-draft.sql` theo kế hoạch trên **database clone D1 mới** và cung cấp ảnh phần cuối output của Wrangler:

- `Executed 6 queries in 1.88ms (5 rows read, 11 rows written)`
- `Total queries executed: 6`
- `Rows read: 5`, `Rows written: 11`
- `Database size (MB): 0.14`
- Wrangler trở về CMD prompt, không có lỗi được hiển thị trong ảnh.
- Bookmark D1 hiển thị trong ảnh người vận hành; **không sao chép vào repo**.

**Trạng thái:** `PHASE6B_REMOTE_CLONE_EXECUTION_REPORTED_SUCCESS`, **chưa phải postflight PASS**. Một file Phase 6B đúng dự kiến thực thi 6 DDL (2 tables, 1 index, 3 triggers), nhưng phải xác nhận trực tiếp `sqlite_master` và 8 counts baseline, quick_check và foreign_key_check trên DB clone trước khi tiếp tục 6C.

**Bước 180 (metadata-only):** trên `duongtrcnhiem-restore-20261128` trong D1 Studio:
```sql
SELECT type,name FROM sqlite_master
WHERE type IN ('table','trigger') AND name LIKE 'phase6_%'
ORDER BY type,name;
```
Kỳ vọng 5 dòng: 2 bảng (`phase6_admin_drafts`, `phase6_admin_draft_events`) và 3 trigger (`phase6_admin_draft_created`, `phase6_admin_draft_saved`, `phase6_admin_draft_deleted`). **Chưa chạy 6C hoặc migration trên Preview.**

## Bước 180 — Postflight schema Phase 6B trên D1 bản sao (ảnh operator, 28/11/2026)

Người vận hành vào D1 Studio tại `duongtrcnhiem-restore-20261128`, chạy `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;`; hai ảnh kết quả `sqlite_master · 2×5` cho đúng 5 dòng:
- `table: phase6_admin_draft_events`
- `table: phase6_admin_drafts`
- `trigger: phase6_admin_draft_created`
- `trigger: phase6_admin_draft_deleted`
- `trigger: phase6_admin_draft_saved`

**Gate `REMOTE_CLONE_PHASE6B_SCHEMA_PRESENCE: PASS`**. Đây là bằng chứng tồn tại đối tượng, **chưa chứng minh dữ liệu gốc không bị thay đổi hoặc DB vẫn toàn vẹn sau migration**. Bước kế tiếp: trên đúng clone, đối chiếu 8 row counts `5,0,3,1,1,1,1,2`, `PRAGMA quick_check` = `ok`, `PRAGMA foreign_key_check` = 0. Nếu tất cả đạt mới xét Phase 6C. Chưa chạy migration trên `duongtrcnhiem-auth-preview`, flags Phase6 vẫn OFF.

## Bước 181 — Hậu kiểm remote clone sau Phase 6B (ảnh operator 28/11/2026)

Operator gửi bốn ảnh Cloudflare D1 Studio, theo ngữ cảnh đang làm việc tại D1 bản sao `duongtrcnhiem-restore-20261128`:

1. Truy vấn `SELECT` tám scalar `COUNT(*)` trả `demo_students=5`, `login_attempts=0`, `synthetic_graded_attempts=3`, `phase5_content_topics=1`, `phase5_content_versions=1`, `phase5_content_questions=1`, `phase5_content_answer_keys=1`, `phase5_content_attempts=2`. Tổng 14 bản ghi, khớp baseline trước 6B.
2. `PRAGMA quick_check;` → `ok`.
3. `PRAGMA foreign_key_check;` → `Query · 4×0` (0 hàng lỗi).

Kết hợp Bước 180 (2 bảng Phase6B + 3 trigger hiện diện), **gate `REMOTE_CLONE_PHASE6B_POSTFLIGHT: PASS`** đối với danh sách đối tượng, số dòng và kiểm tra toàn vẹn. So sánh row counts không phải kiểm chứng byte-for-byte nội dung tám bảng; test cục bộ bản sao đã kiểm tra SHA-256 riêng. Các ảnh Bước 181 chỉ chụp kết quả truy vấn, không chứa đầu trang tên DB, vì vậy kết luận đích dựa vào luồng thao tác liên tục từ các bước 179–180.

**Bước 182 có thể tiếp tục CHỈ trên clone `duongtrcnhiem-restore-20261128`:** chạy duy nhất file `serverless/d1-phase6c-publication-metadata-draft.sql` qua `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6c-publication-metadata-draft.sql`; không dùng `--yes`, xác nhận đúng target trước khi đồng ý prompt. Nếu lỗi, STOP, không retry. Hậu kiểm kế tiếp: 3 bảng Phase 6 / 6 trigger, 8 row counts baseline, `quick_check=ok`, `foreign_key_check=0`. Không ghi lên `duongtrcnhiem-auth-preview`, không bật `PHASE6_*`, không merge PR36 hoặc thay đổi Production.

## Bước 182 — Phase 6C remote rehearsal execution report (operator screenshot, 28/11/2026)

Người vận hành chạy `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6c-publication-metadata-draft.sql` trên **D1 bản sao cô lập** theo Bước 182. Ảnh phần cuối CMD cho thấy:
- `Executed 5 queries in 3.81ms (3 rows read, 7 rows written)`
- Total queries executed: 5
- Rows read: 3; rows written: 7
- Database size (MB): 0.15
- CMD đã về prompt, không thấy lỗi trong ảnh.

Đối chiếu file Phase 6C: 1 bảng `phase6_admin_publications`, 1 index `phase6_publications_latest` và 3 trigger `phase6_publication_no_delete`, `phase6_publication_no_update`, `phase6_publication_requires_published` tương ứng 5 lệnh DDL.

**Trạng thái:** `REMOTE_CLONE_PHASE6C_EXECUTION_REPORTED_SUCCESS`, **POSTFLIGHT CHƯA PASS**. Ảnh CMD chưa xác minh trực tiếp 3 bảng/6 trigger Phase 6 có mặt và row counts/tính toàn vẹn. Chưa được tiếp tục 6A nếu postflight chưa đạt.

**Bước 183 chỉ đọc:** trong D1 Studio database `duongtrcnhiem-restore-20261128`, chạy `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;`. Kỳ vọng 3 bảng và 6 trigger (9 hàng). Sau đó đối chiếu 8 counts baseline `5,0,3,1,1,1,1,2`, `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0 dòng. Nếu bất thường: STOP, không retry migration hay chạy 6A. Giữ `auth-preview` nguyên trạng, 3 flags Phase6 OFF, PR36 Draft.

## Bước 183 — Phase6C remote clone schema postflight (ảnh operator 28/11/2026)

Người vận hành gửi ba ảnh D1 Studio sau câu truy vấn metadata chỉ đọc `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;` tại D1 clone `duongtrcnhiem-restore-20261128`. Bảng kết quả hiển thị `sqlite_master · 2×9` và đúng 9 hàng, 3 bảng + 6 trigger.

- Tables: `phase6_admin_draft_events`, `phase6_admin_drafts`, `phase6_admin_publications`.
- Triggers: `phase6_admin_draft_created`, `phase6_admin_draft_deleted`, `phase6_admin_draft_saved`, `phase6_publication_no_delete`, `phase6_publication_no_update`, `phase6_publication_requires_published`.

**Gate `REMOTE_CLONE_PHASE6C_SCHEMA_PRESENCE: PASS`**. Chưa có bằng chứng từ Bước 183 về counts 8 bảng cũ, `PRAGMA quick_check` hoặc `foreign_key_check` sau 6C. Các ảnh cắt phần kết quả, tên đích suy ra từ chuỗi thao tác trước; không được suy ra hiệu lực runtime trigger hoặc quyền API.

**Bước 184:** trên đúng D1 clone `duongtrcnhiem-restore-20261128`, chỉ đọc 8 bảng cũ với expected `5,0,3,1,1,1,1,2`, `PRAGMA quick_check;` kỳ vọng `ok`, `PRAGMA foreign_key_check;` kỳ vọng 0 row. Nếu sai, STOP, không chạy 6A hoặc tự restore; nếu đạt mới tiến tới Phase6A remote clone. Giữ `duongtrcnhiem-auth-preview` nguyên trạng, `PHASE6_*` server flags chưa cấu hình và PR36 Draft.

## Bước 184 — Phase 6C remote clone hậu kiểm PASS (operator screenshots + explicit confirmation, 28/11/2026)

Người vận hành cung cấp hai ảnh Cloudflare D1 Studio sau khi áp dụng Phase6C trên `duongtrcnhiem-restore-20261128`:
- `PRAGMA quick_check;`: kết quả `ok` (ảnh).
- `PRAGMA foreign_key_check;`: kết quả `Query · 4×0`, nghĩa là 0 hàng vi phạm (ảnh).
- Operator xác nhận riêng bằng lời rằng 8 số dòng trả lại đúng thứ tự `5, 0, 3, 1, 1, 1, 1, 2` (không có ảnh row counts trong lần gửi này).
- Bước 183 trước đó đã cho thấy 3 bảng và 6 trigger Phase6 qua `sqlite_master`.

**Gate `REMOTE_CLONE_PHASE6C_POSTFLIGHT: PASS`** đối với các phép kiểm đã quan sát/xác nhận; giới hạn của đối chiếu chỉ là **row counts**, không phải hash dữ liệu từng bản ghi. Phase6A **chưa** chạy trong Bước 184.

**Bước 185 tiếp theo:** chỉ trên D1 clone `duongtrcnhiem-restore-20261128` thử một file `serverless/d1-phase6-timed-sessions-draft.sql` bằng Wrangler, kiểm tra prompt target, không `--yes`. Nếu chạy thành công, mới dùng metadata read-only xác minh 4 bảng Phase6 / 9 triggers, rồi hậu kiểm dữ liệu/integrity/FK trước khi chạy Phase6D. Không ghi vào `duongtrcnhiem-auth-preview`, không bật các cờ Phase6, không merge PR36 hoặc thay đổi Production.

## Bước 185 — Phase 6A remote clone execution (operator screenshot, 28/11/2026)

Người vận hành chạy `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6-timed-sessions-draft.sql` trên D1 bản sao cô lập theo Bước 185. Ảnh CMD cho thấy:
- `Executed 5 queries in 3.56ms (3 rows read, 8 rows written)`
- Total queries executed: 5; Rows read: 3; Rows written: 8; Database size (MB): 0.17.
- Lệnh hoàn tất và quay về CMD prompt, không thấy lỗi trong phần ảnh.

Kết quả 5 câu lệnh phù hợp cấu trúc dự thảo 6A tại GitHub: 1 bảng `phase6_exam_sessions`, 1 chỉ mục và 3 trigger `phase6_session_start_guard`, `phase6_session_no_delete`, `phase6_session_no_update`.

**Trạng thái: `REMOTE_CLONE_PHASE6A_EXECUTION_REPORTED_SUCCESS`, POSTFLIGHT CHƯA ĐẠT** cho tới khi xác minh bằng read-only metadata. Bước 186: dùng D1 Studio trên **duongtrcnhiem-restore-20261128** chạy `SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;` kỳ vọng **4 bảng + 9 triggers = 13 hàng**. Sau đó, trước Phase6D, kiểm tra 8 counts baseline `5,0,3,1,1,1,1,2`, `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0 dòng. Nếu bất thường, STOP, không retry migration.

Không thực hiện trên D1 `duongtrcnhiem-auth-preview`, không bật ba cờ API Phase 6, không merge PR36 hoặc thay đổi Production.

## Bước 186 — Operator xác nhận 13 đối tượng Phase 6 sau migration 6A (28/11/2026)

Người vận hành **xác nhận bằng lời** `có đủ 13 đối tượng` khi thực hiện Bước 186 truy vấn metadata `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;` tại database clone `duongtrcnhiem-restore-20261128`. Theo kết quả mong đợi đã hướng dẫn, tổng 13 đối tượng gồm 4 bảng và 9 trigger. Chưa có ảnh liệt kê từng hàng từ Bước 186 nên kết quả `REMOTE_CLONE_PHASE6A_SCHEMA_PRESENCE: PASS (operator-reported)`, chưa được xác minh độc lập qua danh sách tên trong lần này.

**Postflight Phase6A CHƯA hoàn tất:** operator cần kiểm tra 8 row counts của baseline `5,0,3,1,1,1,1,2`; `PRAGMA quick_check;` = `ok`; `PRAGMA foreign_key_check;` = 0 dòng; chỉ thực hiện trên **clone**, không chạy migration 6D trước khi các bước trên PASS.

Giữ nguyên `duongtrcnhiem-auth-preview` (Phase6 chưa được triển khai), ba server flags Phase6 chưa cấu hình, PR36 vẫn Draft, không thay đổi Production.

## Bước 187 — Phase 6A hậu kiểm trên D1 bản sao PASS (ảnh + người vận hành xác nhận, 28/11/2026)

Người vận hành gửi ảnh D1 Studio sau migration 6A tại `duongtrcnhiem-restore-20261128`:
- `PRAGMA quick_check;` → `ok` (ảnh).
- `PRAGMA foreign_key_check;` → bảng `Query · 4×0`, tức 0 hàng lỗi (ảnh).
- Người vận hành **xác nhận bằng lời** cả 8 số lượng bản ghi khớp `5,0,3,1,1,1,1,2`; không có ảnh giá trị 8 cột ở bước này.
- Bước 186 có xác nhận bằng lời 13 object Phase6, dự kiến gồm 4 bảng/9 trigger.

**Gate `REMOTE_CLONE_PHASE6A_POSTFLIGHT: PASS` theo hai ảnh và xác nhận operator.** Đây là so sánh số lượng chứ không phải kiểm chứng từng bản ghi. Các phần này chưa thực hiện trên D1 Preview đang kết nối website.

**Bước 188 chỉ trên clone `duongtrcnhiem-restore-20261128`:** chạy file cuối cùng `serverless/d1-phase6d-timed-submissions-draft.sql` qua `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6d-timed-submissions-draft.sql` (ghi D1 remote clone). Trước khi xác nhận Wrangler prompt, đối chiếu đúng tên database; nếu lỗi dừng, không tự retry. Sau chạy đọc metadata, dự kiến 5 bảng Phase6, 12 triggers, đủ 8 bảng cũ/14 bản ghi, quick_check ok và foreign_key_check 0. Flags Phase 6 và Preview giữ nguyên, PR36 Draft.

## Bước 188 — Phase 6D remote clone execution (operator screenshot, 28/11/2026)

Người vận hành chạy migration cuối theo hướng dẫn `npx wrangler d1 execute duongtrcnhiem-restore-20261128 --remote --file=serverless/d1-phase6d-timed-submissions-draft.sql` trên D1 **bản sao độc lập**. Ảnh CMD cho thấy bảng thống kê:
- `Total queries executed: 5`
- `Rows read: 3`
- `Rows written: 9`
- `Database size (MB): 0.20`
- Đã trở về dấu nhắc CMD và không thấy lỗi ở đoạn hiển thị.

Theo bản draft Phase 6D trên GitHub, 5 DDL dự kiến tạo một bảng `phase6_exam_submissions`, một chỉ mục và 3 trigger `phase6_submission_guard`, `phase6_submission_no_delete`, `phase6_submission_no_update`.

**Trạng thái: `REMOTE_CLONE_PHASE6D_EXECUTION_REPORTED_SUCCESS`; hậu kiểm Phase 6D CHƯA ĐẠT.** Ảnh chỉ hiển thị phần kết quả cuối, nên việc xác nhận đúng database đích dựa trên lệnh hướng dẫn/liên tục hội thoại; không coi số `rows written` là bản ghi của ứng dụng.

**Bước 189 chỉ đọc:** operator mở Cloudflare Studio của đúng `duongtrcnhiem-restore-20261128`, chạy `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;`; mong đợi **5 bảng Phase6 + 12 triggers = 17 hàng**. Sau đó kiểm tra baseline 8 bảng cũ `5,0,3,1,1,1,1,2` và `PRAGMA quick_check;` → `ok`, `PRAGMA foreign_key_check;` → 0 hàng. Nếu sai, STOP, không retry migration. Không bật Phase6 flags, không chạy 6D lên `duongtrcnhiem-auth-preview`, không merge PR36 hoặc triển khai Production.

## Bước 189 — Operator báo đủ 17 đối tượng Phase 6 sau 6D (28/11/2026)

Sau khi chạy truy vấn metadata `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;` trên D1 bản sao `duongtrcnhiem-restore-20261128`, người vận hành phản hồi trực tiếp **"có 17 đối tượng"**.

Theo kết quả mong đợi, 17 đối tượng bao gồm 5 bảng và 12 trigger Phase6. **Mức chứng cứ: OPERATOR-REPORTED tổng số 17; chưa có ảnh đầy đủ từng tên ở lần gửi này**, chưa đối chiếu chi tiết trực tiếp names của Phase6D trong Bước 189. Không đánh đồng số lượng đúng với việc trigger định nghĩa chính xác hay hoạt động đúng trên runtime.

**Trạng thái:** `REMOTE_CLONE_PHASE6D_SCHEMA_COUNT: PASS (operator-reported)`. **Chưa hoàn tất hậu kiểm Phase6D:** yêu cầu 8 row counts `5,0,3,1,1,1,1,2`, `PRAGMA quick_check;` → `ok`, `PRAGMA foreign_key_check;` → 0 hàng trên đúng clone. Nếu không đạt: STOP, không tái chạy migration và không đụng D1 Preview. Nếu đạt, có thể đánh dấu rehearsal bốn SQL D1 clone đầy đủ, nhưng việc chạy trên `duongtrcnhiem-auth-preview` cần phê duyệt riêng và xác minh preflight mới. Ba server flags `PHASE6_*` vẫn chưa cấu hình; PR36 giữ Draft.

## Bước 190 — Final Phase 6D postflight trên D1 restore clone (ảnh và xác nhận operator, 28/11/2026)

Operator cung cấp ảnh hai truy vấn trực tiếp sau khi hoàn tất Phase6D trên `duongtrcnhiem-restore-20261128`:
- `PRAGMA quick_check;` trả `ok`.
- `PRAGMA foreign_key_check;` trả kết quả `4×0` (bốn cột, không có vi phạm).
- Operator xác nhận bằng lời 8 bảng ứng dụng gốc giữ đúng số hàng baseline `5,0,3,1,1,1,1,2` (tổng 14), chưa cung cấp ảnh số lượng của bước này.
- Bước 189 operator xác nhận tổng 17 đối tượng Phase6 (dự kiến 5 bảng, 12 trigger); đó là xác nhận qua phản hồi chứ không có ảnh chi tiết từng tên ở chính bước 189.

**Kết luận:** `PHASE6_6B_6C_6A_6D_REMOTE_CLONE_MIGRATION_REHEARSAL: PASS (within checked scope)`; bốn file đã chạy tuần tự trên database clone, số bảng và trigger được operator xác nhận, số dòng gốc khớp, SQLite quick_check ok, foreign_key_check 0. Chưa xác nhận tính tương đương từng byte dữ liệu trên remote; bài test RAM bản export đã kiểm tra dữ liệu gốc không đổi bằng SHA.

**Không suy ra D1 Preview đã migrate:** `duongtrcnhiem-auth-preview` trước đó chưa có phase6 tables; 3 flag server Phase6 chưa được cấu hình; PR36 vẫn Draft. Không ghi vào Production. Bước kế tiếp: lập preflight read-only tại Preview gần thời điểm phê duyệt: đúng tên/ID DB, 8 bảng và số hàng hiện tại (dừng nếu khác baseline), 0 phase6 objects, Time Travel bookmark mới, backup snapshot có thể restore. Chỉ sau phê duyệt riêng cho target Preview mới chạy migration.

## Bước 191 — D1 Preview preflight: 8/9 giá trị nhìn thấy, attempts chưa hiển thị (operator screenshots 28/11/2026)

Người vận hành chạy câu SQL read-only preflight theo Bước 191 trên D1 Preview `duongtrcnhiem-auth-preview`, trả một hàng/9 cột. Hai ảnh hiển thị:
- `phase6_tables=0` (khớp dự kiến, chưa migrate Phase6 trên Preview).
- `students=5`, `logins=0`, `grades=3`, `topics=1`, `versions=1`, `questions=1`, `answer_keys=1` (khớp baseline trước đó).
- Cột `attempts` có header nhưng **giá trị nằm ngoài khung phải của ảnh**, nên **chưa được xác minh**. Baseline Bước 166: `phase5_content_attempts=2`.

**Trạng thái:** `PREVIEW_PREFLIGHT_PARTIAL: 8/9 FIELDS VISIBLE`; không khẳng định Bước 191 PASS cho tới khi operator cung cấp giá trị attempts. Truy vấn bổ sung **chỉ đọc**: `SELECT COUNT(*) AS attempts FROM phase5_content_attempts;`, kỳ vọng 2. Nếu không phải 2, dừng migration để kiểm tra biến động dữ liệu/backup và Time Travel.

**Không chạy** bất kỳ file Phase6 trên `duongtrcnhiem-auth-preview`, không thêm `PHASE6_*`, không merge PR36 hoặc triển khai Production trước khi đủ gate và quyết định cấp quyền riêng.

## Bước 192 — D1 Preview đối chiếu đủ 9 giá trị preflight (ảnh operator, 28/11/2026)

Ảnh D1 Studio của người vận hành tại `duongtrcnhiem-auth-preview` sau query `SELECT COUNT(*) AS attempts FROM phase5_content_attempts;` trả **`attempts = 2`**. Kết hợp Bước 191 trực tiếp trên Preview đã có:
- `phase6_tables = 0`;
- `demo_students = 5`, `login_attempts = 0`, `synthetic_graded_attempts = 3`;
- `phase5_content_topics = 1`, `versions = 1`, `questions = 1`, `answer_keys = 1`;
- `phase5_content_attempts = 2` (Bước 192).

**Gate `PREVIEW_PREFLIGHT_COUNTS_9_OF_9_MATCH: PASS`** đối với mốc đo trong Bước 191–192: 8 bảng ứng dụng với tổng 14 hàng, Preview vẫn chưa có bảng `phase6_%`. Đây là bằng chứng **đếm hàng**, không so sánh nội dung từng bản ghi, và chỉ đúng tại thời điểm đo.

Bản backup 28/11 đã khôi phục trên D1 riêng `duongtrcnhiem-restore-20261128` với 8 bảng, 14 hàng, `quick_check=ok`, `foreign_key_check=0`. Trên cùng D1 bản sao, người vận hành đã chạy bốn migration 6B→6C→6A→6D, thông báo đủ 5 bảng/12 trigger và hậu kiểm 8 counts/integrity/FK PASS. Việc đã vượt gate này **chưa** đồng nghĩa migration trên `duongtrcnhiem-auth-preview` được cấp phép.

**Bước 193 (preflight cuối, chỉ đọc):** chọn thời điểm **không có học viên DEMO hoặc Admin đang ghi dữ liệu**, lấy bookmark mới cho chính Preview bằng `npx wrangler d1 time-travel info duongtrcnhiem-auth-preview`, và ghi timestamp/bookmark vào hồ sơ vận hành riêng (không đẩy lên GitHub). Nếu đã có thay đổi dữ liệu so với snapshot, cần export backup mới và xác minh lại. Trước khi gửi bất kỳ lệnh `wrangler d1 execute ... --remote` nào nhắm vào Preview, cần phê duyệt rõ từng migration, đích, và kế hoạch dừng/rollback. Không gộp PR36, không bật ba cờ Phase6 API, không đụng Production.

## Bước 193 — Time Travel bookmark mới trước migration Preview (28/11/2026)

Người vận hành xác nhận đã đăng xuất và đóng các phiên DEMO A/B/C/D và Admin. Ảnh CMD cho thấy `npx wrangler d1 time-travel info duongtrcnhiem-auth-preview` với Wrangler `4.169.0` in `Resource location: remote`, `The current bookmark is '...'` và prompt trở về; người vận hành tiếp tục xác nhận `đã có`. **Không copy bookmark hoặc lệnh restore vào GitHub**.

**Gate `FRESH_PREVIEW_TIME_TRAVEL_BOOKMARK_OBSERVED: PASS`.** Ảnh/lời xác nhận không chứng minh mọi thiết bị và tác vụ ghi khác đã ngừng tuyệt đối, vì vậy không được suy ra trạng thái write-quiescent đã được đảm bảo bằng máy chủ. Bookmark có thể thay đổi sau đó; cần giữ giá trị trong hồ sơ vận hành riêng, không dùng bookmark này một cách máy móc nếu thời gian/data thay đổi.

**Còn cần phê duyệt riêng cho thao tác ghi:** từ trước đến giờ bốn migration chỉ đã chạy trên D1 clone `duongtrcnhiem-restore-20261128`, **chưa** được áp dụng lên `duongtrcnhiem-auth-preview`. Không dùng lời đáp `đã có` (xác nhận bookmark) để thay thế phê duyệt thực thi. Trước lệnh remote 6B đầu tiên: xem lại target exact, duy trì không có thao tác DEMO, kiểm tra 8 counts/0 Phase6 ở Bước 191–192 vẫn còn cập nhật, và nhận quyết định `CHO PHÉP` rõ ràng cho riêng Preview migrations. Khi phê duyệt: chỉ chạy 6B đầu tiên, kiểm tra schema/row counts/integrity/FK trước 6C. Không bật flags Phase6 hoặc đụng Production, PR36 Draft.

## Bước 194 — Chủ vận hành phê duyệt triển khai 4 migration trên D1 Preview (28/11/2026)

Sau Bước 193, người vận hành được hỏi rõ có đồng ý triển khai lần lượt **6B → 6C → 6A → 6D** lên duy nhất `duongtrcnhiem-auth-preview`, với hậu kiểm từng bước và dừng khi có lỗi hay không. Người vận hành trả lời nguyên văn **"đồng ý"**. Đây là **phê duyệt tường minh cho việc chạy SQL Phase 6 trên D1 Preview**, không phải phê duyệt bật API Phase6, dùng dữ liệu thật, khôi phục Time Travel, merge PR36 hay thay đổi Pages Production.

Đã kiểm tra lại file `serverless/d1-phase6b-synthetic-admin-drafts-draft.sql` trên Staging: chỉ tạo 2 bảng, 1 index, 3 trigger và không thay đổi cấu trúc bảng cũ. Git blob SHA: `aa45d3a944e21d24dfb8f676a2bc606ec99c35c9`. Các bước trước đã đo baseline Preview `0 phase6_tables; 5,0,3,1,1,1,1,2`, operator đã ngừng phiên DEMO, xuất backup mới đã thử remote restore, và lấy bookmark Time Travel mới.

**Phạm vi thực thi của Bước 194: một file 6B duy nhất**, chỉ trên D1 `duongtrcnhiem-auth-preview`:
```cmd
npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6b-synthetic-admin-drafts-draft.sql
```
Trước khi xác nhận prompt, operator phải thấy đúng database Preview; nếu tên DB sai hoặc có câu hỏi lạ, dừng. Đây là lệnh **ghi remote** do operator tự chạy, **không** do GitHub update. Nếu gặp lỗi, không tự retry; đối chiếu schema hiện tại để xử lý trạng thái một phần.

**Postflight bắt buộc trước khi cho 6C:** read-only metadata `phase6_%` dự kiến 2 bảng/3 trigger; 8 counts baseline `5,0,3,1,1,1,1,2`, `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0. Giữ `PHASE6_*` server flags OFF, không gộp PR, không đổi Production. Bookmark phục hồi không được lưu trong tài liệu; không chạy `time-travel restore` trừ khi có quyết định riêng.

## Bước 194 — Phase 6B lần đầu trên D1 Preview: Wrangler execution report (operator screenshot, 28/11/2026)

Sau khi đã phê duyệt ở Bước 194, người vận hành báo chạy lệnh `npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6b-synthetic-admin-drafts-draft.sql`. Ảnh phần kết quả CMD hiển thị:
- `Processed 6 queries`, `Executed 6 queries in 3.42ms (5 rows read, 11 rows written)`
- `Total queries executed: 6`; `Rows read: 5`; `Rows written: 11`; `Database size (MB): 0.14`.
- Có dòng bookmark nhưng **không lưu** bookmark hay toàn bộ chuỗi đó vào GitHub.

**Trạng thái:** `PREVIEW_PHASE6B_REMOTE_EXECUTION_REPORTED_SUCCESS`, **postflight CHƯA PASS**. Ảnh CMD được cắt, không hiển thị tên database trong câu lệnh; đối tượng Preview được xác định theo lệnh ngay trước và trình tự operator, vì thế cần trực tiếp mở đúng DB Preview để xác nhận.

**Bước tiếp theo (chỉ đọc, không chạy 6C):** D1 Studio của `duongtrcnhiem-auth-preview` chạy:
```sql
SELECT type, name FROM sqlite_master
WHERE type IN ('table','trigger') AND name LIKE 'phase6_%'
ORDER BY type,name;
```
Mong đợi `2 tables` (`phase6_admin_drafts`, `phase6_admin_draft_events`) và `3 triggers` (`phase6_admin_draft_created`, `phase6_admin_draft_deleted`, `phase6_admin_draft_saved`). Sau đó xác minh 8 bảng cũ / row counts `5,0,3,1,1,1,1,2`, `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0. Nếu bất thường, **STOP**, không retry SQL hoặc chạy 6C. Giữ API Phase6 flags OFF, không gộp PR36, không sửa Pages Production hoặc D1 staging.

## Bước 195 — Phase 6B schema postflight trực tiếp trên D1 Preview (ảnh operator, 28/11/2026)

Người vận hành mở `duongtrcnhiem-auth-preview` → D1 Studio và chạy:
```sql
SELECT type, name FROM sqlite_master
WHERE type IN ('table','trigger') AND name LIKE 'phase6_%'
ORDER BY type, name;
```
Hai ảnh kết quả hiển thị `sqlite_master · 2×5`, đủ năm hàng:
- `table: phase6_admin_draft_events`
- `table: phase6_admin_drafts`
- `trigger: phase6_admin_draft_created`
- `trigger: phase6_admin_draft_deleted`
- `trigger: phase6_admin_draft_saved`

**Gate `PREVIEW_PHASE6B_SCHEMA_PRESENCE: PASS`**: tồn tại 2 bảng và 3 trigger đúng tên trên D1 Preview theo ngữ cảnh thao tác. Ảnh được cắt không hiện header tên DB; nguồn là trình tự Bước 194–195. Chưa kiểm chứng thiết kế trigger SQL exact hoặc hành vi API.

**Gate `PREVIEW_PHASE6B_INTEGRITY_AND_BASELINE: PENDING`**: Bước 196 phải đọc số dòng của 8 bảng cũ `5,0,3,1,1,1,1,2`, `PRAGMA quick_check = ok` và `PRAGMA foreign_key_check` trả 0 hàng trên chính `duongtrcnhiem-auth-preview`. Nếu có thay đổi, dừng và kiểm tra trước khi chạy 6C; không tự rollback hoặc chạy lại 6B. Ba flag Phase 6 vẫn chưa được cấu hình; chưa thay đổi Production hoặc merge PR36.

## Bước 196 — Phase 6B hậu kiểm trên D1 Preview đạt (operator screenshots + confirmation, 28/11/2026)

Theo hai ảnh Cloudflare D1 Studio do operator gửi, khi đang kiểm tra `duongtrcnhiem-auth-preview`:
- `PRAGMA quick_check;` trả `ok`.
- `PRAGMA foreign_key_check;` trả `Query · 4×0`, không phát hiện hàng lỗi khóa ngoại.
- Operator xác nhận bằng lời 8 bảng cũ có đúng các số lượng `5, 0, 3, 1, 1, 1, 1, 2` (14 hàng). Ảnh đếm số dòng không được gửi trong bước 196.
- Bước 195 đã chụp đúng 2 bảng và 3 trigger của Phase 6B trong `sqlite_master`.

**Gate `PREVIEW_PHASE6B_POSTFLIGHT: PASS`** đối với bảng/trigger, số lượng bản ghi và tính toàn vẹn đã kiểm tra; đối chiếu số dòng không khẳng định hash/nội dung từng hàng giống nhau. Không có kiểm thử API Phase6 live trong bước này; ba server flags Phase6 giữ OFF.

**Bước 197 theo phê duyệt operator Bước 194:** chạy **một file Phase 6C** trên đúng `duongtrcnhiem-auth-preview`:
```cmd
npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6c-publication-metadata-draft.sql
```
Git file blob SHA bản staging đã rà soát: `2121265b988342fe601582d0fb4f73ddb43b98c3`; 5 câu DDL tạo 1 bảng `phase6_admin_publications`, 1 index và 3 triggers. Operator phải kiểm tra đúng database trong prompt; nếu lỗi STOP, không retry; sau lệnh phải xác minh **3 bảng và 6 trigger Phase6**, 8 counts baseline, `quick_check=ok`, `foreign_key_check=0` trước bước 6A. Không chạy 6A, 6D trong bước này, không bật flag API, không đổi Production hoặc merge PR36.

## Bước 197 — Phase 6C Preview migration execution report (ảnh operator, 28/11/2026)

Sau khi postflight Phase6B Preview PASS ở Bước 196, operator thực hiện theo kế hoạch `npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6c-publication-metadata-draft.sql`. Ảnh CMD người dùng gửi hiển thị:
- `Executed 5 queries in 2.43ms (3 rows read, 7 rows written)`.
- Total queries executed: 5.
- Rows read: 3.
- Rows written: 7.
- Database size (MB): 0.15.

Không có lỗi hiển thị trong ảnh. File đã review gồm 5 DDL (1 bảng `phase6_admin_publications`, 1 index, 3 trigger). Ảnh được cắt không chứa tên database đích, vì thế ngữ cảnh câu lệnh ở Bước 197 là bằng chứng gắn nguồn.

**Trạng thái: `PREVIEW_PHASE6C_EXECUTION_REPORTED_SUCCESS`, postflight còn PENDING.** Chưa suy ra 3 bảng/6 trigger đã thực sự hiện diện hoặc 8 bảng cũ không bị thay đổi.

**Bước 198 (chỉ đọc, trên đúng `duongtrcnhiem-auth-preview`):** 
```sql
SELECT type, name
FROM sqlite_master
WHERE type IN ('table', 'trigger') AND name LIKE 'phase6_%'
ORDER BY type, name;
```
Kỳ vọng 3 bảng `phase6_admin_draft_events`, `phase6_admin_drafts`, `phase6_admin_publications` và 6 triggers `phase6_admin_draft_created`, `phase6_admin_draft_deleted`, `phase6_admin_draft_saved`, `phase6_publication_no_delete`, `phase6_publication_no_update`, `phase6_publication_requires_published`. Khi đã thấy đủ tên, mới kiểm 8 row counts baseline `5,0,3,1,1,1,1,2`, `PRAGMA quick_check=ok` và `PRAGMA foreign_key_check` không có lỗi trước khi cho phép 6A. Nếu có bất thường: STOP, không retry hoặc restore. API Phase6 flags OFF; PR36 Draft; không đụng Production.

## Bước 198 — Operator xác nhận 9 đối tượng Phase6 trên D1 Preview sau 6C (28/11/2026)

Người vận hành trả lời trực tiếp **"có 9 đối tượng"** sau hướng dẫn chạy read-only `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;` tại `duongtrcnhiem-auth-preview`. Kỳ vọng đã thông báo trong Bước 198 là 3 bảng Phase6 và 6 trigger Phase6. **Mức chứng cứ: operator-reported count, không có ảnh chụp danh sách 9 tên ở bước này**; do đó chỉ đánh dấu `PREVIEW_PHASE6C_SCHEMA_COUNT: PASS (operator-reported)`, chưa xác minh chính xác từng định nghĩa.

**Bước 199 — hậu kiểm bắt buộc, chỉ đọc trên Preview:** truy vấn `COUNT(*)` của 8 bảng gốc (baseline `5,0,3,1,1,1,1,2`, tổng 14), `PRAGMA quick_check;` phải trả `ok`, `PRAGMA foreign_key_check;` phải trả 0 dòng. Nếu sai khác, dừng triển khai; **không** tự chạy lại 6C, chạy 6A, hoặc time-travel restore. Ba server flags Phase6 vẫn OFF, PR36 Draft, Production không thay đổi.

## Bước 199 — Preview Phase 6C hậu kiểm hoàn thành (operator screenshot/statement, 28/11/2026)

Operator gửi ảnh Cloudflare D1 Studio sau 6C: kết quả `PRAGMA foreign_key_check;` hiển thị `Query · 4×0`, tức **0 hàng lỗi khóa ngoại**. Operator đồng thời xác nhận bằng lời `8 bảng đúng giá trị quick ok`, theo nội dung các lệnh đã hướng dẫn (8 counts `5,0,3,1,1,1,1,2`, `PRAGMA quick_check;` → `ok`). **Mức chứng cứ:** lỗi FK bằng ảnh; 8 counts và quick_check bằng xác nhận của operator, không có ảnh độc lập hai kết quả đó trong lần gửi này. Bước 198 xác nhận bằng lời 9 đối tượng Phase6, dự kiến 3 tables/6 triggers.

**Gate `PREVIEW_PHASE6C_POSTFLIGHT: PASS (within observed/reported scope)`**, không hàm ý từng bản ghi được hash đối chiếu hay runtime API đã bật. Các server Phase6 flags vẫn không cấu hình, PR36 giữ Draft.

## Bước 200 — Chỉ một migration Phase 6A trên D1 Preview, sau gate 199 PASS

Đối chiếu file SQL staging `serverless/d1-phase6-timed-sessions-draft.sql` (blob `6257e6d85e565fe8aaf02f6316761df5b40bc718`), bản này chỉ CREATE một bảng `phase6_exam_sessions`, một index, ba triggers `phase6_session_start_guard`, `phase6_session_no_update`, `phase6_session_no_delete`. Không thấy lệnh DML trên bảng Phase4/5 trong file.

Operator đã phê duyệt tuần tự 6B→6C→6A→6D ở Bước 194, với gate hậu kiểm mỗi bước. Bước 200 chỉ chạy **6A** vào D1 `duongtrcnhiem-auth-preview`:
```cmd
npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6-timed-sessions-draft.sql
```
Lệnh **ghi remote**; phải xác nhận đúng tên database khi Wrangler hỏi, không dùng `--yes`. Nếu lỗi hoặc target khác, STOP, không retry. Sau đó phải đọc `sqlite_master` để xác minh 4 bảng Phase6/9 triggers, kiểm 8 counts baseline và `PRAGMA quick_check`, `PRAGMA foreign_key_check` rồi mới xét 6D.

**Chưa có kết quả lệnh 6A tại thời điểm này**. Không bật API Phase6, không đổi Pages Production, không merge PR36.

## Bước 200 — Phase 6A Preview execution report (operator screenshot, 28/11/2026)

Người vận hành chạy lệnh Phase6A đã hướng dẫn trước đó `npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6-timed-sessions-draft.sql`. Ảnh CMD phần cuối cho thấy:
- `Executed 5 queries in 2.98ms (3 rows read, 8 rows written)`.
- `Total queries executed: 5`.
- `Rows read: 3`, `Rows written: 8`, `Database size (MB): 0.17`.
- Có hiển thị current bookmark D1 (không sao chép giá trị vào GitHub).
- Không có lỗi hiển thị trong phần ảnh.

**Trạng thái:** `PREVIEW_PHASE6A_EXECUTION_REPORTED_SUCCESS`; **POSTFLIGHT PENDING**. Ảnh CMD được cắt, không có tên đích; kết luận database Preview dựa trên lệnh hướng dẫn ngay trước đó. Theo migration 6A, 5 DDL là 1 bảng `phase6_exam_sessions`, 1 index và 3 triggers `phase6_session_start_guard`, `phase6_session_no_delete`, `phase6_session_no_update`. Không coi số `rows written` là số bản ghi ứng dụng.

**Bước 201 (read-only), trên đúng `duongtrcnhiem-auth-preview`:**
```sql
SELECT type,name FROM sqlite_master
WHERE type IN ('table','trigger') AND name LIKE 'phase6_%'
ORDER BY type,name;
```
Kỳ vọng 4 bảng Phase6/9 triggers, tổng 13 đối tượng. Trước khi chạy 6D, bắt buộc kiểm tra số dòng 8 bảng cũ theo baseline `5,0,3,1,1,1,1,2`, `PRAGMA quick_check;` → `ok`, `PRAGMA foreign_key_check;` → 0 hàng. Nếu có bất thường, STOP, không tự chạy lại 6A hoặc thực hiện restore. Giữ ba flag API Phase6 chưa cấu hình, PR36 Draft, Production không thay đổi.

## Bước 201 — Operator báo 13 đối tượng Phase6 trên D1 Preview sau 6A (28/11/2026)

Người vận hành đã chạy truy vấn metadata được hướng dẫn ở Bước 201 trên `duongtrcnhiem-auth-preview`, trả lời **"có 13 đối tượng"**. Truy vấn đã yêu cầu `type IN ('table','trigger')`, `name LIKE 'phase6_%'`; 13 đối tượng phù hợp với kỳ vọng **4 bảng/9 trigger** sau migration 6B→6C→6A. **Chứng cứ: operator-reported count**; chưa có ảnh/danh sách 13 tên trong chính lần báo này, nên không được coi là đã kiểm chứng độc lập toàn bộ tên và định nghĩa trigger.

**Gate `PREVIEW_PHASE6A_SCHEMA_COUNT: PASS (operator reported)`**, **gate `PREVIEW_PHASE6A_FULL_POSTFLIGHT: PENDING`**. Trước khi chạy 6D, bắt buộc so sánh 8 bảng gốc với baseline `5,0,3,1,1,1,1,2`, thực hiện `PRAGMA quick_check;` (kỳ vọng `ok`) và `PRAGMA foreign_key_check;` (kỳ vọng 0 hàng) trên đúng `duongtrcnhiem-auth-preview`; tất cả read-only. Nếu bất kỳ giá trị nào sai, STOP, không tự retry/restore hoặc chạy Phase6D. Giữ cờ API `PHASE6_*` chưa cấu hình, PR36 Draft, không đụng Production.

## Bước 202 — Preview Phase 6A postflight PASS do người vận hành xác nhận (28/11/2026)

Người vận hành trả lời **"tất cả đều đạt"** sau khi được hướng dẫn ba phép kiểm ở Bước 202 trên `duongtrcnhiem-auth-preview`. Theo kết quả đã yêu cầu và được xác nhận:
- Số hàng 8 bảng gốc: `5,0,3,1,1,1,1,2` (tổng 14).
- `PRAGMA quick_check;` = `ok`.
- `PRAGMA foreign_key_check;` không trả hàng lỗi.
- Bước 201 đã được người vận hành xác nhận đủ 13 đối tượng Phase6 (mong đợi 4 bảng, 9 trigger).

**Mức bằng chứng:** người vận hành xác nhận kết quả, **không có ảnh màn hình cho ba truy vấn Bước 202**. Gate `PREVIEW_PHASE6A_POSTFLIGHT: PASS (operator-reported)` trong phạm vi kiểm tra số hàng/quick_check/FK; không xác nhận từng bản ghi byte-for-byte hay hiệu lực thực tế của API Phase6.

## Bước 203 — Phê duyệt có điều kiện, chỉ một file Phase 6D trên D1 Preview

Đã đối chiếu file staging `serverless/d1-phase6d-timed-submissions-draft.sql` (Git blob SHA `92ed95a106e59337f8a76d3f9e97c8630b30ecf9`): chỉ DDL tạo `phase6_exam_submissions`, index `phase6_submissions_uid_time` và ba trigger `phase6_submission_guard`, `phase6_submission_no_update`, `phase6_submission_no_delete`; tham chiếu `phase6_exam_sessions`, `phase6_admin_publications`, `phase5_content_versions`, `demo_students`. Không thấy lệnh SQL cập nhật/xóa bảng gốc trong file. Đã chạy thử remote trên D1 clone `duongtrcnhiem-restore-20261128` và có hậu kiểm PASS. Theo phê duyệt tuần tự trước đó của người vận hành tại Bước 194, bước này chỉ phép chạy **6D** lên đúng `duongtrcnhiem-auth-preview`:
```cmd
npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6d-timed-submissions-draft.sql
```
Đây là lệnh **ghi remote**. Operator phải kiểm tra đích trong prompt và dừng nếu khác `duongtrcnhiem-auth-preview` hoặc có lỗi, **không** tự retry. Trước khi chạy bảo đảm không có phiên DEMO sử dụng và backup/Time Travel đã xác minh vẫn sẵn sàng. Chưa có bằng chứng Phase6D thực thi trên Preview tại thời điểm ghi phần này.

Sau thực thi, chỉ đọc metadata để xác minh đủ 5 bảng Phase6/12 triggers, kiểm 8 bảng cũ 14 hàng, `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0, rồi mới xem xét bật flags API Phase6 qua phê duyệt riêng. Giữ `PHASE6_*` server flags OFF trong suốt bước này, PR36 Draft, Production không bị thay đổi.

## Bước 203 — Phase 6D Preview Wrangler execution statistics (operator screenshot, 28/11/2026)

Người vận hành đã làm theo hướng dẫn Bước 203 chạy `npx wrangler d1 execute duongtrcnhiem-auth-preview --remote --file=serverless/d1-phase6d-timed-submissions-draft.sql`. Ảnh phần cuối kết quả Wrangler hiển thị:
- `Total queries executed: 5`
- `Rows read: 3`
- `Rows written: 9`
- `Database size (MB): 0.20`
- Một current bookmark (không sao chép vào GitHub).

Không thấy lỗi trong đoạn ảnh được chụp. Đây là thống kê tương ứng với 5 DDL dự kiến cho 6D: bảng `phase6_exam_submissions`, index và 3 triggers. **Ảnh bị cắt, không hiện tên DB hay câu lệnh**, nên việc gán với Preview dựa trên ngữ cảnh thao tác Bước 203, không phải chứng cứ độc lập của đích.

**Trạng thái `PREVIEW_PHASE6D_EXECUTION_REPORTED_SUCCESS`, `POSTFLIGHT: PENDING`.** Không coi `rows written=9` là số bản ghi bài nộp, không suy ra đủ 5 bảng/12 triggers chỉ từ execution summary.

**Bước 204 chỉ đọc:** tại `duongtrcnhiem-auth-preview` (không nhầm restore-test/restore-20261128), truy vấn metadata `SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type,name;`, kỳ vọng 5 bảng/12 trigger (17 hàng) và bốn đối tượng Phase6D `phase6_exam_submissions`, `phase6_submission_guard`, `phase6_submission_no_delete`, `phase6_submission_no_update`. Sau đó hậu kiểm 8 bảng baseline `5,0,3,1,1,1,1,2`, `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` 0 hàng; mới chốt toàn bộ. Nếu bất thường, dừng, không tự chạy lại/restore.

Giữ ba flag API `PHASE6_*` OFF; PR36 Draft, không merge, không thay đổi Production.

## Bước 204 — D1 Preview đã có 17 đối tượng Phase6 theo xác nhận operator (28/11/2026)

Sau hướng dẫn đọc `SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'phase6_%' ORDER BY type, name;` trên `duongtrcnhiem-auth-preview`, người vận hành phản hồi **"17 đối tượng đã có"**. Kết quả phù hợp kỳ vọng sau 6B → 6C → 6A → 6D là **5 bảng Phase6 + 12 trigger Phase6**, nhưng chứng cứ ở bước này là số đối tượng do operator báo (chưa có ảnh danh sách/từng loại). Không coi số lượng này là kiểm chứng định nghĩa SQL của từng trigger hoặc dữ liệu bài thi.

**Gate `PREVIEW_PHASE6_SCHEMA_COUNT: PASS (operator-reported)`**. **Gate `PREVIEW_PHASE6D_FINAL_POSTFLIGHT: PENDING`** cho đến khi kiểm tra lại 8 số lượng bản ghi gốc `5,0,3,1,1,1,1,2`, `PRAGMA quick_check` = `ok`, `PRAGMA foreign_key_check` trả 0 hàng trên **chính** D1 Preview. Nếu lỗi hoặc số hàng khác baseline, dừng; không rollback tự động, không chạy lại migration.

Các cờ máy chủ `PHASE6_STUDENT_TIMED_EXAM_ENABLED`, `PHASE6_RESULTS_READONLY_ENABLED`, `PHASE6_ADMIN_RESULTS_ENABLED` tiếp tục không cấu hình/OFF; chưa xác minh API thực tế, chưa merge PR36 và chưa đổi Production.

## Bước 205 — Toàn bộ Phase 6D final postflight PASS trên D1 Preview (operator-confirmed, 28/11/2026)

Sau Bước 204 báo đủ 17 đối tượng Phase 6 trên `duongtrcnhiem-auth-preview` (kỳ vọng 5 bảng/12 trigger; operator-reported), operator hoàn thành ba phép kiểm read-only của Bước 205 và phản hồi **"cả 3 đều pass"**:
- 8 bảng gốc có `COUNT(*)` khớp baseline `5,0,3,1,1,1,1,2` (14 bản ghi);
- `PRAGMA quick_check;` = `ok`;
- `PRAGMA foreign_key_check;` = 0 hàng lỗi.

**Chứng cứ mức operator-reported, không có screenshot mới** cho ba kết quả ở Bước 205; chưa so sánh từng hàng D1 remote hash/content byte-for-byte. Kết hợp bằng chứng migration từng bước và D1 clone thử trước: **`PREVIEW_PHASE6_SCHEMA_MIGRATION_POSTFLIGHT: PASS (checked scope)`**. 4 SQL đã được báo thực thi trên D1 Preview, không phải mới chỉ trên SQLite cục bộ. Chưa xác nhận Phase6 runtime student/Admin, phát hành DEMO exam, các trường hợp A/B/PC/iPhone. Không tự bật API hoặc merge PR36; Pages Production và staging D1 chưa thay đổi trong những bước này.

### Bước 206 đề nghị — Kiểm tra dữ liệu Phase6 trước khi mở flags (chỉ đọc)

Mã nguồn Phase6 student exam route `functions/api/phase6/exam.js` trả 404 khi thiếu `PHASE6_STUDENT_TIMED_EXAM_ENABLED='true'` và yêu cầu host Preview cố định, `PHASE4_PREVIEW_HOST_OPT_IN`, `AUTH_DB_PREVIEW` binding và Firebase signed student. Các route student/admin results yêu cầu `PHASE6_RESULTS_READONLY_ENABLED='true'` và admin yêu cầu thêm `PHASE6_ADMIN_RESULTS_ENABLED='true'`; không cấu hình ba cờ server là OFF (đã xác nhận Bước155).

Student `action:'list'` đọc `phase5_content_versions` trạng thái `published` liên kết `phase6_admin_publications` (không chỉ dựa vào việc bảng tồn tại). Migration là schema-only: **chưa chứng minh đã có bất kỳ đề Phase 6 nào được xuất bản**. Nếu `phase6_admin_publications` trống, danh sách đề Phase6 sẽ rỗng ngay cả sau khi bật API.

Để kiểm tra chỉ số dữ liệu mà không hiển thị thông tin tài khoản hay đề thi, tại `duongtrcnhiem-auth-preview` chạy 1 SELECT với scalar subqueries `COUNT(*)` cho năm bảng `phase6_admin_drafts`, `phase6_admin_draft_events`, `phase6_admin_publications`, `phase6_exam_sessions`, `phase6_exam_submissions`. Chỉ báo năm con số; **không** chạy INSERT/UPDATE/DELETE, không tạo tài khoản hoặc đề thật, không thử API ghi, không bật flags trước quyết định riêng.

## Bước 206 — Cả năm bảng Phase6 trên Preview mới migration đều trống (ảnh operator 28/11/2026)

Operator truy vấn read-only tại `duongtrcnhiem-auth-preview`:
```sql
SELECT
 (SELECT COUNT(*) FROM phase6_admin_drafts) AS drafts,
 (SELECT COUNT(*) FROM phase6_admin_draft_events) AS events,
 (SELECT COUNT(*) FROM phase6_admin_publications) AS publications,
 (SELECT COUNT(*) FROM phase6_exam_sessions) AS sessions,
 (SELECT COUNT(*) FROM phase6_exam_submissions) AS submissions;
```
Ảnh Cloudflare Studio `phase6_admin_drafts · 5×1` cho **`drafts=0`, `events=0`, `publications=0`, `sessions=0`, `submissions=0`**. Gate `PREVIEW_PHASE6_EMPTY_DATA_BASELINE: PASS`; phù hợp DDL-only migration. Chưa có đề DEMO Phase6 nào được xuất bản, vì vậy không cho phép hiểu `API Phase6 ready` chỉ từ schema.

### Phát hiện quan trọng từ source trước khi bật API

Đã đọc tại `feature/staging-demo-quiz-pilot`:
- `functions/api/phase6/admin/drafts.js`: route **Admin draft CRUD** đòi `PHASE6_ADMIN_DRAFTS_ENABLED === 'true'`, thêm `PHASE4_PREVIEW_HOST_OPT_IN`, pinned Preview hostname, signed Google Admin và binding `AUTH_DB_PREVIEW`. Default OFF.
- `functions/api/phase6/admin/publish.js`: route **Admin publication** đòi **cả** `PHASE6_ADMIN_PUBLISH_ENABLED === 'true'` **và** `PHASE6_ADMIN_DRAFTS_ENABLED === 'true'`; tương tự yêu cầu host/Admin. Default OFF.
- `src/App.tsx`: 6B Admin UI cần build-time `VITE_PHASE6_ADMIN_DRAFTS_UI === 'true'`; nút xuất bản còn cần `VITE_PHASE6_ADMIN_PUBLISH_UI === 'true'`. Đây là **hai build-time UI flags**, không giống hai server-side flags.
- `src/components/Phase6AdminDraftsPanel.tsx`: Admin có workflow tạo nháp toán DEMO, thêm 1–12 câu mẫu cố định, đặt thời gian phút, lưu rồi xác nhận xuất bản. Không cần viết SQL seed bằng tay khi API/UI được bật có kiểm soát.
- `src/utils/phase6AdminDrafts.ts`: client chỉ cho Firebase signed Admin trên Preview thao tác; `functions/_shared/phase6-synthetic-publication.mjs` dùng transaction `db.batch` tạo revision, câu hỏi giả, answer keys và `phase6_admin_publications` đồng nhất.
- Cả ba API học viên/đọc điểm `PHASE6_STUDENT_TIMED_EXAM_ENABLED`, `PHASE6_RESULTS_READONLY_ENABLED`, `PHASE6_ADMIN_RESULTS_ENABLED` vẫn mặc định OFF/chưa được cấu hình theo Bước 155. **Đừng bật cả loạt** khi chưa có đề xuất bản.

**Bước 207 (chỉ xem Settings):** Cloudflare Pages project `duongtrcnhiem-test` → **Settings → Preview → Variables and secrets**; kiểm tra sự tồn tại/giá trị **4 cờ** `PHASE6_ADMIN_DRAFTS_ENABLED`, `PHASE6_ADMIN_PUBLISH_ENABLED`, `VITE_PHASE6_ADMIN_DRAFTS_UI`, `VITE_PHASE6_ADMIN_PUBLISH_UI` và xác nhận selector đúng Preview. **Không Add/Edit/Delete/Save/Reveal**; chỉ báo tên+giá trị plain-text, che tất cả secrets. Sau đó cân nhắc phê duyệt mở từng cờ (trước tiên chỉ Admin drafts) và bảo đảm deployment Preview thực sự dùng build mới. Không bật student timed exam/results, không merge PR36/đụng Production.

## Bước 207 — 4 biến Admin Phase6 không xuất hiện trong ảnh cấu hình Pages (operator screenshots 28/11/2026)

Operator chụp ba ảnh liên tiếp trang `Workers & Pages → duongtrcnhiem-test → Settings → Variables and secrets`, từ biến đầu đến cuối trước phần `Bindings`. Không thấy bốn biến cần thiết:
- `PHASE6_ADMIN_DRAFTS_ENABLED` (server API draft CRUD)
- `PHASE6_ADMIN_PUBLISH_ENABLED` (server API publish)
- `VITE_PHASE6_ADMIN_DRAFTS_UI` (Vite build-time UI draft)
- `VITE_PHASE6_ADMIN_PUBLISH_UI` (Vite build-time UI publish)

Trong ảnh vẫn có `VITE_PHASE6F_PWA_PREVIEW_UI=true`, `VITE_FIREBASE_ENV=staging`, các Phase4/5 flags và Firebase secrets. **Ảnh bị cắt khu vực header environment selector** nên cần chắc chắn selector đang ở **Preview** trước bất kỳ cấu hình ghi nào; không suy ra các biến tương tự có/không ở Production. Không được sao chép tên secret email/account vào log.

**Kết luận:** `ADMIN_PHASE6_FOUR_FLAGS_PRESENT: NO (based on visible complete list)`. `PHASE6_API_READY: NO`. Không có cờ cho API tạo đề, API publish hoặc hai UI tương ứng trong danh sách đang được xem.

**Kế hoạch bật từng bước, chờ operator thao tác:**
1. Xác nhận **Preview environment selector**; chỉ thêm `PHASE6_ADMIN_DRAFTS_ENABLED` text `true` trước, không đụng các biến khác. Mở server API draft cho signed Google Admin ở pinned Preview host; UI vẫn tắt.
2. Sau khi xác nhận đúng Preview và biến đã được lưu, thêm build-time `VITE_PHASE6_ADMIN_DRAFTS_UI=true`, sau đó triển khai lại đúng nhánh Preview `feature/staging-demo-quiz-pilot` để asset Vite mới đọc cờ; không redeploy Production. Kiểm tra deployment alias và auth signed Google Admin.
3. Chỉ test `action:list` khi backend/Frontend thực sự có flag; bảng drafts đang trống nên dự kiến danh sách `[]`. Không tạo/publish đề khi chưa qua chốt.
4. Publish server/UI flags `PHASE6_ADMIN_PUBLISH_ENABLED`, `VITE_PHASE6_ADMIN_PUBLISH_UI` giữ **OFF/chưa cấu hình**. Student timed/Student results/Admin results cũng OFF. Do chưa xác định đoạn ảnh có hiển thị chính xác Preview selector, **không bật biến trước khi kiểm tra**.

Cloudflare Pages docs về build-time vars và preview deployments: https://developers.cloudflare.com/pages/configuration/build-configuration/ và https://developers.cloudflare.com/pages/configuration/preview-deployments/ . No direct Cloudflare changes made by assistant.

## Bước 208–209 — Operator xác nhận đã thêm riêng cờ Admin drafts trên Pages Preview (28/11/2026)

Người vận hành chụp ảnh selector **Preview** và xác nhận bằng lời đã lưu `PHASE6_ADMIN_DRAFTS_ENABLED=true` (server runtime flag) rồi trả lời `đã thêm vite` sau hướng dẫn thêm `VITE_PHASE6_ADMIN_DRAFTS_UI=true` (build-time flag) vào **Workers & Pages → duongtrcnhiem-test → Settings → Preview → Variables and secrets**. Hai cờ được ghi nhận theo xác nhận operator, **chưa có ảnh liệt kê cặp cờ này sau Save** hoặc kiểm chứng chúng đã có hiệu lực trong deployment. Cờ xuất bản (`PHASE6_ADMIN_PUBLISH_ENABLED`, `VITE_PHASE6_ADMIN_PUBLISH_UI`) và ba cờ student/results vẫn OFF/chưa cấu hình.

**Gate `ADMIN_DRAFT_SERVER_AND_BUILD_FLAGS_CONFIGURED: OPERATOR_REPORTED`**, `PREVIEW_NEW_BUILD_WITH_FLAGS: PENDING`. Vite `import.meta.env.VITE_PHASE6_ADMIN_DRAFTS_UI` được biên dịch lúc build, nên phải có **build Preview mới của nhánh đúng** `feature/staging-demo-quiz-pilot`. Chỉ retry/rebuild deployment thuộc nhánh này, tuyệt đối không chọn Production hoặc merge PR36. Trên Cloudflare Pages → Deployments, chọn deployment **Preview** đúng branch và xem thao tác retry/build lại; nếu không có tùy chọn, cần bước riêng cho commit rỗng lên đúng branch (không thay code). Dừng trước nút không rõ nghĩa và gửi screenshot. Sau build thành công, xác minh alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` và Google Admin signed UI; bắt đầu bằng read-only `Tải danh sách bản nháp` dự kiến `0`. Không bấm tạo/publish trước nghiệm thu.

## Bước 211 — Retry Cloudflare Pages Preview báo Success, cần kiểm tra source branch (operator screenshot 28/11/2026)

Sau khi operator xác nhận đã thêm `PHASE6_ADMIN_DRAFTS_ENABLED=true` và `VITE_PHASE6_ADMIN_DRAFTS_UI=true` vào Settings Preview, họ dùng `Retry deployment` từ dòng commit `75f2d81` rồi gửi ảnh **All deployments**:
- Environment: `Preview`
- Commit: `75f2d81` (merge PR35)
- Deployment mới (hashed URL): `f9811742.duongtrcnhiem-test.pages.dev` (không xem URL hash là hostname được API cho phép).
- Status: success, a few seconds ago
- **Source cắt ngắn hiển thị `feature/phase7...`** (không phải rõ ràng `feature/staging-demo-quiz-pilot`).

Đối chiếu GitHub PR35: merge commit `75f2d814...` đã merge `feature/phase7k-offline-submit-recovery-20261127` vào `feature/staging-demo-quiz-pilot`. PR36 vẫn Draft, source branch là `feature/phase7l-recovery-acceptance-checklist-20261127`, base `feature/staging-demo-quiz-pilot`. Phải xác minh **full Source branch** trong Cloudflare Deployment details, không suy đoán từ commit hash. Code Phase6 chỉ chấp nhận **hostname alias cố định** `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`; hashed deployment URL không đủ quyền. Cloudflare Preview build Success không chứng minh hostname alias đã cập nhật, UI flags được đóng gói, hay signed Admin API hoạt động.

**Gate `PREVIEW_RETRY_BUILD_REPORTED_SUCCESS`: PASS; `PINNED_ALIAS_BRANCH_AND_UI_FLAGS_VERIFIED`: PENDING**. Bước 212: operator mở **Details** deployment mới `f9811742...` → chụp phần full Branch/Source và Aliases (nếu có), không lộ secrets. Nếu branch không đúng, không bấm Retry tiếp; xem xét tạo build mới từ đúng branch thay vì thay Production/merge PR36. Chưa bật `PHASE6_ADMIN_PUBLISH_ENABLED` hay ba Phase6 student/results flags, chưa thử POST API, không đổi D1 schemas nữa.

## Bước 212 — Đã xác nhận Alias đúng pinned Preview trên deployment mới (operator screenshots, 28/11/2026)

Operator gửi hai ảnh Cloudflare Pages **Deployment details** và **All deployments** của bản retry mới, được tạo **10:37 AM ngày 28/11/2026**:
- Environment badge `Preview`, Status `success`, Duration `13s`.
- Commit `75f2d81` (merge PR35 trên Staging branch).
- Deployment URL hashed `9f0b0595.duongtrcnhiem-test.pages.dev` **không phải host API Phase6 được cho phép**.
- **Aliases** hiển thị chính xác `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` — **trùng hostname pinned** trong `functions/_shared/phase4-host-guard.mjs` và `staging-db-binding.mjs` ở Staging.
- Branch trên card hiển thị rút gọn `feature/stagi...`, khớp tiền tố của `feature/staging-demo-quiz-pilot`; PR35 merge target đã xác minh là nhánh này. Ảnh không hiển thị *toàn bộ* branch tên dài.

**Gate `PINNED_PREVIEW_ALIAS_ON_SUCCESSFUL_RETRY: PASS`**. Gate `UI_BUILD_FLAG_EFFECTIVE` và `SIGNED_ADMIN_DRAFTS_LIST_RUNTIME` vẫn PENDING — Deployment Success **không chứng minh** Vite UI đã hiện hoặc API signed Admin trả 200. Hai flags `PHASE6_ADMIN_DRAFTS_ENABLED=true` và `VITE_PHASE6_ADMIN_DRAFTS_UI=true` mới có xác nhận lưu từ operator, chưa có ảnh kiểm chứng giá trị trên deployment runtime.

**Bước 213 (không ghi D1):** mở **alias pinned** `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` (không dùng hash URL), qua Cloudflare Access rồi đăng nhập Google Admin staging. Kiểm tra có khung **`Giai đoạn 6B — Ngân hàng đề nháp DEMO`**. Nếu có, chỉ bấm **`Tải danh sách bản nháp`** (API action list: truy vấn đọc-only, bảng drafts ở Bước206 là 0) rồi chụp giao diện/trạng thái; không bấm **Tạo đề nháp mới**, **Xuất bản** hoặc chỉnh các biến. Nếu không có panel hoặc trả lỗi: chụp màn hình và STOP; kiểm tra Preview build variables/host binding, không bật thêm cờ theo phỏng đoán. Publish/Student/Results server flags vẫn OFF, PR36 Draft, Production không đổi.

## Bước 213 — Admin chưa thấy khung Phase6B sau retry build, chuyển sang chẩn đoán read-only (28/11/2026)

Operator sau khi mở pinned Preview alias và đăng nhập Admin cho biết **"tôi ko thấy ở admin của tôi"**. Không có ảnh Admin ở lần báo này. Đây là **`PREVIEW_ADMIN_DRAFTS_UI_VISIBLE: FAIL/UNVERIFIED`**, chưa xác định nguyên nhân, **không** suy ra API/Admin login hay deploy hỏng.

Kiểm tra chính xác `src/App.tsx` ở nhánh `feature/staging-demo-quiz-pilot`: `Phase6AdminDraftsPanel` được render **sau toàn bộ `AdminPanel`**, chỉ trong `activeTab==='admin'` khi `currentUser.role==='admin'`, `adminAccessAllowed`, `firebaseUser` tồn tại và `isPhase6AdminDraftsUiEnabled(hostname, import.meta.env.VITE_PHASE6_ADMIN_DRAFTS_UI)`. `adminAccessAllowed` yêu cầu `cloudState.connected`, `cloudState.isCloudAdmin`, Firebase UID của Google Admin bootstrapped. Helper `isPhase6AdminDraftsUiEnabled` yêu cầu `IS_FIREBASE_STAGING`, cờ build-time `'true'`, hostname đúng pinned alias. **Panel không phải một tab menu riêng**; có thể cần kéo đến cuối tab Admin.

Bước chẩn đoán đầu tiên **không ghi dữ liệu**: dùng URL pinned `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`, vào Admin, kiểm tra Google Admin Cloud đã kết nối và kéo xuống cuối phần Admin; thử tải mới bằng `Ctrl+Shift+R` trên máy tính (PWA có thể đang dùng assets cũ) hoặc cửa sổ riêng nếu cần đăng nhập lại. Chụp ảnh đáy tab Admin + URL (che tài khoản) nếu không thấy. Chưa được nhấn tạo đề/publish, chưa thêm cờ mới, không chạy SQL, không retry Cloudflare deploy bừa bãi, không đụng Production.

Nếu vẫn không thấy sau hard refresh, cần kiểm tra bộ asset JS đã build với `VITE_PHASE6_ADMIN_DRAFTS_UI` thực tế thay vì suy ra từ Deployment Success; Vite flag compile lúc build. Xác minh từ Preview Build Logs và Variables and secrets / deployment env. Không tiết lộ JWT, Firebase secrets hoặc Cloudflare Access cookies.

## Bước 214 — Giao diện Admin Phase 6B vẫn không xuất hiện trong cửa sổ ẩn danh (operator, 28/11/2026)

Người vận hành đã dùng cửa sổ ẩn danh, qua Access, đăng nhập Google Admin, vào tab Admin trên pinned Preview, **vẫn không thấy** khung `Giai đoạn 6B — Ngân hàng đề nháp DEMO`. Điều này giảm khả năng chỉ vì cache browser/service worker của phiên trước. Không còn yêu cầu họ lặp lại refresh.

Đối chiếu **chính xác commit deployment `75f2d814b0ef70b5a4ae7118885cd2e0548e69a8`** trực tiếp qua GitHub:
- `src/App.tsx`: import/render `Phase6AdminDraftsPanel` tồn tại (sau AdminPanel trong tab admin), dựa vào `adminAccessAllowed && firebaseUser && isPhase6AdminDraftsUiEnabled(hostname,import.meta.env.VITE_PHASE6_ADMIN_DRAFTS_UI)`.
- `adminAccessAllowed` trên staging yêu cầu cloud connected + isCloudAdmin + UID Firebase Admin đúng; nếu thấy chính AdminPanel theo nhánh này, điều kiện `adminAccessAllowed` đã đúng, trừ khi giao diện họ thấy không phải `AdminPanel` đó.
- `src/utils/phase6AdminDrafts.ts` helper yêu cầu `IS_FIREBASE_STAGING && flag==='true' && isPhase5DemoPreviewHostname(hostname)`.
- `src/utils/phase5DemoTopics.ts` hostname cố định đúng alias operator chụp ở Bước212; `src/utils/firebaseStagingHost.ts` staging tự động theo host `*.duongtrcnhiem-test.pages.dev`.
- `package.json` build script `vite build`, `VITE_PHASE6_ADMIN_DRAFTS_UI` **được nhúng vào JS tại build-time**, nên chỉ Save runtime variable hoặc retry deployment không chứng minh flag đã có trong JS.

**Diagnosis: `UI_COMPONENT_PRESENT_AT_DEPLOYED_COMMIT: PASS`, `BROWSER_CACHE_ONLY_CAUSE: UNLIKELY`, `BUILT_VITE_FLAG_EFFECTIVE: UNKNOWN`; nguyên nhân còn cần điều tra là flag lưu sai/missing trong Preview, flag không đi vào build, hoặc quyền Admin UI chưa đúng.** Không tuyên bố root cause đã chắc chắn.

**Bước 215 nên ưu tiên chỉ đọc:** Operator mở Cloudflare Pages project `duongtrcnhiem-test` → Settings → đúng **Preview** → **Variables and secrets** và chụp/chỉ đọc đúng hai hàng plain-text `PHASE6_ADMIN_DRAFTS_ENABLED` và `VITE_PHASE6_ADMIN_DRAFTS_UI` (value cần là `true`, không có ngoặc kép/khoảng trắng); che mọi secrets. Nếu hai biến đúng, xem Deployment details của bản **10:37 28/11 commit 75f2d81** → Build log (chỉ chụp phần bước build và các dòng env variable **tên public**, tuyệt đối không chia sẻ giá trị secret hoặc dump toàn bộ env), để biết build có thực sự lấy biến Preview. Chưa sửa các cờ, chưa retry thêm, không test POST API, không merge PR36 hay đụng Production.

## Bước 215 — Hai biến Admin Drafts hiển thị true trong Preview (ảnh operator 28/11/2026)

Operator gửi hai ảnh chụp **Variables and secrets** chỉ có các hàng Text:
- Tên hiển thị bị cắt `PHASE6_ADMIN_DRAFTS_ENA...`, value hiện `true`.
- Tên hiển thị bị cắt `VITE_PHASE6_ADMIN_DRAFTS...`, value hiện `true`.

Ảnh xác nhận hai giá trị `true`, nhưng **tên đầy đủ chưa hiển thị** vì giới hạn chiều rộng input; không thể loại trừ lỗi ký tự/thiếu hậu tố `_ENABLED` hoặc `_UI`. Hai tên mã nguồn yêu cầu chính xác là `PHASE6_ADMIN_DRAFTS_ENABLED` (server) và `VITE_PHASE6_ADMIN_DRAFTS_UI` (build-time). Trước khi chỉnh biến/Retry, cần xác nhận **nguyên văn full-name** bằng copy Name field (không gửi secrets) hoặc click vào ô rồi bấm End và chụp phần cuối. Nếu khớp, chuyển sang kiểm tra logs từ **deployment Preview 28/11 lúc 10:37 (75f2d81)**; không suy ra flag Vite đã được biên dịch chỉ từ Settings hiển thị giá trị, và không dùng console in `process.env` hoặc keys Firebase.

**Gate `PREVIEW_ADMIN_DRAFT_FLAG_VALUES_VISIBLE_TRUE`: PASS; `FULL_VAR_NAMES_VERIFIED`: PENDING; `BUILT_UI_FLAG_EFFECTIVE`: PENDING.** Không sửa code, không thêm cờ khác, chưa thử POST hay thay đổi Production; PR36 Draft.

## Bước 216 — Full names of both Preview Admin flags confirmed by operator (28/11/2026)

Người vận hành xác nhận trực tiếp sau khi làm theo hướng dẫn copy tên biến: **"2 tên đều khớp"**. Đối chiếu với tên bắt buộc trong mã tại deployment commit `75f2d81`:
- `PHASE6_ADMIN_DRAFTS_ENABLED` đúng tên, Text value `true` trong ảnh Bước 215.
- `VITE_PHASE6_ADMIN_DRAFTS_UI` đúng tên, Text value `true` trong ảnh Bước 215.

**Gate `PREVIEW_ADMIN_DRAFT_FLAG_NAMES_AND_VALUES: PASS (operator reported + screenshot values)`.** Vẫn chưa có bằng chứng cờ Vite đã được đóng gói vào JS ở deployment `9f0b0595`, hoặc Google Admin UI guard đã thỏa mãn trong phiên browser. Không yêu cầu thêm, xóa, sửa hoặc retry hai flag lần nữa.

**Bước 217 read-only:** Cloudflare Pages `duongtrcnhiem-test` → **Deployments** → bản retry **Preview** commit `75f2d81` lúc **10:37 AM 28/11/2026** có alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` → **Details → Build log**. Kiểm tra lệnh Vite build chạy ở đúng Preview, log có cảnh báo env/build, có báo build success; chỉ chụp các dòng đầu/cuối và những lỗi/warnings liên quan build, **không** chụp/dán dòng chứa token, Firebase secrets, JWT, hoặc toàn bộ environment dump. Build log có thể **không** in riêng `VITE_PHASE6_ADMIN_DRAFTS_UI`; thiếu dòng tên flag trong log không chứng minh cờ vắng. Nếu build log bình thường, chẩn đoán tiếp asset bundle và kiểm tra `adminAccessAllowed` mà không kích hoạt POST/mutation.

Giữ mọi flags publish/student/results OFF, không đụng D1/Production, PR36 Draft.

## Bước 217 — Cloudflare Preview Build log stage statuses all green (operator screenshot, 28/11/2026)

Operator gửi ảnh thẻ **Build log** từ Deployment details. Ảnh hiển thị bốn giai đoạn có dấu tích xanh: `initialize`, `clone repo`, `build`, `deploy`. Ảnh **chưa mở rộng** các phần để xem output `vite build`, branch/commit/asset hash, cảnh báo build, hay environment injection.

**Gate `PREVIEW_BUILD_PIPELINE_STAGES: PASS (operator screenshot)`; `VITE_PHASE6_ADMIN_DRAFTS_UI_COMPILED: UNKNOWN`**. Không quy kết lỗi API/backend hay kết luận cache; cửa sổ ẩn danh cũng không hiện khung Admin 6B. Khả năng còn gồm build-time Vite flag không nhận, build artifact không lấy biến, hoặc Admin app-state guard.

**Bước 218 read-only:** operator nhấp vào hàng **build** (mở accordion) trong Build log của Preview deploy commit `75f2d81`, alias pinned; chụp đoạn hiện lệnh build `vite build`, warnings và kết quả cuối. Không chụp/copy JWT, Firebase key, Cloudflare Access cookie, nội dung .env đầy đủ; không nhấn Retry, không thêm biến, không chạy migration. Build log thành công cũng chưa đủ để xác nhận Vite flag; nếu log không có thông tin biến, chuyển sang chẩn đoán artifact `assets` hoặc UI auth guard trước khi sửa hệ thống.

## Bước 218 — Cloudflare Preview actual build log and env listing reviewed (screenshots, 28/11/2026)

Operator expanded **Build log** for Preview retry deployment. Three screenshots show:
- User command `bun install && bun run build`; `$ vite build` with **Vite v8.3.8**; 2371 modules transformed; produced `dist/index.html`, CSS and JS assets.
- Warning: Vite config uses an unsupported feature with native `configLoader` at `vite.config.ts:27:40`, suggestion `import.meta.dirname`; warning was suppressed by `VITE_CONFIG_NATIVE_IGNORE_WARNING=true`. No build-fatal error visible in screenshot, and deployment overall marked success.
- **Environment variables list for this build** includes exactly `PHASE6_ADMIN_DRAFTS_ENABLED = true` and `VITE_PHASE6_ADMIN_DRAFTS_UI = true`; also `VITE_FIREBASE_ENV = staging` and existing Phase4/Phase5 flags. This is stronger than Settings screenshot; variables were present in *deployment's displayed build environment*.
- Images display Firebase related variable names and public staging project identifier; **do not duplicate account/email/secret in this repo**.

**New gate:** `PREVIEW_BUILD_HAS_ADMIN_DRAFT_FLAGS: PASS (deployment env screenshot)`; `VITE_BUILD_SUCCEEDED: PASS`. **UI remains missing after incognito**. Native config warning cannot be blamed without evidence; no signs build failed. Next checks focus on actual client `App.tsx` condition:
`activeTab==='admin' && currentUser.role==='admin' && adminAccessAllowed && firebaseUser && isPhase6AdminDraftsUiEnabled(hostname,import.meta.env.VITE_PHASE6_ADMIN_DRAFTS_UI)`.
Staging `adminAccessAllowed` requires Cloud connected, Cloud Admin permission and Firebase UID exactly staging Admin. At correct pinned Preview host, `IS_FIREBASE_STAGING` is true by hostname. Vite flag is present in build environment but actual bundle's emitted value is still unverified.

**Bước 219 (no write, no secret):** operator opens pinned Preview alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`, enters Admin, captures screenshot that includes **URL and actual contents of Admin page** (including whether ordinary AdminPanel is shown), plus cloud connected status but obscures all private data. If AdminPanel is visible, `adminAccessAllowed` appears to be met and next investigation should inspect emitted JS asset in the browser (not repeat refresh/Retry). If only Admin tab without AdminPanel, investigate Google Firebase Admin connection / role rather than compile flags. Do not ask for tokens or secrets, change D1, enable publish/student/results, or merge PR36.

## Bước 219 — Ảnh operator cho thấy Cloud Storage modal, chưa chụp tab Admin (28/11/2026)

Operator gửi ảnh **Lưu trữ dữ liệu đám mây** trong Preview, hiển thị `Đã kết nối Firebase Firestore` và nhãn `Quản trị đám mây`, cùng kết quả đồng bộ 0 chuyên đề/0 lượt thi/0 tài khoản trong modal. Nền phía sau là trang `Mục Chuyên Đề Ôn Luyện & Kiểm Tra` (tab topics), **không phải tab Admin**. Ảnh có thông tin email tài khoản Google; **không lưu hay trích lại email**.

Đối chiếu `src/components/CloudStorageModal.tsx`: nhãn `Quản trị đám mây` là từ modal khi đã xác thực Google cloud admin; không riêng nó chứng minh UI đang ở `activeTab==='admin'`. Đối chiếu `src/components/Navbar.tsx` tại đúng deploy commit `75f2d81`: nút menu `Quản Trị` được hiện chỉ khi `currentUser.role==='admin' && adminAccessAllowed`. `src/App.tsx` chỉ render `Phase6AdminDraftsPanel` trên tab admin và đúng cờ UI/host. Modal che phần lớn thanh điều hướng nên không thể xác định nút Quản Trị từ ảnh.

**Gate `GOOGLE_CLOUD_CONNECTED`: observed PASS**, **`CURRENT_TAB_IS_ADMIN`: NO (screenshot shows Topics under modal)`**; **`APP_INTERNAL_ADMIN_AUTHORIZED`: unverified from screenshot**. Không còn kết luận chắc chắn lỗi build/Vite. Bước kế tiếp duy nhất: operator **đóng modal bằng nút X (không chọn `Ngắt kết nối`)**, chụp thanh menu trang sau khi đóng; nếu có tab `Quản Trị` thì nhấn tab và cuộn xuống cuối, xem `Giai đoạn 6B — Ngân hàng đề nháp DEMO`; nếu không có tab thì chụp thanh menu/username (che thông tin cá nhân), kiểm tra app internal role/Cloud Admin guard trước khi làm gì khác. Không đăng xuất hoặc đòi mật khẩu/token, không thêm biến, không retry deploy, không thử POST, không sửa D1/Production.

## Bước 220–221 — Phase6B Admin draft UI visible on pinned Preview (operator screenshot, 28/11/2026)

Sau khi hướng dẫn operator đóng Cloud Storage modal rồi vào đúng tab `Quản Trị`, operator xác nhận **"tôi thấy 6b r"**. Operator sau đó gửi screenshot khung **`Giai đoạn 6B — Ngân hàng đề nháp DEMO`**, với hai nút `Tải danh sách bản nháp`, `Tạo đề nháp mới` và form tạo nháp `Tên chuyên đề DEMO` (mặc định `Toán học DEMO - Cơ bản`), trường `Thời gian làm bài (1–240 phút)` mặc định **15**, nút chọn nhanh **15/30/45/60 phút**, thông báo thay đổi thời gian không kéo dài phiên đã bắt đầu.

**Gate `PREVIEW_ADMIN_PHASE6B_UI_VISIBLE: PASS (screenshot)`**, chứng minh frontend hiển thị panel khi vào đúng tab Admin trên Preview. Lỗi "không thấy" trước đó nhiều khả năng do modal Cloud Storage che tab/topics context, nhưng không khẳng định nguyên nhân duy nhất. Vite Preview build flags đã xuất hiện trong deployment config ở Bước218; runtime signed Admin API **chưa được nghiệm thu**.

**Bước 222 an toàn đọc-only:** từ UI đã hiện, bấm **`Tải danh sách bản nháp`** (POST action `list`, chỉ SELECT trên D1 theo mã `functions/_shared/phase6-synthetic-admin-drafts.mjs`). Vì Bước206 xác nhận `phase6_admin_drafts=0`, kỳ vọng `Bản nháp DEMO: 0` và `Chưa có bản nháp nào`. Nếu báo lỗi/403/404/503, chụp cảnh báo trên giao diện, không thêm flags/ghi thử. **Không bấm `Tạo đề nháp mới` hoặc publish cho tới khi list đạt**; giữ publish/student/results flags OFF, PR36 Draft và Production không thay đổi. UI tùy chỉnh thời gian 1–240 phút đã xuất hiện, nhưng chưa xác minh persistence/server runtime.
