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

## Bước 222 — Preview Admin Phase6B signed list trả 0 bản nháp (operator screenshot, 28/11/2026)

Operator bấm `Tải danh sách bản nháp` trong khung Admin 6B trên pinned Preview và gửi ảnh giao diện có `Bản nháp DEMO: 0` / `Chưa có bản nháp nào.`, không hiển thị lỗi. So với Bước206 D1 Preview `phase6_admin_drafts=0`, kết quả khớp kỳ vọng.

Mã nguồn đúng commit đã triển khai `75f2d81`: `src/utils/phase6AdminDrafts.ts` gọi `POST /api/phase6/admin/drafts` với `{action:'list'}`, gửi Firebase signed Admin ID token; `functions/_shared/phase6-synthetic-admin-drafts.mjs` action `list` dùng `SELECT` và không ghi D1. Do đó **gate `PREVIEW_ADMIN_PHASE6B_SIGNED_LIST_SMOKE_TEST: PASS`** trên UI, với giới hạn chưa kiểm chứng HTTP status độc lập qua DevTools. Cả giao diện Admin 6B và API đọc nháp đều đã hoạt động.

**Bước 223 (operator action, ghi dữ liệu DEMO đã được chấp thuận trong phạm vi thử nghiệm):** chỉ trên pinned Preview với signed Google Admin và tab Quản Trị, giữ `Tên chuyên đề DEMO: Toán học DEMO - Cơ bản` và `Thời gian làm bài: 15 phút`, bấm `Tạo đề nháp mới` **một lần**. Mã action `create` chèn 1 bản nháp `p6_demo_...` vào `phase6_admin_drafts` với `minutes=15`, `templates_json='[]'`, revision=1, không tạo ấn phẩm, phiên thi, bài nộp, và không đụng 8 bảng dữ liệu gốc. Sau khi có thông báo `Đã tạo bản nháp DEMO mới. Chưa được xuất bản.`, gửi ảnh, không tự bấm lại nếu API có lỗi/timeout vì có thể đã tạo thành công nhưng client mất phản hồi. Hậu kiểm tiếp là đọc lại draft, bổ sung câu mẫu/sửa thời gian theo kế hoạch nghiệm thu. Giữ publish/student/results API flags OFF, PR36 Draft, không đụng Pages Production.

## Bước 223 — Lần thử tạo Phase6B draft đầu tiên báo lỗi, **chưa xác minh ghi D1** (operator screenshot, 28/11/2026)

Sau khi `action:'list'` trả `Bản nháp DEMO: 0` (Bước222), operator thử nút **Tạo đề nháp mới** (mặc định title `Toán học DEMO - Cơ bản`, minutes `15`). Screenshot tiếp theo cho thấy UI vẫn ghi `Bản nháp DEMO: 0` (đây có thể là state cũ chưa refresh) và alert đỏ `Máy chủ chưa thể lưu hoặc đọc bản nháp DEMO.` Chưa có thông báo `Đã tạo bản nháp`. Đây là lỗi generic của client khi POST `/api/phase6/admin/drafts` trả không thành công, **không chứng minh transaction INSERT chưa commit**. Không retry action create.

### Chẩn đoán mã nguồn tại deployed commit `75f2d814...`

`functions/_shared/phase6-synthetic-admin-drafts.mjs`:
- `SQL_INSERT`: `INSERT INTO phase6_admin_drafts (...) SELECT ?,?,?, '[]',1,... WHERE (SELECT count(*)...)<100`.
- `changed(result)`: `result?.success===true` và `meta.changes` integer, **throw `PHASE6_D1_WRITE_UNEXPECTED` khi `result.meta.changes > 1`**.
- Migration `serverless/d1-phase6b-synthetic-admin-drafts-draft.sql`: trigger `phase6_admin_draft_created` **AFTER INSERT** tự ghi thêm **1 row** vào `phase6_admin_draft_events`.
- Cloudflare D1 REST API docs mô tả `meta.changes` là ước lượng số row thay đổi theo `sqlite3_total_changes()` của SQLite. SQLite `total_changes` **bao gồm các hàng ghi trong trigger**, khác `changes()` chỉ đếm direct statement. Vì vậy nếu D1 `.run()` báo `meta.changes=2` cho một draft và một audit event, `changed()` sẽ throw **sau khi insert đã commit**, endpoint `failSafe()` 503, browser chỉ hiện lỗi chung. Đây là **giả thuyết kỹ thuật có căn cứ cao**, chưa phải root cause được chứng minh trên remote vì chưa có `meta` hay state DB sau thử.
- Cần lưu ý `rows_written` bao gồm các bản ghi chỉ mục, không phải `meta.changes`. Không sửa code/remote trước khi xác minh trạng thái.

**Bước 224 — truy vấn read-only tại đúng `duongtrcnhiem-auth-preview`:**
```sql
SELECT
 (SELECT COUNT(*) FROM phase6_admin_drafts) AS drafts,
 (SELECT COUNT(*) FROM phase6_admin_draft_events) AS events,
 (SELECT COUNT(*) FROM phase6_admin_draft_events WHERE event_type='create') AS creates;
```
Ban đầu Bước206 cả hai bảng bằng 0. Nếu `drafts=1,events=1,creates=1`, xác nhận INSERT+trigger hoạt động, API kiểm tra sai giả thuyết rất hợp lý; nếu vẫn `0,0,0` cần đọc log runtime/SQL lỗi server được redacted, không giả định nguyên nhân. Bất kỳ sai khác nào: STOP, điều tra trước khi retry.

Chưa sửa code, chưa chạy INSERT/UPDATE/DELETE từ SQL Studio, chưa bật flags publish/student/results hay thay đổi Production. PR36 Draft; sửa code chỉ qua nhánh review/test riêng sau khi có bằng chứng.

## Bước 224 — D1 Preview xác nhận create đã commit dù UI lỗi + PR37 sửa trigger-inclusive changes (operator screenshot, 28/11/2026)

Operator đã chạy truy vấn read-only trên `duongtrcnhiem-auth-preview` ngay sau lỗi create Bước223:
```sql
SELECT
 (SELECT COUNT(*) FROM phase6_admin_drafts) AS drafts,
 (SELECT COUNT(*) FROM phase6_admin_draft_events) AS events,
 (SELECT COUNT(*) FROM phase6_admin_draft_events WHERE event_type='create') AS creates;
```
Ảnh D1 Studio hiển thị **`drafts=1`, `events=1`, `creates=1`**. Kết hợp Bước206 có 0/0 trước đó, xác nhận lần thử tạo nháp đã **ghi một draft và một event** dù frontend báo lỗi. Không còn được retry Create vì có thể tạo trùng bản nháp. Chưa xét dữ liệu nháp có thể sửa/xóa qua UI.

Tài liệu Cloudflare D1 `meta.changes` dựa trên `sqlite3_total_changes()` (https://developers.cloudflare.com/api/resources/d1/); SQLite total_changes bao gồm trigger (https://www.sqlite.org/c3ref/total_changes.html). `functions/_shared/phase6-synthetic-admin-drafts.mjs` đang reject `meta.changes>1`, vì vậy một direct row + một audit trigger row rất có khả năng dẫn đến báo 503 **sau commit**. Đây là chẩn đoán từ source/schema + DB state, chưa có log thực tế của `PHASE6_D1_WRITE_UNEXPECTED`.

**PR sửa riêng:** [PR37](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/37) Draft, nhánh `feature/phase6b-d1-audit-change-count-fix-20261128`, base `feature/staging-demo-quiz-pilot`. Thay đổi helper `changed()` để chấp nhận `meta.changes` bằng 1 hoặc 2 (vẫn chặn 0, invalid và >2); cập nhật test Phase6B/6C để mock `meta.changes` bằng chênh lệch `total_changes()` và test tạo/lưu/xóa đều đúng 2 thay đổi. **PR37 chưa merge, chưa deploy và CI chưa xác nhận PASS khi ghi phần này.**

**Bước 225 read-only:** operator vào tab Admin trên pinned Preview, bấm `Tải danh sách bản nháp` **một lần**, kỳ vọng `Bản nháp DEMO: 1`; xem tiêu đề, thời gian 15 phút. Không bấm Tạo đề, không bấm Xóa, không chỉnh thời gian/lưu cho đến khi PR37 CI/review và deployment Preview mới được xác minh. Không đụng Production, D1 schema hay API publish/student/results; PR36 vẫn Draft.

## Bước 225 — Đã xác minh API list đọc lại bản nháp DEMO có thật sau lỗi create (operator screenshot, 28/11/2026)

Sau khi D1 Studio Bước224 trả `drafts=1`, `events=1`, `creates=1`, người vận hành quay lại pinned Preview Admin và bấm `Tải danh sách bản nháp`. Screenshot hiển thị:
- `Bản nháp DEMO: 1`.
- `Toán học DEMO - Cơ bản`.
- `15 phút · 0 câu · bản sửa 1`.

Đây là xác nhận hồi đọc (read-after-write) qua **UI/API signed Google Admin**, khớp với SQL D1. **Gate `PREVIEW_PHASE6B_DRAFT_PERSISTED_AND_READBACK: PASS`**; **gate `PREVIEW_PHASE6B_CREATE_API_RESPONSE_SUCCESS: FAIL`**, vì client báo lỗi trước đó dù ghi thành công. Không bấm tạo lần nữa, không tự xóa/sửa cho tới khi kiểm thử bản fix.

Kiểm tra [PR37](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/37): nhánh sửa `feature/phase6b-d1-audit-change-count-fix-20261128`, base `feature/staging-demo-quiz-pilot`, **Draft**, chưa merge, tại commit `f2a0afdbc9962ffeddb7968e1dc107cd214f3d0c`. Có ba file changed: backend helper và test Phase6B/6C. GitHub tool không trả CI statuses hay PR-triggered Actions runs ở thời điểm truy vấn, vì vậy **không được tuyên bố test PASS**; cần operator mở tab Checks/Actions để xác minh và nếu thiếu check, chạy test an toàn trên nhánh sửa trước merge.

**Bước 226:** mở PR37, chụp tình trạng checks/merge gate, tuyệt đối không merge/deploy trước khi test khẳng định. Không cần chạy SQL migration hay thử Create lại. Giữ publish/student/results flags OFF, Production và PR36 Draft không thay đổi.

## Bước 226 — PR37 Cloudflare preview deploy green; isolated staging CI outcome not yet confirmed (operator screenshot, 28/11/2026)

Operator mở [PR37 Checks](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/37) và chụp:
- PR `#37` still **Draft**, 3 commits proposed from `feature/phase6b-d1-audit-change-count-fix-20261128` into `feature/staging-demo-quiz-pilot`.
- Tab `Checks 2`.
- `Cloudflare Workers and Pages / Cloudflare Pages` (green) with **Deployed successfully**, commit `f2a0afd`, hashed Preview URL `f081b072.duongtrcnhiem-test.pages.dev` and **branch Preview URL** (not pinned operational alias). This verifies build for the **fix branch**, **not the pinned staging branch**. Do not test signed Admin APIs at the fix branch hostname; host allowlist will reject.
- Separate `Staging DEMO Quiz Pilot (isolated)` **on: push** row appears with a notice/annotation count `1`, row **not expanded in photo**. It is **not possible to determine pass/fail of CI from this screenshot alone**. Must expand/check job details before approving merge.

GitHub connector confirmed `PR37 draft=true`, `merged=false`, base staging, `mergeable=true`, head `f2a0afdbc9962ffeddb7968e1dc107cd214f3d0c`. No combined statuses returned; connector's commit-workflow query lists only PR-triggered runs and this CI is triggered by push; absence of tool results does **not** imply tests passed or failed.

**Gate `PR37_CLOUDFLARE_FIX_BRANCH_BUILD: PASS`; `PR37_ISOLATED_CI: PENDING_EVIDENCE`; `PR37_READY_TO_MERGE: NO`** pending isolated test verified green. Next operator expands `Staging DEMO Quiz Pilot (isolated)` and captures status and failing step/annotation if any. Do not click Re-run checks blindly, do not merge PR37/PR36 yet, do not create duplicate draft or change D1. Publish/student/results flags OFF, Production untouched.

## Bước 227 — CI `demo-quiz-ci` của PR37 được người vận hành xác nhận PASS (ảnh 28/11/2026)

Operator mở rộng mục `Staging DEMO Quiz Pilot (isolated)` (on: push) trên tab Checks của [PR37](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/37) và gửi ảnh hiện **dấu tích xanh tại job `demo-quiz-ci`**. Ảnh trước đó Bước226 cũng cho thấy **Cloudflare Pages** succeeded cho commit `f2a0afd` ở nhánh fix riêng. **Gate `PR37_ISOLATED_CI: PASS (screenshot)`**, `PR37_FIX_BRANCH_CLOUDFLARE_BUILD: PASS`; các trạng thái khác/chi tiết từng test step không hiển thị riêng. Dấu số 1 bên cạnh workflow có thể là annotation, không phủ định trạng thái xanh của job nhưng chưa được kiểm tra nội dung annotation.

GitHub API `fetch_pr` xác nhận PR37 vẫn **Draft, open, merged=false, mergeable=true**, base `feature/staging-demo-quiz-pilot`, commit cuối `f2a0afdbc9962ffeddb7968e1dc107cd214f3d0c`. **Không tự merge** hoặc thay đổi Cloudflare; chỉ đề xuất chuyển Ready for review sau xem lại diff 3 file. Sau khi người vận hành phê duyệt và merge PR37 vào staging, chờ đúng preview pinned alias deploy, đọc lại bản nháp hiện có (không tạo trùng) trước khi thử save/update. PR36 vẫn Draft, Production chưa thay đổi.

## Bước 228 — PR37 ready for review, all checks green and mergeable (operator screenshot, 28/11/2026)

Operator gửi ảnh phần merge gate PR37:
- `All checks have passed` với **2 successful checks**.
- `No conflicts with base branch`, merging can be performed automatically.
- Nút xanh `Merge pull request` và đường dẫn `Convert to draft`: chứng minh PR đã rời Draft.

Đối chiếu GitHub connector `fetch_pr`:
- PR37 `state=open`, `draft=false`, `merged=false`, `mergeable=true`.
- Base chính xác `feature/staging-demo-quiz-pilot`, head `feature/phase6b-d1-audit-change-count-fix-20261128`, SHA `f2a0afdbc9962ffeddb7968e1dc107cd214f3d0c`.
- Chỉ đổi 3 file: `functions/_shared/phase6-synthetic-admin-drafts.mjs`, `tests/phase6b-admin-drafts-http.test.mjs`, `tests/phase6c-synthetic-publish-http.test.mjs`.

**Gate `PR37_READY_TO_MERGE: PASS`**, operator được hướng dẫn tự bấm `Merge pull request` rồi `Confirm merge` trên PR37, **chưa xác nhận đã merge** tại thời điểm ghi. Không tự merge bằng API. Sau operator xác nhận merge, phải đợi và kiểm tra đúng pinned Preview alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` nhận merge commit mới, mở UI Admin 6B → `Tải danh sách bản nháp` → bản nháp 15 phút/0 câu v1 vẫn còn, rồi mới thử save/update. Không bấm `Tạo đề nháp mới` lần nữa; không bật publish/student/results flags hoặc thay Production; PR36 vẫn Draft.

## Bước 229 — PR37 đã merged vào staging (operator screenshot và GitHub verified, 28/11/2026)

Operator gửi screenshot GitHub `Pull request successfully merged and closed`. GitHub connector **xác minh** [PR37](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/37) `state=closed`, `merged=true`, `merged_at=2026-11-28T07:27:29Z`, merge SHA **`1182512574e03b68abf22e38ca7ef1494616c49a`**, base `feature/staging-demo-quiz-pilot`. `functions/_shared/phase6-synthetic-admin-drafts.mjs` trên nhánh staging bây giờ có fix `result.meta.changes>2` thay vì `>1`, đã đối chiếu blob SHA `03fe5b8bf42f74ebf670868ead76a740f7b3d84f`. [PR36](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/36) **vẫn Draft, chưa merged**.

**Gate `PR37_MERGED_TO_STAGING: PASS`, `STAGING_SOURCE_HAS_D1_TRIGGER_CHANGE_FIX: PASS`.** **Chưa có bằng chứng Cloudflare Pages pinned Preview alias đã deploy commit `1182512`** hoặc bản sửa đã hoạt động trên runtime. Chưa thực hiện API write/retry.

**Bước 230:** Cloudflare Workers & Pages → `duongtrcnhiem-test` → Deployments → All deployments, tìm **Preview** có đúng nhánh `feature/staging-demo-quiz-pilot` và commit `1182512` (merge PR37), status Success. Mở Details kiểm tra **Aliases** `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`. Nếu chưa có đúng commit/alias, STOP; không Retry deployment bản cũ hay tự push, không dùng URL preview ngẫu nhiên. **Bước 231 sau gate:** mở đúng pinned Preview → Google Admin → Quản Trị → Giai đoạn 6B → `Tải danh sách bản nháp`, kỳ vọng 1 `Toán học DEMO - Cơ bản`, 15 phút, 0 câu, sửa 1. Không `Tạo đề nháp mới`; chỉ sau khi xác minh commit mới mới thử Save phiên bản 2 qua UI. Ba cờ publish/student/results vẫn OFF, Production không đổi. Không xóa nhánh fix trong lúc rà soát nếu không cần.

## Bước 230 — Cloudflare pinned Preview triển khai PR37 merge SHA thành công (operator screenshot, 28/11/2026)

Người vận hành gửi ảnh **Deployment details** Cloudflare Pages với:
- Environment **Preview**, Deployment ID `f0f49da8-0fd7-4cbd-884e-6438d245b4ac`, hashed URL `f0f49da8.duongtrcnhiem-test.pages.dev` (không dùng hashed URL để test signed API).
- Alias chính xác `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` — đúng pinned host.
- Branch rút gọn `feature/stagi...`, commit `1182512` (`Merge pull request #37`) — đúng SHA merge `1182512574e03b68abf22e38ca7ef1494616c49a` đã xác nhận GitHub.
- Status `success`, 2:27 PM November 28, 2026; Duration 14s.

**Gate `PR37_PINNED_PREVIEW_MERGE_DEPLOY: PASS (operator screenshot)`**, không suy ra API write được nghiệm thu tự động. Code sửa `changed()` chấp nhận `meta.changes=1` hoặc `2` đã merged vào đúng staging và deployed; script cũ vẫn hiện lỗi trước deployment khi create đã commit. Bản nháp từ Bước225 (`Toán học DEMO - Cơ bản`, **15 phút, 0 câu, phiên bản 1**) phải giữ nguyên.

**Bước 231 chỉ đọc:** mở pinned alias trên Chrome với Google Admin, vào Quản Trị → Giai đoạn 6B → bấm `Tải danh sách bản nháp`, kỳ vọng **1**; bấm `Chỉnh sửa` của **bản nháp hiện có**, chỉ thực hiện `action:'get'` qua API. Kỳ vọng editor hiện **Chỉnh sửa bản nháp · phiên bản 1** và **15 phút**, **0 câu**. Không bấm `Tạo đề nháp mới`, `Lưu bản nháp`, `Xóa` hay `Xuất bản` ở Bước231. Chỉ sau khi read-back PASS mới kiểm thử save trên Preview để xác nhận fix thực tế. Giữ các flags publish/student/results OFF, Production không đổi, PR36 Draft.

## Bước 231 — Read-only `get` cho bản nháp Phase6B sau PR37 deployment PASS (operator screenshot, 28/11/2026)

Operator chọn **Chỉnh sửa** với bản nháp đã tồn tại trên pinned Preview sau khi PR37 merge/build thành công. Screenshot Admin Phase6B hiển thị **`Chỉnh sửa bản nháp · phiên bản 1`**, `Toán học DEMO - Cơ bản`, `Thời gian làm bài: 15`, `Câu hỏi toán học giả (0/12)`; có các preset 15/30/45/60, `Thêm câu mẫu`, `Lưu thay đổi vào D1 Preview`. Dòng trạng thái `Đang chỉnh sửa bản nháp DEMO đã chọn.`. Không có lỗi hiện trong hình. **Gate `PHASE6B_EXISTING_DRAFT_READBACK_AFTER_FIX: PASS`**, chỉ read-only; `PHASE6B_WRITE_AFTER_FIX: PENDING`.

**Bước 232 (một lần ghi DEMO trên đúng pinned Preview, dùng bản nháp hiện tại, không tạo mới):** đổi preset thời gian **15→30 phút**; không thêm câu mẫu, giữ title; chỉ bấm **`Lưu thay đổi vào D1 Preview` đúng 1 lần**. Code server cho phép `templates=[]`; `save` sẽ UPDATE 1 row có optimistic `version=1` và trigger audit ghi thêm 1 row, fix `meta.changes<=2` hỗ trợ D1. Kỳ vọng UI báo `Đã lưu bản nháp Toán học DEMO - Cơ bản. Chưa xuất bản.`, version→2, minutes→30, question count 0. Nếu UI báo lỗi, **không retry**, chạy read-only list / get để xác định write đã commit chưa. Chưa publish, xóa, tạo thêm đề, chạy migration hay đổi Cloudflare settings; PR36 còn Draft, Production vẫn không thay đổi.

## Bước 232 — Phase6B save time 15→30 phút PASS trên pinned Preview sau PR37 (operator screenshot, 28/11/2026)

Operator trong Admin Phase6B đã mở bản nháp hiện có (`Toán học DEMO - Cơ bản`, trước đó 15 phút, 0 câu, version 1) và bấm `30 phút` rồi `Lưu thay đổi vào D1 Preview` đúng một lần. Screenshot trả về:
- Tiêu đề editor **`Chỉnh sửa bản nháp · phiên bản 2`**.
- `Thời gian làm bài` hiện **30**.
- `Câu hỏi toán học giả (0/12)`.
- Thông báo màu xanh **`Đã lưu bản nháp Toán học DEMO - Cơ bản. Chưa xuất bản.`**.

Điều này xác minh **`PHASE6B_POST_PR37_SAVE_UI_RESPONSE: PASS`** trên pinned staging Preview, cho thấy API update không còn báo lỗi kiểu đếm trigger như trước. Ảnh **chưa đủ xác nhận dữ liệu đã tồn tại qua một yêu cầu đọc mới độc lập**; cần làm thêm Bước233 read-only bằng `Tải danh sách bản nháp` rồi `Chỉnh sửa` lại bản nháp hiện có, kỳ vọng **version 2, 30 phút, 0 câu**. Không bấm tạo nháp mới hoặc lưu nhiều lần, không thêm câu hỏi/publish trước khi readback PASS.

PR37 đã merged vào staging và pinned Preview đã deploy commit `1182512`; PR36 Draft, API publish/student/results OFF, Production không thay đổi.

## Bước 233 — Phase6B read-after-write list confirms 30 minutes persisted (operator screenshot, 28/11/2026)

Sau Bước232 lưu thành công một lần, operator bấm `Tải danh sách bản nháp` và gửi ảnh phần danh sách UI:
- `Bản nháp DEMO: 1`.
- `Toán học DEMO - Cơ bản`.
- `30 phút · 0 câu · bản sửa 2`.

**Gate `PHASE6B_30MIN_LIST_READBACK: PASS (operator screenshot)`**: bản nháp hiện có được API list trả về với đúng thời gian 30 phút và version 2 sau khi thay đổi từ 15 phút v1. Bước233 đã yêu cầu bấm `Chỉnh sửa` thêm để thực hiện `get` độc lập; **ảnh lần này chỉ chứng minh list, chưa có ảnh editor get mới**. Không tuyên bố đã nghiệm thu create API sau sửa PR37 chỉ từ save/list; lỗi tạo báo 503 trước đó đã được phân tích và mã đã chỉnh.

**Bước 234 (một thao tác sửa DEMO có kiểm soát):** Trong pinned Preview, Admin 6B chọn `Chỉnh sửa` bản nháp duy nhất, xác nhận editor đang ở version 2 / 30 phút, chọn câu toán học giả `2 + 2 = ?`, bấm `Thêm câu mẫu` **một lần** (UI local, chưa ghi D1), sau đó `Lưu thay đổi vào D1 Preview` **một lần duy nhất**. Mong đợi version 3, 30 phút, 1 câu và thông báo lưu thành công. Nếu lỗi/timeout, STOP, không retry save; chỉ list lại để phân biệt commit/response. Không tạo bản nháp mới, không publish, không bật cờ publish/student/results, PR36 Draft, Production không đổi. Sau save PASS cần list/get readback để xác minh đủ trường và không rò khóa đáp án.

## Bước 234 — 1 câu toán học giả được thêm trong editor, chưa xác nhận lưu D1 (operator screenshot, 28/11/2026)

Operator gửi ảnh phần chỉnh sửa Phase6B, mục `Câu hỏi toán học giả (1/12)` với dòng `1. 2 + 2 = ?`. Các nút `Lên`, `Xuống`, `Bỏ câu` và `Thêm câu mẫu` hiển thị. Đây là xác nhận **state giao diện đã thêm một câu mẫu**, **chưa có ảnh/lệnh cho thấy nút `Lưu thay đổi vào D1 Preview` được bấm hoặc backend trả thành công**. Không tuyên bố D1 có version 3 hay đã ghi 1 câu chỉ dựa vào ảnh.

**Gate `PHASE6B_ONE_SAMPLE_QUESTION_EDITOR: PASS (screenshot)`; `PHASE6B_SAMPLE_QUESTION_PERSISTENCE: PENDING`.** Hướng dẫn operator giữ 30 phút, bấm `Lưu thay đổi vào D1 Preview` chỉ **1 lần**, kỳ vọng version 3, 30 phút, 1 câu, notice đã lưu và chưa xuất bản. Nếu lỗi, STOP không retry; dùng list read-only để kiểm chứng. Cờ publish/student/results vẫn OFF, PR36 Draft, Production không thay đổi.

## Bước 234 — UI list confirms 30 minutes, 1 question, version 3 (operator screenshot, 28/11/2026)

Operator tiếp tục sau khi thêm câu mẫu `2 + 2 = ?` và thao tác lưu vào D1 Preview. Screenshot mới trong danh sách Phase6B hiển thị **`Bản nháp DEMO: 1`** / **`Toán học DEMO - Cơ bản`** / **`30 phút · 1 câu · bản sửa 3`**. Kết hợp Bước234 trước `0/12` tại version 2, kết quả phù hợp một lần lưu thay đổi thành công.

**Gate `PHASE6B_1QUESTION_VERSION3_LIST_READBACK: PASS (operator screenshot)`**. Ảnh này xác minh **count/time/version qua UI danh sách**, **chưa kiểm tra lại nội dung câu hỏi qua `get` độc lập** và chưa chứng minh ấn phẩm/phiên thi. Không suy diễn đã có đề được published.

**Bước 235 an toàn/read-only:** trên pinned Preview tab Admin → Giai đoạn 6B, bấm `Chỉnh sửa` bản nháp duy nhất; xác minh tiêu đề `Chỉnh sửa bản nháp · phiên bản 3`, thời gian `30`, danh sách có `1. 2 + 2 = ?` (`1/12`). Chụp ảnh; **không bấm Lưu/Xóa/Tạo đề mới**. Nếu PASS, lên kế hoạch riêng để bật `PHASE6_ADMIN_PUBLISH_ENABLED` và `VITE_PHASE6_ADMIN_PUBLISH_UI` chỉ ở Preview sau khi xem xét quyền và scope; không bật cờ student/results đồng thời. PR36 Draft; Production không thay đổi.

## Bước 235 — Xác minh nội dung bản nháp Phase6B qua editor read-after-write (operator screenshot, 28/11/2026)

Operator bấm `Chỉnh sửa` bản nháp đã lưu sau Bước234 và gửi screenshot: title `Toán học DEMO - Cơ bản`, minutes `30`, `Câu hỏi toán học giả (1/12)`, danh sách hiển thị `1. 2 + 2 = ?`. Nút `Lưu thay đổi vào D1 Preview` cùng trạng thái `Đang chỉnh sửa bản nháp DEMO đã chọn.` hiển thị. Screenshot editor cắt mất phần title version; Bước234 UI list ngay trước có `30 phút · 1 câu · bản sửa 3`. Kết hợp hai ảnh cho phép **`PHASE6B_DRAFT_CONTENT_READBACK: PASS`** đối với nội dung câu DEMO, 30 phút và version 3 theo list trước đó. Không có publication hoặc bài thi được báo thực hiện.

### Trước Phase6C publish

Đối chiếu mã trên `feature/staging-demo-quiz-pilot`: `functions/api/phase6/admin/publish.js` đòi **cả** `PHASE6_ADMIN_PUBLISH_ENABLED='true'` và `PHASE6_ADMIN_DRAFTS_ENABLED='true'`; yêu cầu đúng pinned Preview host, Firebase signed Google Admin và `AUTH_DB_PREVIEW`. `src/components/Phase6AdminDraftsPanel.tsx` chỉ hiện khung publish khi `VITE_PHASE6_ADMIN_PUBLISH_UI='true'` trong Preview build; có checkbox xác nhận explicit. Phương thức publish của `functions/_shared/phase6-synthetic-publication.mjs` ghi 1 transaction vào Phase5 topics/version/question/key và Phase6 publication, immutable. **Không thể thu hồi revision đã published thông qua UI này**. `phase6_admin_publications` ở Bước206 là 0; chưa có kết quả mới sau chỉnh nháp, kỳ vọng 0 nhưng không suy ra là đã xác minh.

**Bước 236**: trước tiên chỉ cấu hình server publication flag `PHASE6_ADMIN_PUBLISH_ENABLED=true` ở **Settings → Preview → Variables and secrets**, loại Text; không sửa Production/Bindings hay secrets. **Không bấm xuất bản khi chưa có UI build đúng**; giữ `VITE_PHASE6_ADMIN_PUBLISH_UI` OFF/chưa cấu hình cho đến bước tiếp theo. Cờ student timed exams, student readonly results, admin results giữ OFF. Đảm bảo user hiểu việc publish sẽ ghi revision DEMO không thể sửa/xóa về sau và xác minh baseline trước khi nhấn publish. PR36 còn Draft; PR37 đã merged staging, Production không đổi.

## Bước 236 — Operator báo đã thêm Preview server publish flag (28/11/2026)

Người vận hành phản hồi **"đã thêm Publish"** sau hướng dẫn Cloudflare Workers & Pages `duongtrcnhiem-test` → Settings → **Preview** → Variables and secrets, thêm biến Text `PHASE6_ADMIN_PUBLISH_ENABLED=true`. **Trạng thái: operator-confirmed only**, chưa có ảnh của biến sau Save hoặc deployment runtime. Cờ `PHASE6_ADMIN_DRAFTS_ENABLED=true` trước đó đã được kiểm chứng và API draft list/save hoạt động trên pinned Preview.

**Gate `PREVIEW_PHASE6C_PUBLISH_SERVER_FLAG_OPERATOR_REPORTED: YES`; `UI_PUBLISH_BUILD_EFFECTIVE: PENDING`; `PHASE6C_PUBLICATION_EXECUTED: NO`.** Giữ PR36 Draft và các student/results server flags OFF. Chưa nhấn nút publish hoặc thay đổi đề, không dùng đề thật, không đổi Production.

**Bước 237:** Chỉ trong `Settings → Preview → Variables and secrets`, thêm biến Text `VITE_PHASE6_ADMIN_PUBLISH_UI=true` sau khi xác nhận selector Preview. Operator chưa báo đã thêm ở thời điểm này. Biến VITE được đóng gói lúc build, cần **deployment Preview mới từ nhánh `feature/staging-demo-quiz-pilot`** và verify pinned alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`. Trước khi thao tác publish thực tế cần kiểm tra chính xác published baseline (0 ở Bước206), revision 3, 30 phút, 1 câu toán học DEMO, bản phát hành sẽ là bất biến. Không cấp quyền student timed exam sớm.

## Bước 237 — Operator báo đã thêm Preview Vite publish UI flag (28/11/2026)

Người vận hành báo **"đã thêm VITE Publish"** sau hướng dẫn thêm `VITE_PHASE6_ADMIN_PUBLISH_UI=true` (Text) trong Cloudflare Pages `duongtrcnhiem-test` → Settings → **Preview** → Variables and secrets. Bước236 server `PHASE6_ADMIN_PUBLISH_ENABLED=true` cũng chỉ operator-reported; **chưa có screenshot xác nhận hàng biến sau Save hoặc deployment mới có biến ở build env**. `PHASE6_ADMIN_DRAFTS_ENABLED=true` và `VITE_PHASE6_ADMIN_DRAFTS_UI=true` đã được kiểm chứng hoạt động ở các bước trước.

Đối chiếu mã `feature/staging-demo-quiz-pilot`: `src/App.tsx` cung cấp `canPublish={import.meta.env.VITE_PHASE6_ADMIN_PUBLISH_UI === 'true'}` cho Phase6AdminDraftsPanel. Cờ `VITE_` **bắt buộc build Preview mới** mới làm panel 6C xuất hiện. Endpoint server `functions/api/phase6/admin/publish.js` kiểm `PHASE6_ADMIN_PUBLISH_ENABLED` cùng `PHASE6_ADMIN_DRAFTS_ENABLED`, pinned Preview host, Google Admin signed và Preview D1 binding.

**Gate `PREVIEW_PHASE6C_PUBLISH_UI_FLAG_OPERATOR_REPORTED: YES`**; `NEW_PREVIEW_BUILD_WITH_UI_FLAG: PENDING`; `PHASE6C_PUBLISHED_DEMO: NO`. **Bước 238**: Cloudflare Pages `duongtrcnhiem-test` → Deployments → chọn **Preview** nhánh `feature/staging-demo-quiz-pilot`, commit merge PR37 `1182512` → dấu `...` → `Retry deployment` (không Delete, không Production). Sau retry verify **success** và `Aliases: feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`, build env có `VITE_PHASE6_ADMIN_PUBLISH_UI=true` và `PHASE6_ADMIN_PUBLISH_ENABLED=true` (nếu có thể xem mà không lộ secrets), sau đó vào Admin kiểm tra có khung 6C, **chưa bấm Xuất bản**. Không cần sửa DB, không tạo thêm draft, không bật student/results flags, PR36 Draft, Production nguyên trạng.

## Bước 238 — Cloudflare Preview Retry sau khi thêm cờ giao diện Phase6C Success (operator screenshot, 28/11/2026)

Sau khi operator báo đã thêm `PHASE6_ADMIN_PUBLISH_ENABLED=true` và `VITE_PHASE6_ADMIN_PUBLISH_UI=true` vào môi trường Preview, operator chạy Retry đúng deployment Preview commit PR37 `1182512` và gửi ảnh **Deployment details**:
- Environment `Preview`, Status `success`, thời điểm **3:04 PM November 28, 2026**, Duration `14s`.
- Deployment ID `6ebc2107-040f-4187-8c32-0468c815ff55`, hashed URL `6ebc2107.duongtrcnhiem-test.pages.dev`.
- **Aliases:** `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`, đúng pinned staging Preview alias.
- Branch card viết rút gọn `feature/stagi...`, commit `1182512` (merge PR37).
- `Build settings` có **18** dòng cấu hình, nhưng ảnh **chưa mở ra** để xác nhận từng giá trị biến mới.

**Gate `PHASE6C_PINNED_PREVIEW_RETRY_SUCCESS: PASS (operator screenshot)`**, **`PHASE6C_PUBLISH_UI_VISIBLE: PENDING`**, **`PHASE6C_PUBLICATION_EXISTS: NOT YET CONFIRMED`**. Không suy ra đã xuất bản đề chỉ từ deployment thành công; không thử API ghi trước UI gate.

**Bước 239 read-only:** mở `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` (không dùng hash URL), Google Admin → Quản Trị → Giai đoạn 6B → `Tải danh sách bản nháp` → **Chỉnh sửa** bản nháp sẵn có `Toán học DEMO - Cơ bản` (30 phút, 1 câu, revision 3). Cuộn trong editor để tìm khung **`6C — Duyệt xuất bản bản toán học DEMO`**, chụp ảnh khung nếu có; **chưa đánh dấu checkbox xác nhận, chưa bấm Xuất bản**. Nếu không thấy, chụp ảnh và sau đó kiểm tra Build settings/environment variables cho Preview; không thêm/sửa/cài lại gì theo phỏng đoán. Cờ student exam/results OFF, PR36 Draft, Production không đổi.

## Bước 239 — Phase6C publish UI hiện trên pinned Preview, chưa thao tác xuất bản (operator screenshot 28/11/2026)

Sau khi Cloudflare retry Preview với cờ publish đã được operator thêm, người vận hành gửi screenshot từ khu vực chỉnh sửa bản nháp Phase6B với panel **`6C — Duyệt xuất bản bản toán học DEMO`**, cảnh báo lưu thay đổi trước và phiên bản xuất bản bất biến. Checkbox `Tôi xác nhận đây chỉ là đề toán DEMO và đã kiểm tra nội dung` vẫn **unchecked**. Nút `Xuất bản phiên bản toán học DEMO` đang **disabled**. **Không có thông báo publication receipt, chưa có bằng chứng đã publish**.

**Gate `PHASE6C_PUBLISH_UI_VISIBLE: PASS (operator screenshot)`; `PHASE6C_SERVER_FLAG_EFFECTIVE: NOT TESTED`; `PHASE6C_PUBLICATION: NOT YET EXECUTED`.** Đây là bằng chứng Vite UI mới đã hiện qua pinned Preview, không đồng nghĩa API server trả thành công.

**Bước 240 read-only pre-publication gate:** Cloudflare D1 → `duongtrcnhiem-auth-preview` → Explore Data → Query, chạy **chỉ SELECT** để xác minh đúng một draft với version 3, 30 phút, 1 câu và chưa có publication:
```sql
SELECT
  (SELECT COUNT(*) FROM phase6_admin_publications) AS publications,
  COUNT(*) AS drafts,
  MIN(title_code) AS title_code,
  MIN(minutes) AS minutes,
  MIN(version) AS version,
  MIN(json_array_length(templates_json)) AS questions
FROM phase6_admin_drafts;
```
Kỳ vọng `publications=0, drafts=1, title_code=basic, minutes=30, version=3, questions=1`. Bảng Phase6C đang trống ở Bước206 nhưng **chưa có pre-publish baseline mới**, nên không giả định 0 nếu SQL chưa chạy. Nếu không khớp: STOP, không xuất bản hoặc thêm dữ liệu.

Sau gate preflight đạt và có chỉ dẫn riêng thì mới đánh dấu checkbox DEMO và bấm publish **đúng một lần**. Không chia sẻ JWT/secret/đáp án riêng tư, không enable student timed-exam/results, không chạm Production, PR36 Draft.

## Bước 240 — Phase6C prepublication D1 Preview read-only baseline PASS (operator screenshot, 28/11/2026)

Operator chạy đúng truy vấn SELECT prepublish gate tại `duongtrcnhiem-auth-preview`:
```sql
SELECT
 (SELECT COUNT(*) FROM phase6_admin_publications) AS publications,
 COUNT(*) AS drafts,
 MIN(title_code) AS title_code,
 MIN(minutes) AS minutes,
 MIN(version) AS version,
 MIN(json_array_length(templates_json)) AS questions
FROM phase6_admin_drafts;
```
Ảnh D1 Studio `phase6_admin_publications · 6×1` trả **`publications=0`, `drafts=1`, `title_code=basic`, `minutes=30`, `version=3`, `questions=1`**. Các giá trị khớp kỳ vọng và nội dung readback Bước235 (một câu toán học mẫu `2 + 2 = ?`). Gate **`PHASE6C_PREPUBLICATION_READONLY_BASELINE: PASS (operator screenshot)`**. Ở thời điểm ảnh, **chưa xuất bản**.

**Bước 241 (operator-controlled single write, Preview DEMO only):** trên pinned Preview alias `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` → Google Admin → Quản Trị → Phase6B, tải danh sách và mở **bản nháp duy nhất**, đảm bảo đúng `Toán học DEMO - Cơ bản`, 30 phút, 1 câu, revision 3. Không thay đổi dữ liệu, không bấm Lưu. Tại `6C — Duyệt xuất bản bản toán học DEMO`, tick **chỉ** checkbox `Tôi xác nhận đây chỉ là đề toán DEMO và đã kiểm tra nội dung`; bấm `Xuất bản phiên bản toán học DEMO` **chỉ một lần**. Sau đó chụp thông báo/receipt; mong đợi `Đã xuất bản revision 3 vào D1 Preview.` và publication metadata `revision=3`, `questionCount=1`, `timeLimitSeconds=1800`. Nếu timeout/lỗi, **không bấm lại**, kiểm tra database read-only vì transaction có thể đã commit. Không bật student API/results trước khi publication được xác nhận. Publish tạo metadata và bản snapshot Phase5 bất biến; không có thao tác thu hồi trong UI hiện tại.

**Bước 242 sau đó (chỉ đọc)** kiểm `phase6_admin_publications`, `phase5_content_versions` và `phase5_content_questions` cho draft id hiện tại (tránh hiển thị đáp án/khoá trong screenshot), `PRAGMA quick_check`, `PRAGMA foreign_key_check` trước khi bật student timed exam. Giữ Production và PR36 Draft nguyên trạng.

## Bước 241 — UI xác nhận publication revision 3 đã tồn tại sau lỗi mạng và retry (operator screenshot, 28/11/2026)

Operator sau khi bấm publish trên pinned Preview gặp lỗi mạng; sau đó thử lại rồi gửi screenshot panel `6C — Duyệt xuất bản bản toán học DEMO` hiển thị:
- `Đã xác nhận phiên bản 3 được lưu cố định ở máy chủ.`
- `Phiên bản này đã xuất bản trước đó, không tạo bản sao.`
- checkbox xác nhận publish đang bỏ chọn và nút publish disabled.

Theo `src/components/Phase6AdminDraftsPanel.tsx`, thông báo thứ hai đến từ API trả receipt với `created=false`, client đã parse `publication` với revision=3 và set state `publishedRevision`. Theo `functions/_shared/phase6-synthetic-publication.mjs`, `priorPublication` SELECT đúng bản published của draft + revision, nếu tồn tại trả `created:false`. **Gate `PHASE6C_RETRY_ACKNOWLEDGED_EXISTING_REVISION3: PASS (operator screenshot)`**. Bằng chứng cho thấy hệ thống nhận biết publication tồn tại và không tạo một publication cùng draft+revision lần nữa, **chưa chứng minh toàn bộ D1 không chứa bản phát hành khác**.

Bước 242 **read-only** trên đúng D1 `duongtrcnhiem-auth-preview` kiểm bản phát hành có 30 phút, 1 câu, 1 answer key; không hiển thị draft_id, đáp án hoặc Google UID:
```sql
SELECT
  p.revision,
  v.state,
  v.time_limit_seconds,
  (SELECT COUNT(*) FROM phase5_content_questions q
   WHERE q.topic_id=p.draft_id AND q.revision=p.revision) AS questions,
  (SELECT COUNT(*) FROM phase5_content_answer_keys k
   WHERE k.topic_id=p.draft_id AND k.revision=p.revision) AS answer_keys,
  (SELECT COUNT(*) FROM phase6_admin_publications) AS total_publications
FROM phase6_admin_publications p
JOIN phase5_content_versions v
  ON v.topic_id=p.draft_id AND v.revision=p.revision;
```
Kỳ vọng **đúng 1 hàng**: `revision=3`, `state=published`, `time_limit_seconds=1800`, `questions=1`, `answer_keys=1`, `total_publications=1`. Nếu khác, STOP, không retry publish. Sau khi pass mới tiếp tục `PRAGMA quick_check` và `PRAGMA foreign_key_check` rồi cân nhắc thử student exam theo phase gate riêng.

Không bật student/results flags, không chạy bất kỳ SQL sửa dữ liệu nào, PR36 còn Draft, Production không đổi.

## Bước 242 — Published Phase6C revision 3 verified in Preview D1 (operator screenshot, 28/11/2026)

Operator chạy read-only SELECT nối `phase6_admin_publications` với `phase5_content_versions` và đếm câu hỏi/answer keys tại `duongtrcnhiem-auth-preview`; ảnh D1 Studio hiển thị **đúng 1 hàng**:
- `revision=3`
- `state=published`
- `time_limit_seconds=1800` (30 phút)
- `questions=1`
- `answer_keys=1`
- `total_publications=1`

**Gate `PHASE6C_PUBLICATION_D1_READBACK: PASS (operator screenshot)`**. Đã xác minh phiên bản published có đủ 1 câu và 1 private answer key, không đưa giá trị đáp án đúng ra log. Bước241 loss-of-response retry hiển thị publication đã có, không tạo thêm bản sao.

**Bước 243 (chỉ đọc)** kiểm tra `PRAGMA quick_check;` mong đợi một hàng `ok`, và `PRAGMA foreign_key_check;` mong đợi **0 hàng**, đúng **D1 Preview** sau xuất bản. Chạy từng câu riêng biệt trong D1 Studio; không chạy sửa schema, không lặp publish. Nếu toàn vẹn PASS, mới xem xét lần lượt bật API Phase6D Student timed-exam trong Preview với auth/host isolation; giữ ba cờ student/results OFF cho đến bước chuẩn bị riêng. PR36 Draft và Production không đổi.

## Bước 243 — D1 Preview sau Phase6C publish quick_check và FK check PASS (operator-confirmed, 28/11/2026)

Sau Bước242 đã thấy `revision=3`, `state=published`, `time_limit_seconds=1800`, 1 câu, 1 answer key, 1 publication trên `duongtrcnhiem-auth-preview`, operator làm hai phép kiểm tra read-only theo hướng dẫn Bước243:
- `PRAGMA quick_check;` — operator phản hồi **PASS**, hiểu là `ok`.
- `PRAGMA foreign_key_check;` — operator phản hồi **PASS**, hiểu là **0 hàng lỗi**.

**Gate `PHASE6C_POST_PUBLISH_DB_INTEGRITY: PASS (operator reported)`**, chưa có ảnh mới cho hai câu PRAGMA. Chỉ xác nhận phạm vi nghiệm thu D1 xuất bản và API Admin; chưa xác nhận Phase6D student runtime, deadline/submit, multi-device, Phase6E results.

### Gate để mở Phase6D từ mã hiện tại

Đối chiếu trực tiếp tại `feature/staging-demo-quiz-pilot`:
- `functions/api/phase6/exam.js` yêu cầu server-side `PHASE6_STUDENT_TIMED_EXAM_ENABLED === 'true'` và host pinned Preview, `PHASE4_PREVIEW_HOST_OPT_IN`, `PHASE4_STAGING_HOSTNAME`, D1 `AUTH_DB_PREVIEW`, signed DEMO Firebase student đang active; mặc định OFF.
- `src/App.tsx` trong tab `topics` chỉ hiển thị `Phase6StudentExamPanel` cho app `currentUser.role==='student'`, Firebase user với UID khớp `currentUser.id`, và `VITE_PHASE6_STUDENT_TIMED_UI === 'true'`; `src/utils/phase6StudentExam.ts` còn kiểm đúng staging/pinned hostname. Flag UI `VITE_` là build-time.
- Student panel có nút `Tải danh sách đề thi DEMO` (read-only `action:list`) trước nút `Mở đề` (read-only) và `Bắt đầu làm bài` (ghi phiên 30 phút bằng đồng hồ server). **Không bấm bắt đầu hoặc submit** trước khi phân biệt quyền A/B và list.
- `functions/_shared/staging-db-binding.mjs`: yêu cầu đúng pinned alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`; hashed URL không được bind Preview D1. Schema Phase6D và publication đã vượt qua các bước migration/hậu kiểm trước.

**Bước 244 riêng biệt:** trên Cloudflare Pages `duongtrcnhiem-test` → **Settings → Preview → Variables and secrets**, kiểm tra chưa có biến trùng; chỉ Add `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` kiểu Text (server API). **Không thêm `VITE_PHASE6_STUDENT_TIMED_UI` lúc này** và chưa retry/rebuild, chưa gọi API bằng student; cờ Phase6E `PHASE6_RESULTS_READONLY_ENABLED`, `PHASE6_ADMIN_RESULTS_ENABLED`, UI history/results vẫn OFF/chưa cấu hình. Hạn chế thử nghiệm tài khoản DEMO được ủy quyền, không dùng đề thật. Không gộp PR36, không chạm Production/main, không chạy SQL mới.

## Bước 244 — Operator xác nhận đã thêm cờ API Phase6D ở Pages Preview (28/11/2026)

Người vận hành phản hồi **"đã thêm phase 6D"** sau hướng dẫn thêm Text `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` trong `Workers & Pages → duongtrcnhiem-test → Settings → Preview → Variables and secrets`. **Operator-reported**, chưa có ảnh xác minh lưu tên đầy đủ hoặc biến thực sự xuất hiện trong deployment. Chỉ thêm cờ API server; không suy ra đã bật giao diện học viên hoặc rằng API student đã PASS.

**Gate `PHASE6D_SERVER_FLAG_OPERATOR_REPORTED: YES`; `PHASE6D_UI_FLAG: PENDING`; `PHASE6D_STUDENT_LIST: NOT_TESTED`.** Bước 245: trên đúng **Preview**, trước tiên kiểm tra biến chưa tồn tại rồi thêm Text `VITE_PHASE6_STUDENT_TIMED_UI=true` (client build-time) và Save, không sửa Production/Bindings. Sau đó cần **build Preview mới** từ đúng branch `feature/staging-demo-quiz-pilot` (merge PR37 SHA `1182512` nếu vẫn là deploy mới nhất), verify pinned alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` và biến có trong build environment trước kiểm tra UI student. Đăng nhập DEMO student đã được ủy quyền, tab topics, thử **`Tải danh sách đề thi DEMO`** read-only; **chưa bấm `Bắt đầu làm bài`** cho tới khi list/host/role được nghiệm thu. Giữ Phase6E results/history/admin flags OFF, PR36 Draft, Production không đổi.

## Bước 245 — Operator xác nhận Vite Phase6D Student UI đã thêm ở Preview (28/11/2026)

Người vận hành phản hồi `đã thêm vite 6D` theo hướng dẫn Cloudflare Pages `duongtrcnhiem-test` → Settings → **Preview** → Variables and secrets, Text `VITE_PHASE6_STUDENT_TIMED_UI=true`. Trước đó Bước244 operator xác nhận cờ backend `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true`. Hai cờ có xác nhận bằng lời, **chưa có screenshot build environment hoặc kiểm chứng runtime**.

**Gate `PHASE6D_FRONTEND_UI_FLAG_OPERATOR_REPORTED: YES`**, `PHASE6D_NEW_PREVIEW_BUILD: PENDING`, `PHASE6D_STUDENT_READ_ONLY_LIST: PENDING`. Mã tại `feature/staging-demo-quiz-pilot` render `Phase6StudentExamPanel` trên tab topics khi `currentUser.role==='student'`, Firebase student UID trùng app UID và Vite cờ UI đúng `true`, hostname pinned Preview. Bản build mới cần thiết để nhận `VITE_` flag.

**Bước 246**: operator mở Cloudflare Pages `duongtrcnhiem-test` → Deployments, chọn Preview đúng nhánh `feature/staging-demo-quiz-pilot` với commit merge PR37 `1182512` (nếu vẫn là latest staging) và chọn **Retry deployment**, không Delete hay chạm Production; xác nhận deployment thành công + pinned alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` và hai cờ có trong build env. Sau đó chỉ đăng nhập học viên DEMO được ủy quyền để tải danh sách đề thi đã xuất bản (`action:'list'`), kỳ vọng revision 3, 30 phút, 1 câu. **Không nhấn `Bắt đầu làm bài` ở bước kiểm tra này**: sẽ tạo phiên thi D1, bắt đầu tính giờ ngay theo server. Cờ Phase6E lịch sử/điểm OFF; PR36 Draft, Production nguyên trạng.

## Bước 246 — Cloudflare Preview Phase6D UI flag rollout deployed successfully (operator screenshot, 28/11/2026)

Operator sau khi xác nhận thêm `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` và `VITE_PHASE6_STUDENT_TIMED_UI=true` ở Pages `duongtrcnhiem-test` Preview đã thực hiện retry deployment và gửi ảnh **Deployment details**:
- **Preview**, success, **3:21 PM November 28, 2026**, 14s.
- Commit **`1182512`** (`Merge pull request #37`), source branch card hiển thị rút gọn `feature/stagi...`.
- Deployment ID **`a64d3328-604b-491f-a12f-6a73d5d27e8f`**; hashed URL `a64d3328.duongtrcnhiem-test.pages.dev` không dùng cho API auth.
- **Aliases** chính xác `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
- Build settings hiện **20** mục, không mở rộng trong ảnh nên **chưa trực tiếp xác minh tên/giá trị hai cờ 6D trong build environment**.

**Gate `PHASE6D_PINNED_PREVIEW_RETRY_SUCCESS: PASS (operator screenshot)`; `PHASE6D_STUDENT_UI_VISIBLE: PENDING`; `PHASE6D_STUDENT_API_READONLY_LIST: PENDING`.** Deployment success không chứng minh student UI hoặc API đã hoạt động.

**Bước 247**: mở đúng pinned alias bằng tài khoản học viên DEMO hợp lệ đã dùng trong thử nghiệm (không dùng Google Admin để tìm student UI), vào tab `Mục Chuyên Đề` / `topics` và tìm section `Phase 6D — Thi toán học DEMO có thời hạn` (trong code `src/App.tsx` chỉ render nếu `currentUser.role==='student'`, Firebase UID khớp app UID, đúng staging preview host và cờ `VITE_PHASE6_STUDENT_TIMED_UI==='true'`). Nếu thấy, chỉ nhấn **`Tải danh sách đề thi DEMO`**, kỳ vọng đúng bản phát hành `Toán học DEMO - Cơ bản`, **version 3 / 1 câu / 30 phút**; chụp ảnh. Nếu chưa thấy, chụp ảnh tab topics và tình trạng đăng nhập; không thêm cờ hay retry bừa.

**CỰC KỲ QUAN TRỌNG:** Không bấm `Bắt đầu làm bài (máy chủ tính giờ)` tại Bước247, vì sẽ tạo phiên D1 mới và bắt đầu đồng hồ 1800 giây ngay; không bấm submit, chưa bật Phase6E results flags. PR36 Draft, Production và main không thay đổi.

## Bước 247 — Operator báo student thấy 3 chuyên đề cũ nhưng không thấy đề 6D (28/11/2026)

Sau khi Cloudflare pinned Preview retry thành công cho server/UI 6D flags, operator đăng nhập học viên DEMO và nói **"học viên demo không có thứ ta yêu cầu chỉ có 3 chuyên đề ban đầu mà thôi"**, chưa có screenshot vị trí cuối trang.

Đối chiếu `src/App.tsx` trực tiếp trên `feature/staging-demo-quiz-pilot`: 3 chuyên đề ban đầu được `TopicsView` render trước; phần **`Phase6StudentExamPanel` là section riêng đặt ngay *sau* `TopicsView` trong `activeTab==='topics'`**, không phải thẻ chuyên đề mới thứ tư. Panel chỉ render khi `currentUser.role==='student'`, `firebaseUser` tồn tại, `currentUser.id===firebaseUser.uid`, `isPhase6StudentExamUiEnabled(host,import.meta.env.VITE_PHASE6_STUDENT_TIMED_UI)` trả true. Helper yêu cầu `IS_FIREBASE_STAGING`, flag `'true'` và hostname pinned alias. Khung nếu hiển thị có tiêu đề **`Phase 6D — Thi toán học DEMO có thời hạn`** và nút **`Tải danh sách đề thi DEMO`**.

**Gate `PHASE6D_STUDENT_UI_VISIBLE: UNVERIFIED/OPERATOR_NOT_FOUND`**; không tự kết luận API bug hoặc deployment hỏng. Bước đọc giao diện đầu tiên: trên pinned Preview với học viên DEMO, tab `Mục Chuyên Đề`, **kéo dưới cả ba chuyên đề** hoặc nhấn `Ctrl+F` tìm `Phase 6D`; nếu có, chỉ bấm `Tải danh sách đề thi DEMO` (read-only). Nếu không, chụp ảnh cuối trang và nút/tab login với thông tin cá nhân che mờ để xác nhận student app role/UID vs flag; kiểm tra Build settings/Env của đúng deployment trước khi Retry hoặc sửa flag. **Không bấm Bắt đầu làm bài**, không đụng D1 hoặc Production, không thêm student results flags, PR36 Draft.

## Bước 247 — Ảnh toàn trang học viên vẫn chưa hiển thị Phase6D (operator screenshot 28/11/2026)

Operator gửi screenshot giao diện `Mục Chuyên Đề Ôn Luyện & Kiểm Tra` trên tài khoản tên bắt đầu `test_hv_` (một học viên DEMO), thanh top hiển thị badge `Đã lưu đám mây`, tabs `Mục Chuyên Đề`, `Hồ Sơ & Lịch Sử`, `Bảng Tuyên Dương`, ba cards chuyên đề CD-01/02/03. Phần ảnh đến dưới 3 cards (khoảng trắng), **không có khung `Phase 6D — Thi toán học DEMO có thời hạn`**. Screenshot **không gồm thanh địa chỉ browser**, không có bằng chứng URL hiện tại là pinned Preview. Không ghi lại username cụ thể vào hồ sơ.

Code `src/App.tsx` trên Staging cho thấy `TopicsView` đứng trước `Phase6StudentExamPanel` ở cùng tab; `TopicsView.tsx` chỉ render ba cards và không chứa section 6D. Guard hiển thị: `currentUser.role==='student'`, `firebaseUser` tồn tại, `currentUser.id===firebaseUser.uid`, `IS_FIREBASE_STAGING`, hostname pinned và `import.meta.env.VITE_PHASE6_STUDENT_TIMED_UI==='true'`. `src/utils/serverlessAuth.ts` `loginWithStagingUsername` signInWithCustomToken rồi kiểm user UID == account.id. Badge `Đã lưu đám mây` trên Navbar chỉ phản ánh `cloudState.connected`, **không tự xác minh UID khớp hoặc build-time flag**. Ở lần operator chụp màn hình, 6D vẫn không hiển thị.

**Gate `PHASE6D_STUDENT_UI_VISIBLE: FAIL/NOT_FOUND`, `CAUSE: UNKNOWN`**. Chẩn đoán kế tiếp an toàn:
1. Xác nhận URL đang mở chính xác `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` (ảnh hiện tại không có address bar).
2. Trên Cloudflare Pages `duongtrcnhiem-test` → Deployments → đúng Preview `a64d3328`, commit `1182512` lúc 15:21 28/11/2026 → **Details → Build settings** mở và kiểm tra hai hàng tên/giá trị `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` và `VITE_PHASE6_STUDENT_TIMED_UI=true` trong biến môi trường thuộc **deployment** (không chỉ Settings hiện tại), `VITE_FIREBASE_ENV=staging`. Chụp riêng hai hàng nếu có, không chụp secrets.
3. Nếu host/flags đúng và vẫn không có UI sau mở lại pinned alias, xem browser profile đang dùng app cũ hoặc inspect auth currentUser UID == Firebase UID bằng phép kiểm an toàn, **không yêu cầu gửi UID/token/secret**.

Chưa bật Phase6E results, không bấm bắt đầu thi, không chạy SQL, không retry trước khi biết nguyên nhân, không thay đổi Production/main; PR36 Draft.

## Bước 248 — Cả hai cờ Phase6D hiện true trong Build settings của Preview (operator screenshots, 28/11/2026)

Operator mở `Build settings` trong đúng deployment Preview đã báo success commit `1182512` lúc 15:21, gửi 2 ảnh:
- `VITE_PHASE6_STUDENT_TIMED_UI = true` (chính xác cả tên và giá trị, bên cạnh cờ 6C)
- `PHASE6_STUDENT_TIMED_EXAM_ENABLED = true` (chính xác cả tên và giá trị, bên cạnh cờ 6C)

**Gate `PHASE6D_DEPLOYMENT_BUILD_ENV_FLAGS_VISIBLE_TRUE: PASS (operator screenshots)`**, loại trừ lỗi sai tên/giá trị trong build environment nhìn thấy. **Không tự suy ra đã được nạp vào bundle runtime** nhưng Vite build previously confirmed successful. Student screenshot Bước247 không chứa browser address bar, vì thế **hostname hiện tại chưa được xác minh**. Mã `src/utils/phase5DemoTopics.ts` hardcodes `PHASE5_STUDENT_PREVIEW_HOST = 'feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev'`, `isPhase5DemoPreviewHostname(hostname)` yêu cầu **strict string equality**. `src/utils/phase6StudentExam.ts` uses `IS_FIREBASE_STAGING && flag==='true' && isPhase5DemoPreviewHostname(host)`. Do đó nếu học viên mở project root `duongtrcnhiem-test.pages.dev` hoặc URL hash `a64d3328.duongtrcnhiem-test.pages.dev`, sẽ không thấy UI 6D dù cả 2 flag đang true. Cloud badge không xác nhận current hostname hay UID equality.

**Bước 249 (read-only, một chi tiết duy nhất):** hỏi operator nhìn thanh địa chỉ **ngay trong tab học viên hiện thấy 3 chuyên đề** và xác nhận hostname có đúng y hệt pinned alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` (không gửi query params/tokens). **Không đóng tab hoặc đăng xuất**, không Retry, không thêm biến, không bấm Bắt đầu làm bài. Nếu host sai, mở đúng pinned alias để kiểm tra UI; nếu đúng mà UI vẫn mất, tiếp tục diagnose `currentUser.id===firebaseUser.uid` versus old cached PWA/browser build with non-sensitive diagnostics, không yêu cầu user cung cấp UID, token, passwords.

## Bước 249 — pinned hostname đúng; nghi Firebase custom student/Google Admin auth va chạm giữa cửa sổ Chrome Incognito (operator screenshot, 28/11/2026)

Operator gửi screenshot toàn cửa sổ Chrome đang ở **chính xác** `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`, trang `Mục Chuyên Đề`, đăng nhập `test_hv_...`, badge `Đã lưu đám mây`, chỉ có 3 cards; Phase6D không hiện. Thanh Chrome trên ảnh có **`Ẩn danh (2)`**, theo Chrome Help nghĩa là có **nhiều cửa sổ ẩn danh cùng phiên Chrome**, sử dụng chung dữ liệu phiên. Theo Firebase Auth web, trạng thái login `local` mặc định được đồng bộ giữa các tab cùng browser profile/origin (https://firebase.google.com/docs/auth/web/auth-state-persistence). Code `src/App.tsx` yêu cầu `currentUser.id===firebaseUser.uid` khi render Phase6StudentExamPanel; `src/utils/serverlessAuth.ts` đăng nhập `test_hv_` bằng Firebase `signInWithCustomToken`, nhưng một tab Admin cùng Chrome Incognito đang dùng Google Firebase có thể chuyển `firebaseUser` sang Admin trong các tab mà `currentUserId` browser app vẫn là học viên. Tình trạng này có thể làm khung student không hiện, trong khi `cloudState.connected` vẫn true. **Đây là giả thuyết có căn cứ, không phải kết luận root cause**: operator chưa xác nhận có Admin đang login trong cửa sổ ẩn danh thứ hai.

Đã loại trừ từ operator screenshot: hostname pinned sai (NO), cả cờ `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` và `VITE_PHASE6_STUDENT_TIMED_UI=true` ở deployment build settings (PASS), UI tab topics đúng (PASS). Next step ít rủi ro: **giữ nguyên tab học viên Chrome hiện tại để không mất phiên/password**; mở **Microsoft Edge InPrivate** (không cùng storage với Chrome) và đăng nhập riêng `test_hv_` DEMO bằng credential sẵn có, vào pinned alias → topics → tìm Phase6D. Để Admin ở Chrome thường, **không đăng nhập Admin và học viên trong nhiều cửa sổ Chrome ẩn danh**; nếu không còn mật khẩu DEMO, dừng để chọn cách xác minh mà không đăng xuất/mất phiên. Không yêu cầu người vận hành gửi password, Firebase UID, token hoặc ID JWT. Nếu Edge InPrivate mới vẫn thiếu Phase6D, điều tra `currentUser.id===firebaseUser.uid` bằng diagnostic UI chỉ boolean, không gửi PII; xem thêm thực tế compiled asset.

**Gate `PHASE6D_STUDENT_HOST: PASS`; `PHASE6D_BROWSER_AUTH_ISOLATION_TEST: PENDING`; `PHASE6D_STUDENT_UI_VISIBLE: FAIL`.** Không Retry Cloudflare, không thêm biến, không bấm Start, không sửa D1/Production, PR36 Draft.

## Bước 250 — Edge InPrivate độc lập vẫn không hiển thị Phase6D (operator screenshot, 28/11/2026)

Operator dùng **Microsoft Edge InPrivate** (khác profile/browser Chrome Incognito), truy cập đúng **`https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/`**; URL có query `utm_source=chatgpt.com` nhưng client helper kiểm `window.location.hostname` (query không ảnh hưởng). Edge hiển thị tài khoản học viên `test_hv_...`, badge `Đã lưu đám mây`, tab `Mục Chuyên Đề`, ba chuyên đề cũ, trang có footer ngay dưới cards **không có khung `Phase 6D — Thi toán học DEMO có thời hạn`**. Đây là screenshot thứ hai trên một browser khác, cho thấy **sự cố không chỉ do chia sẻ phiên Chrome Incognito**.

Đối chiếu mã staging `src/App.tsx`: điều kiện render Phase6D là `activeTab === 'topics' && currentUser.role==='student' && firebaseUser && currentUser.id === firebaseUser.uid && isPhase6StudentExamUiEnabled(host,import.meta.env.VITE_PHASE6_STUDENT_TIMED_UI)`. Helper yêu cầu staging + flag `'true'` + pinned hostname. Source `src/utils/serverlessAuth.ts` login bằng Firebase `signInWithCustomToken` và verify `user.user.uid===result.account.id`, nên các ca đăng nhập mới bình thường sẽ khớp UID tại thời điểm đăng nhập; có thể bị lệch sau đó nếu dữ liệu account/session thay đổi, chưa có bằng chứng. Biến `VITE_PHASE6_STUDENT_TIMED_UI=true` và server `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` đã thấy trên Build settings screenshot, nhưng JS emitted/client flag chưa được kiểm tra trực tiếp.

**Gate `PHASE6D_EDGE_INPRIVATE_ISOLATED_UI: FAIL (operator screenshot)`; `SHARED_CHROME_INCOGNITO_IS_ONLY_CAUSE: RULED_OUT`; `PHASE6D_ROOT_CAUSE: UNKNOWN`.** Chưa bắt đầu thi, chưa submit, không thay đổi D1/Cloudflare.

**Bước 251 chẩn đoán frontend không sửa dữ liệu:** Trong **Edge InPrivate** tại đúng tab học viên, mở DevTools (F12) → **Sources** → **Search all files** (`Ctrl+Shift+F`) → tìm literal `Phase 6D — Thi toán học DEMO có thời hạn` hoặc `Tải danh sách đề thi DEMO`; gửi ảnh **có/không có kết quả**. Search trong code tải về có thể phân biệt bundle không chứa 6D vs code có nhưng điều kiện runtime sai, nhưng **có chuỗi không tự chứng minh flag runtime true**. Không paste script lạ vào Console, không gửi JWT/password/Firebase auth state đầy đủ. Nếu mã bundle có panel, cần diagnostic boolean-only của app guard (không tiết lộ UID) qua review/PR riêng; nếu bundle không chứa panel, điều tra Cloudflare alias asset và Vite output. Không Retry/đăng xuất/xóa cache lặp lại, không bật Phase6E, PR36 Draft, Production unchanged.

## Bước 251 — Source search confirms delivered JS contains Phase6D; diagnostic PR38 prepared, not merged (operator screenshot, 28/11/2026)

Operator trên Edge InPrivate tab học viên Preview mở DevTools Sources → Search all files và tìm `Tải danh sách đề thi DEMO`. Screenshot cho thấy **một kết quả** tại file `index-...js` của host `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`. Chuỗi JSX UI Phase6D có trong JavaScript được tải. Điều này không tự chứng minh compiled flag `VITE_PHASE6_STUDENT_TIMED_UI` bật hay guard UID nội bộ bằng Firebase.

Ở Bước249 cả hai cờ deployment build env đều `true`, hostname pinned đúng. Bước250 độc lập Edge InPrivate vẫn không thấy Phase6D trên tab topics sau login học viên; khả năng chia sẻ phiên Chrome Incognito không giải thích hết. Root cause **chưa được khẳng định**.

Đã tạo [PR38](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/38) (Draft), branch `feature/phase6d-preview-ui-guard-diagnostics-20261128`, base `feature/staging-demo-quiz-pilot`, commit `6ac30e98a06761e4f1a37e9827bb909942529650`. PR chỉ thêm **25 dòng vào `src/App.tsx`**, không sửa guard thật, API, Cloudflare hay database:
- Giao diện diagnostic **read-only**, **opt-in qua URL query `?phase6_debug=1`**, chỉ render cho `test_hv_[a-f0-9]{12}` trên đúng pinned Preview staging và tab topics.
- Chỉ in booleans/nhãn `ĐẠT/CHƯA ĐẠT` cho role student, có phiên Firebase, hai UID có bằng nhau không, cờ VITE build-time, Firebase staging, hostname đúng.
- Không hiển thị UID, tài khoản email, token, mật khẩu, đề/đáp án; không tạo phiên, không ghi D1.
- **PR38 đang Draft, chưa merge, chưa deploy**. Operator cần kiểm tra tab Checks (CI và Cloudflare) trước khi chuyển Ready for review/merge vào staging. Chỉ khi verified pinned Preview alias đã nhận merge commit mới, mới truy cập URL `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/?phase6_debug=1` bằng học viên DEMO, chụp trạng thái 6 boolean, không bấm Bắt đầu/nộp bài. Nếu chỉ có snippet trong bundle và flag vẫn CHƯA ĐẠT, tập trung Vite compile env; nếu UID mismatch, tập trung auth/session, không bỏ guard. Nếu tất cả ĐẠT mà panel vẫn thiếu, điều tra UI mount/layout.

**Gate `PHASE6D_JS_UI_STRING_PRESENT: PASS (operator screenshot)`, `PR38_DIAGNOSTIC_TESTS: PENDING`, `PHASE6D_STUDENT_UI_VISIBLE: FAIL`.** Giữ Phase6E flags OFF, PR36 Draft, Production unchanged.

## Bước 252 — PR38 diagnostics checks green (operator screenshot, 28/11/2026)

Operator gửi screenshot GitHub tab `Checks` của PR38: `Cloudflare Workers and Pages / Cloudflare Pages` **Deployed successfully** (commit `6ac30e9`, hashed Preview `2ed63d4b.duongtrcnhiem-test.pages.dev` thuộc **nhánh chẩn đoán**, KHÔNG phải pinned staging alias), `Staging DEMO Quiz Pilot (isolated) → demo-quiz-ci` **tích xanh**. Chỉ số annotation `1` vẫn hiển thị cạnh workflow; job xanh. GitHub `fetch_pr` xác nhận PR38 hiện **open, draft=true, merged=false, mergeable=true**, base `feature/staging-demo-quiz-pilot`, head `feature/phase6d-preview-ui-guard-diagnostics-20261128`, commit `6ac30e98a06761e4f1a37e9827bb909942529650`, một file thay đổi `src/App.tsx`.

**Gate `PR38_CI_AND_FIX_BRANCH_CLOUDFLARE: PASS (operator screenshot)`; `PR38_READY_FOR_REVIEW: NOT YET`, `PR38_MERGED: NO`.** Bước 253: operator mở PR38 Conversation và bấm `Ready for review`, xem merge gate còn 2 checks xanh/no conflicts, rồi chỉ khi sẵn sàng gộp vào **feature/staging-demo-quiz-pilot** (không main) xác nhận thao tác merge riêng. Không tự động merge bằng API và không dùng branch/hash preview để chẩn đoán vì API host allowlist/pinned alias. Sau merge & pinned deploy verified, dùng đúng URL `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/?phase6_debug=1` và tài khoản student để xem 6 booleans trên tab topics. Không bấm Start/Submit, không sửa DB/Production, cờ Phase6E OFF.

## Bước 253 — PR38 đã Ready for review, CI 2/2 xanh, no conflicts (operator screenshot, 28/11/2026)

Operator gửi ảnh merge gate của [PR38](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/38): `All checks have passed` (**2 successful checks**), `No conflicts with base branch` và nút `Merge pull request`. Chữ `Convert to draft` cho thấy đã chuyển khỏi Draft. GitHub connector `fetch_pr` xác minh `draft=false`, `state=open`, `merged=false`, `mergeable=true`, head SHA `6ac30e98a06761e4f1a37e9827bb909942529650`, base `feature/staging-demo-quiz-pilot`; một file `src/App.tsx` thay đổi.

**Gate `PR38_READY_TO_MERGE: PASS`, `PR38_MERGED: NOT YET`**. Hướng dẫn operator tự bấm Merge pull request → Confirm merge chỉ vào đúng staging branch; không tự merge qua API, không chạm Production hoặc PR36. Sau khi operator báo thành công, xác minh GitHub merge SHA và pinned Preview alias deployment mới trước khi test dashboard `?phase6_debug=1` chỉ bằng học viên DEMO; không bắt đầu/nộp bài, không log token/UID.

## Bước 254 — PR38 merged vào staging, chờ Cloudflare pinned Preview (operator screenshot và GitHub, 28/11/2026)

Operator gửi screenshot GitHub `Pull request successfully merged and closed` cho [PR38](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/38). Đối chiếu GitHub `fetch_pr` xác nhận `state=closed`, `draft=false`, `merged=true`, `merged_at=2026-11-28T08:50:48Z`, merge SHA **`431d7a0090ba2ee88804e56947bbfb09bc23e4a6`**, base `feature/staging-demo-quiz-pilot`. Bản chẩn đoán opt-in booleans chỉ trên pinned Preview/tài khoản DEMO đã vào nhánh staging; **chưa xác minh có deployment mới trên alias**.

**Gate `PR38_MERGED_TO_STAGING: PASS`; `PR38_PINNED_PREVIEW_DEPLOY: PENDING`; `PHASE6D_STUDENT_UI_ROOT_CAUSE: UNKNOWN`.**

**Bước 255:** vào Cloudflare Workers & Pages `duongtrcnhiem-test` → Deployments; tìm bản **Preview** nhánh `feature/staging-demo-quiz-pilot`, commit **`431d7a0`** (Merge PR38), trạng thái `success`; mở Details xác nhận alias **`feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`**. Nếu chưa có đúng SHA/alias, STOP chứ không Retry bản cũ. Không dùng hashed/branch PR38 URL để test signed student API.

Sau khi gate 255 PASS, mở pinned URL `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/?phase6_debug=1` trong Edge InPrivate có tài khoản học viên DEMO, vào Mục Chuyên Đề, xem panel `Phase 6D — Chẩn đoán hiển thị (chỉ Preview DEMO)`, chụp **6 trạng thái ĐẠT/CHƯA ĐẠT** không cần username/UID/email/token. **Không bấm `Bắt đầu làm bài` hoặc Nộp bài**, không sửa D1, Phase6E OFF, PR36 Draft, Production/main không đổi.

## Bước 255 — Cloudflare pinned Preview đã triển khai PR38 diagnostic merge (operator screenshot, 28/11/2026)

Operator gửi Deployment details Cloudflare cho `duongtrcnhiem-test`:
- Environment **Preview**, `Status: success`, **3:51 PM November 28, 2026**, Duration 17s.
- Commit **`431d7a0`** (`Merge pull request #38`) đúng GitHub merge SHA `431d7a0090ba2ee88804e56947bbfb09bc23e4a6`.
- Alias **`feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`** chính xác.
- Deployment ID **`be377e3a-bed0-4dc1-8b71-c0c4de3b23d5`**, hashed URL `be377e3a.duongtrcnhiem-test.pages.dev` không được dùng cho signed student API. Build settings có 20 dòng nhưng không cần thêm flags theo Bước249.

**Gate `PR38_PINNED_PREVIEW_DEPLOY: PASS (operator screenshot)`; `PHASE6D_DIAGNOSTIC_BOOLEAN_RESULTS: PENDING`**. Hướng dẫn bước 256: vào đúng Edge InPrivate với học viên DEMO đang đăng nhập, mở **`https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/?phase6_debug=1`** trong cùng tab, tab `Mục Chuyên Đề`, kéo dưới ba cards, chụp khung `Phase 6D — Chẩn đoán hiển thị (chỉ Preview DEMO)`; kiểm từng giá trị ĐẠT/CHƯA ĐẠT cho app role student, Firebase session present, internal/Firebase UID equal, compiled Vite 6D flag, Firebase staging env, pinned host. Chỉ booleans, không gửi UID/token/password. Nếu khung không hiện, xác nhận query `phase6_debug=1` còn trong URL, chưa login account khác; chụp address bar và cuối trang. Không bấm Start/Submit, không Retry/build mới, không sửa DB/Production, PR36 Draft.

## Bước 256 — Diagnostic xác định duy nhất Vite UI flag bị false trong browser JS (operator screenshot, 28/11/2026)

Operator đã mở pinned Preview `?phase6_debug=1` trong Edge InPrivate với học viên DEMO và gửi screenshot panel mới (sau PR38 merge commit `431d7a0`):
- **`Vai trò nội bộ là học viên: ĐẠT`**
- **`Có phiên Firebase: ĐẠT`**
- **`UID nội bộ khớp phiên Firebase: ĐẠT`**
- **`Đúng môi trường Firebase staging: ĐẠT`**
- **`Đúng địa chỉ Preview cố định: ĐẠT`**
- **`Cờ Vite giao diện 6D trong JavaScript: CHƯA ĐẠT`**.

Diagnostic code in `src/App.tsx` compares `import.meta.env.VITE_PHASE6_STUDENT_TIMED_UI === 'true'`; therefore **effective compiled client value is not the exact string `'true'`**, and UI render guard `isPhase6StudentExamUiEnabled(host,flag)` likewise rejects the value. **Gate `PHASE6D_BLOCKER_IS_COMPILED_CLIENT_FLAG: CONFIRMED`**, while the origin of incorrect compile value **still unknown**. Already ruled out auth UID/role/staging/host. Cloudflare deployment Build settings screenshots show key `VITE_PHASE6_STUDENT_TIMED_UI` with rendered value `true`, but they do **not expose invisible spaces/characters or the actual value injected by Vite during build**; no grounds to blame Firebase or D1. Vite official docs: `VITE_` vars are **statically replaced at build time**, and require rebuilding to change client JS (https://vite.dev/guide/env-and-mode).

**Bước 257 (targeted, no code change):** in Cloudflare Pages `duongtrcnhiem-test` → Settings → **Preview** → Variables and secrets, locate **existing** `VITE_PHASE6_STUDENT_TIMED_UI` (do not add duplicate), retype Value manually using Ctrl+A `true` as four ASCII letters, without quotes, newline or spaces, Save. Do not touch `PHASE6_STUDENT_TIMED_EXAM_ENABLED` or other flags. This tests possible hidden whitespace/encoding but **is not yet proof that was the cause**. After confirmed Save, perform **a new Preview build** from correct staging commit; verify diagnostic again. If still `CHƯA ĐẠT`, build a sanitized compile-time logging/assertion PR (no secrets) instead of blindly repeating retries. Do not bypass UI/auth gate, no changes to D1/Production or Phase6E, PR36 Draft.

## Bước 257 — Operator xác nhận đã lưu lại `VITE_PHASE6_STUDENT_TIMED_UI=true` trong Preview (28/11/2026)

Operator phản hồi **"đã lưu lại vite 6D"** sau hướng dẫn mở Cloudflare Pages `duongtrcnhiem-test` → Settings → **Preview** → Variables and secrets, chọn biến **đã tồn tại** `VITE_PHASE6_STUDENT_TIMED_UI`, thay giá trị bằng đúng chuỗi `true` không dấu nháy/khoảng trắng, và Save. Đây là **operator-confirmed**, chưa chứng minh giá trị đã vào bundle build mới. Bước256 diagnostic cho thấy 5/6 điều kiện ĐẠT, duy nhất `Cờ Vite giao diện 6D trong JavaScript: CHƯA ĐẠT`.

[PR38](https://github.com/nguyenquyduong1611998-cmyk/duongtrcnhiem/pull/38) đã merged vào staging, merge SHA **`431d7a0090ba2ee88804e56947bbfb09bc23e4a6`**. Bản Preview đã triển khai commit này tại Bước255, nhưng cần **build mới sau khi Save biến**, vì Vite thay cờ vào JS lúc build.

**Bước 258:** Cloudflare Pages `duongtrcnhiem-test` → Deployments → chọn **Preview** của `feature/staging-demo-quiz-pilot` commit `431d7a0` (Merge PR38) → menu `...` → `Retry deployment` (không Retry bản cũ `1182512`, không Production). Sau khi success, kiểm đúng alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`. Rồi mở Edge InPrivate đã đăng nhập học viên DEMO: `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/?phase6_debug=1`, tab Mục Chuyên Đề, diagnostic phải có **6/6 ĐẠT** và khung thi Phase6D. **Chưa bấm Bắt đầu/Nộp**. Nếu vẫn Vite CHƯA ĐẠT, **dừng retry**, rà lại cách Vite build xác định value tại compile-time bằng kiểm thử sạch trước khi thay đổi code. Không sửa D1, Firebase, Phase6E, PR36 Draft hay Production.

## Bước 258 — Preview rebuild sau retype VITE Phase6D thành công (operator screenshot, 28/11/2026)

Operator gửi ảnh Cloudflare Pages `duongtrcnhiem-test` deployment mới **Preview** sau khi lưu lại `VITE_PHASE6_STUDENT_TIMED_UI=true` ở Settings Preview:
- Deployment ID `3eb3f2bf-e53f-4f3d-b6bf-c64b219b46d2`, hashed URL `3eb3f2bf.duongtrcnhiem-test.pages.dev` (không dùng để gọi API).
- Alias đúng `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
- Branch staging commit **`431d7a0`**, merged PR38.
- Status **success**, **4:05 PM November 28, 2026**, Duration **12s**.
- Build settings ghi **20**, ảnh chưa mở rộng để xác nhận giá trị build riêng của lần retry này.

**Gate `PHASE6D_PREVIEW_BUILD_AFTER_ENV_RETYPE: PASS (operator screenshot)`; `PHASE6D_COMPILED_FLAG_AFTER_REBUILD: PENDING`**. Bước259: trên Edge InPrivate học viên DEMO, mở đúng pinned alias `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/?phase6_debug=1`, tab `Mục Chuyên Đề`, xem 6 boolean. Nếu 6/6 ĐẠT và Phase6D panel hiện, chỉ bấm `Tải danh sách đề thi DEMO` (read-only), không Bắt đầu làm bài. Nếu `Cờ Vite giao diện 6D trong JavaScript: CHƯA ĐẠT`, không Retry lại; nghiên cứu build-time variable substitution của Vite bằng diagnostic an toàn, không bật bừa cờ hay bỏ guard auth. PR36 Draft, Phase6E OFF, Production nguyên trạng.
