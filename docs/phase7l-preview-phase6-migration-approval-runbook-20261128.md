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
