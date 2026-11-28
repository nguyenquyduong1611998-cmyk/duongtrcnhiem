# Phase 7L / Bước 156 — Kế hoạch thử nghiệm D1 độc lập, chưa thực hiện trên Cloudflare

Ngày: 28/11/2026. PR #36 (Draft) chỉ bổ sung tài liệu; base `feature/staging-demo-quiz-pilot` (PR35 merged, commit `75f2d81`).

## Phạm vi và quyết định

**NO-GO cho thi thật, migration live và bật Phase 6 flags.** Mục tiêu của bước này là chuẩn bị bài kiểm tra môi trường D1 **riêng**, có khả năng bỏ đi khi xong, không binding với bất kỳ Pages/Worker/Production nào, không chứa đề thật hoặc dữ liệu tài khoản/kết quả thật.

Người vận hành đã chứng minh **trên máy cục bộ**:
- Bản export `preview-backup-20261127.sql` (12,145 byte) đã import vào SQLite RAM, integrity ok, foreign key errors 0.
- 8 bảng Preview gốc không đổi theo snapshot số hàng và SHA-256 trước/sau áp dụng draft 6B → 6C → 6A → 6D.
- 5 bảng `phase6_*`, 12 trigger Phase 6 tạo thành công; kiểm thử 100 học viên giả, quyền sở hữu và deadline, nộp trùng, khóa tài khoản đều đạt trong mô phỏng.
- Cloudflare Access thử không đăng nhập trả challenge, đăng nhập hợp lệ tải được trang; Staging Preview commit `75f2d81` deployed success; `/api/auth/status` trả ready=true, d1Connected=true, tablesReady=true (chỉ hai bảng đăng nhập cơ bản).
- Trên Preview, người vận hành xác nhận **không có** ba biến API `PHASE6_STUDENT_TIMED_EXAM_ENABLED`, `PHASE6_RESULTS_READONLY_ENABLED`, `PHASE6_ADMIN_RESULTS_ENABLED`; tiếp tục để thiếu/OFF.

Những điều trên **không phải** chứng cứ remote migration hay Phase 6 Cloudflare live đã được nghiệm thu.

## Gate A — Kiểm tra hạn mức trước tạo database (CHƯA XONG)

1. Cloudflare → Storage & databases → D1 SQL database → chỉ xem **danh sách và tổng số database hiện có**. Không gửi account ID, database UUID, secret hoặc toàn bộ nội dung database lên GitHub.
2. Đối chiếu với giới hạn Cloudflare D1 **Free: tối đa 10 database/tài khoản**, tổng dung lượng tối đa **5 GB** (tài liệu cập nhật 20/11/2026). Nếu đang có 10 database, **không tạo thêm**. Không nâng cấp trả phí để tiếp tục.
3. Người quản trị xác nhận tách biệt tài khoản/môi trường dữ liệu; chọn tên rõ chức năng, ví dụ `duongtrcnhiem-phase6-lab`, khác hẳn `duongtrcnhiem-auth-preview` và `duongtrcnhiem-auth-staging`.
4. **Chưa tạo database hoặc chạy lệnh từ tài liệu này**; phải có chấp thuận riêng sau khi Gate A đạt.

Tham khảo: https://developers.cloudflare.com/d1/platform/limits/ và https://developers.cloudflare.com/d1/wrangler-commands/

## Gate B — Thiết kế lab hoàn toàn cô lập (CHƯA XONG)

- Database D1 mới phải **trống**, không gắn binding `AUTH_DB` hoặc `AUTH_DB_PREVIEW` vào ứng dụng đang chạy; không copy biến Firebase, cookie, ID token, hash mật khẩu thật.
- Không import `preview-backup-20261127.sql` lên remote lab tự động: file là bản xuất có thể chứa bản ghi tài khoản, hash mật khẩu và dữ liệu nội bộ. Chỉ giữ file offline có quyền truy cập hạn chế. Muốn kiểm tra **remote restore bản gốc** cần đánh giá phân loại dữ liệu, quyền xử lý, biện pháp bảo vệ và phê duyệt **riêng**.
- Với thử nghiệm cấu trúc trên lab mới: chỉ chuẩn bị schema không có dữ liệu thật, và **câu hỏi toán giả**. Có sẵn trong repository:
  1. `serverless/d1-staging-schema.sql` — baseline `demo_students`, `login_attempts` (không có account seed).
  2. `serverless/d1-phase4-synthetic-graded-quiz.sql` — synthetic graded table.
  3. `serverless/d1-phase5-preview-additive-schema.sql` — năm bảng `phase5_content_*`.
  4. `serverless/d1-phase5-preview-synthetic-math-seed.sql` — nội dung toán giả (chỉ chạy một lần, trên DB mới trống và sau review).
  5. Phase 6 dự thảo **6B → 6C → 6A → 6D**, xem danh sách file ở phần sau.
- **Lưu ý:** nhiều file schema/seed được ghi rõ `DO NOT EXECUTE` cho Cloudflare khi chưa review. Kế hoạch này **không** thay thế duyệt SQL/phê duyệt vận hành; không chạy chỉ vì database là lab.
- SQLite/D1 có thể tạo thêm bảng nội bộ `sqlite_sequence` và bảng hệ thống khác. Nghiệm thu dựa trên **tên bảng/trigger mục tiêu**, không chỉ số bảng tổng.

## Gate C — Review SQL và kế hoạch rollback (CHƯA XONG)

| Thứ tự sau schema baseline | File draft | Thành phần | Trạng thái |
| --- | --- | --- | --- |
| 1 | `serverless/d1-phase6b-synthetic-admin-drafts-draft.sql` | `phase6_admin_drafts`, `phase6_admin_draft_events`, 3 trigger | Review required |
| 2 | `serverless/d1-phase6c-publication-metadata-draft.sql` | `phase6_admin_publications`, 3 trigger | Review required |
| 3 | `serverless/d1-phase6-timed-sessions-draft.sql` | `phase6_exam_sessions`, 3 trigger | Review required |
| 4 | `serverless/d1-phase6d-timed-submissions-draft.sql` | `phase6_exam_submissions`, 3 trigger | Review required |

- Review ngoại khóa Phase 5, kiểm tra `CHECK`, UID của dữ liệu giả, trigger, thời gian DB, quyền Admin, trường hợp nộp trùng, thứ tự chạy và hành vi chạy lại sau lỗi một phần. Các file `CREATE ... IF NOT EXISTS` **không bảo đảm** một migration bị lỗi giữa chừng sẽ tự rollback toàn bộ.
- Đối chiếu chính xác **database ID** trước mỗi thao tác remote; tên database gần giống dễ gây chạy nhầm. Không dùng tài liệu này như script triển khai.
- Chỉ sau khi người quản trị phê duyệt, chuẩn bị quy trình tạo snapshot lab, kiểm thử restore **riêng lên lab thứ hai**, xác nhận schema, row counts synthetic, foreign keys/integrity, bằng chứng và phương án bỏ lab.
- Không dùng `wrangler d1 execute --remote` hoặc `wrangler d1 migrations apply --remote` trước khi được duyệt rõ đối tượng D1. Lệnh Cloudflare `execute --file` thực sự **ghi lên remote** nếu có `--remote`.
- Nghiệm thu remote chỉ sử dụng dữ liệu toán/UID giả, không thử tải 30–100 người thật trước khi có bài kiểm tra bảo mật và hạn mức riêng.

## Gate D — Kết quả chứng cứ và STOP conditions (CHƯA XONG)

Dừng nếu: đã dùng hết hạn mức Free; tên/ID DB không rõ; export có dữ liệu nhạy cảm chưa phân loại; schema lỗi/khác kỳ vọng; retry sau lỗi chưa được duyệt; rủi ro lẫn với Preview/Production; đòi nâng cấp thanh toán; không có quyền vận hành.

Chỉ lưu vào hồ sơ: `PASS/FAIL/BLOCKED`, ngày giờ, tên lab (không UUID bắt buộc), commit SQL được duyệt, số lượng bảng/trigger/row synthetic và mô tả lỗi đã làm sạch. **Không** lưu SQL backup thật, thông tin học viên, hashes, secrets, access tokens, cookie hay OTP.

Tình trạng hiện tại: **Gate A/B/C/D BLOCKED để chờ xác minh và phê duyệt; không có remote D1 nào được tạo hoặc sửa bởi PR #36**. Không mở `PHASE6_*`, không merge PR, không sửa main/Production.

## Bước 157 — Bằng chứng danh sách D1 (ảnh operator ngày 28/11/2026)

Ảnh trang Cloudflare `D1 Database` hiển thị `Showing 1-3 of 3`, với đúng ba tên:
1. `duongtrcnhiem-restore-test`
2. `duongtrcnhiem-auth-preview`
3. `duongtrcnhiem-auth-staging`

**Gate A / kiểm tra số lượng:** `COUNT_OBSERVED=3`; dưới ngưỡng 10 database của tài khoản D1 Free theo tài liệu đã đối chiếu. Chưa xác minh loại plan, quota/storage còn lại hay quyền sở hữu chi tiết; không coi các cột Queries/Rows Read/Rows ở cửa sổ thống kê bằng 0 là bằng chứng các database trống. Không lưu Database IDs trong tài liệu.

**Phát hiện:** Đã tồn tại database `duongtrcnhiem-restore-test`, tên gợi ý từng dùng để restore/test nhưng **chưa có bằng chứng** về nội dung, người tạo, binding, mục đích, quyền truy cập hoặc khả năng tái sử dụng. Tuyệt đối không nhập dữ liệu mới/xóa/khôi phục đè lên DB này chỉ vì tên của nó.

**Bước kế tiếp (chỉ đọc):** mở `duongtrcnhiem-restore-test` → Overview; xem Number of Tables / Storage used. Sau đó cần đối chiếu có binding ứng dụng hay không và có được phép tái sử dụng hay phải tạo lab mới với dữ liệu tổng hợp, sau khi được chủ DB chấp thuận. Giữ nguyên ba cờ API Phase 6 chưa cấu hình. Gate B–D NO-GO.

## Bước 158 — Overview restore-test (ảnh operator ngày 28/11/2026)

Ảnh Cloudflare D1 Overview của `duongtrcnhiem-restore-test` hiển thị: `Number of Tables: 13`, `Storage used (current): 197 KB`; các bộ đếm `Total queries`, `Rows read`, `Rows written` đều bằng 0 trong phạm vi `Last 24 hours`. Database rõ ràng có schema; không được coi các bộ đếm 24 giờ bằng 0 là bằng chứng database rỗng hoặc được phép tái sử dụng.

So với `duongtrcnhiem-auth-preview` từng quan sát có 8 bảng, restore-test có nhiều hơn 5 bảng. Chưa có bằng chứng các bảng tăng thêm là Phase 6; không phỏng đoán dựa vào tổng số bảng hay dung lượng, và không sao chép UUID database vào tài liệu.

**Bước 159, chỉ đọc:** từ database restore-test mở `Explore Data`, chụp **danh sách tên bảng** ở menu bên trái mà không nhấp mở nội dung bảng. Cần kiểm tra tiếp DB có binding với Pages/Worker hay có dữ liệu tài khoản trước khi xem xét dùng lại. Không DELETE/RESTORE, không SQL và không di chuyển bản export dữ liệu sang remote.

## Bước 159 — Danh sách bảng D1 restore-test (ảnh operator ngày 28/11/2026)

Ảnh Cloudflare D1 Studio → Explore Data của `duongtrcnhiem-restore-test` hiển thị 14 tên trong sidebar: 13 bảng ứng dụng cộng 1 bảng SQLite nội bộ `sqlite_sequence`.

**13 bảng ứng dụng quan sát được:**
- Phase 4/DEMO: `demo_students`, `login_attempts`, `synthetic_graded_attempts` (3)
- Phase 5: `phase5_content_answer_keys`, `phase5_content_attempts`, `phase5_content_questions`, `phase5_content_topics`, `phase5_content_versions` (5)
- Phase 6: `phase6_admin_draft_events`, `phase6_admin_drafts`, `phase6_admin_publications`, `phase6_exam_sessions`, `phase6_exam_submissions` (5)

Các nhóm tên bảng khớp dự thảo SQL Phase 6 trong repo và chỉ số Overview `Number of Tables: 13` (không tính `sqlite_sequence`). Đây là bằng chứng **schema table-name presence trên D1 remote**; không phải xác nhận đủ 12 trigger, đúng cấu trúc cột, tính toàn vẹn/foreign keys, bản ghi thực tế, quyền truy cập hay trạng thái bind vào ứng dụng.

**Bước 160 đề nghị (metadata-only, đọc):** ở **đúng** database `duongtrcnhiem-restore-test`, dùng Console SQL với `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'phase6_%' ORDER BY name;` để liệt kê trigger; không query dữ liệu bảng, không chạy DDL/DML, không gửi secrets/UID/token. Chưa dùng DB này để nộp bài/khôi phục đè; cần kiểm chứng không có binding và cho phép tái sử dụng trước mọi ghi từ xa.

## Bước 160 — Trigger Phase 6 trên D1 restore-test và rà soát tiến độ

Ngày xác minh: 28/11/2026. Ảnh D1 Studio Query do operator cung cấp trả kết quả `sqlite_master · 1×12`, gồm **đúng 12 tên trigger** `phase6_*`:
- Admin: `phase6_admin_draft_created`, `phase6_admin_draft_deleted`, `phase6_admin_draft_saved`.
- Publication: `phase6_publication_no_delete`, `phase6_publication_no_update`, `phase6_publication_requires_published`.
- Session: `phase6_session_no_delete`, `phase6_session_no_update`, `phase6_session_start_guard`.
- Submission: `phase6_submission_guard`, `phase6_submission_no_delete`, `phase6_submission_no_update`.

**Gate hiện diện schema/trigger trên D1 restore-test: PASS (13 bảng ứng dụng, 5 bảng Phase 6, 12 trigger Phase 6).** Đã quan sát một bảng nội bộ `sqlite_sequence` không tính trong 13 bảng ứng dụng.

### Đính chính tiến độ từ lịch sử trước

Trong hội thoại ngày **26/11/2026**, người vận hành đã phê duyệt bài thử migration Phase 6 trên **duongtrcnhiem-restore-test** và chạy `wrangler d1 execute ... --remote --file` vào **database thử nghiệm độc lập này**. Các kiểm tra sau đó được báo cáo: 13 bảng ứng dụng, 45 đối tượng SQLite, `quick_check: ok`, foreign key errors 0, 24 định nghĩa cũ không đổi, các bảng trống (dữ liệu 0). Phần kế hoạch phía trên mô tả `Gate B–D` là CHƯA XONG đối với **tạo lab mới hoặc quy trình remote restore dữ liệu thật**, không nên hiểu nhầm rằng Phase 6 schema chưa từng được thử trên D1 remote. Không chạy lại migration chỉ để tái chứng minh bằng chứng đã có.

**Giới hạn:** ảnh hiện tại chỉ xác nhận danh sách trigger; không đối chiếu SQL `sqlite_master.sql` với GitHub tại cùng SHA, không lặp lại kiểm tra 45 đối tượng, không chứng minh D1 Preview có schema Phase 6, không chứng minh các Pages routes Phase 6 hoạt động, không chứng minh quyền truy cập hay khôi phục live D1.

### Trạng thái dự án sau Bước 160

- GitHub: PR12–35 đã merged vào `feature/staging-demo-quiz-pilot`; HEAD Staging `75f2d81` đã có Preview deployment success, PR36 vẫn Draft.
- Cloudflare Access Preview: anonymous challenge và login hợp lệ quan sát PASS; `/api/auth/status` báo `ready:true`, `d1Connected:true`, `tablesReady:true` (chỉ baseline D1 auth).
- D1: `duongtrcnhiem-auth-preview` đã quan sát 8 bảng, khác biệt rõ với `duongtrcnhiem-restore-test` đã có 13 bảng ứng dụng. Không được nhầm hai database hoặc gắn restore-test vào Pages mà chưa review.
- Các API Phase 6 tại Preview: operator xác nhận chưa cấu hình `PHASE6_STUDENT_TIMED_EXAM_ENABLED`, `PHASE6_RESULTS_READONLY_ENABLED`, `PHASE6_ADMIN_RESULTS_ENABLED`. API mặc định OFF theo mã nguồn.
- Trên máy: export D1 Preview đã nạp được vào SQLite RAM, schema Phase 6 additive và 8/8 bảng cũ không đổi, mô phỏng nhiều tình huống chấm/khóa thời gian/100 học viên PASS. Trên PC/iPhone đã có các thử nghiệm đăng nhập/đồng bộ DEMO và PWA, **nhưng chưa hoàn tất quy trình nghiệm thu Phase 6 live trên hai thiết bị**.

**Next decisions:** (1) Đánh dấu gate schema remote restore-test PASS, không tạo database mới không cần thiết; (2) rà soát binding/nguồn dữ liệu và trạng thái 8 bảng Preview một lần trước phê duyệt migration riêng; (3) bảo vệ bản backup đủ mới và nghiệm thu restore trên D1 thứ hai chỉ với dữ liệu được phép; (4) review SQL/rollback cùng quyền dữ liệu rồi mới cho phép migration 6B→6C→6A→6D trên Preview; (5) mở flag từng bước chỉ cho DEMO và thử signed A/B/Admin, PC/iPhone; (6) test thực tế tải 30–100 người và phê duyệt trước thi thật. **Không chuyển dữ liệu thật, không bật flags/migration/merge Production khi chưa qua các gate.**

## Bước 161 — Kiểm tra khóa ngoại D1 restore-test (operator screenshot, 28/11/2026)

Ảnh Cloudflare D1 Studio cho database `duongtrcnhiem-restore-test` hiển thị câu lệnh read-only `PRAGMA foreign_key_check;` và bảng kết quả `Query · 4×0` với 4 cột `table`, `rowid`, `parent`, `fkid` nhưng **0 hàng kết quả**. Kết luận riêng phép thử này: `FOREIGN_KEY_CHECK: PASS`, không phát hiện bản ghi vi phạm tại thời điểm kiểm tra.

**Chưa có ảnh kết quả `PRAGMA quick_check;` trong Bước 161 hiện tại.** Dù lịch sử trước có ghi nhận `quick_check: ok`, không đánh dấu kiểm tra hiện tại PASS cho đến khi người vận hành cung cấp kết quả. Không thực hiện bất cứ thao tác ghi, import, migration, hoặc thay đổi binding/flags nào từ phép kiểm này.

### Bước 161 hoàn tất — người vận hành xác nhận quick_check đạt

Sau ảnh `PRAGMA foreign_key_check` 0 lỗi, người vận hành xác nhận đã chạy `PRAGMA quick_check;` ngay trước câu lệnh khóa ngoại và nhận `ok`. Kết luận `quick_check=ok` dựa trên **lời xác nhận**, chưa có ảnh độc lập cho chính lệnh này tại Bước 161. Hai phép kiểm cùng đủ điều kiện đi tiếp xem bindings; không yêu cầu người vận hành chạy lại.

**Bước 162 đề nghị, chỉ đọc:** kiểm tra Pages `duongtrcnhiem-test` → Settings → chọn `Preview` → `Bindings`, đối chiếu D1 binding `AUTH_DB_PREVIEW` trỏ `duongtrcnhiem-auth-preview`, không phải `duongtrcnhiem-restore-test`. Sau đó kiểm tra `Production` bindings; việc không thấy `restore-test` ở một dự án Pages **không chứng minh** database này không được bất kỳ Worker/Pages nào khác sử dụng. Không Add/Edit/Delete/Save.

## Bước 162 — Pages Preview binding phân tách khỏi restore-test (ảnh operator 28/11/2026)

Ảnh Cloudflare Pages `duongtrcnhiem-test` → Settings → `Bindings` (theo ngữ cảnh đang chọn **Preview** từ Bước 162) cho thấy đúng một dòng:
- Type `D1 database`
- Name `AUTH_DB_PREVIEW`
- Value `duongtrcnhiem-auth-preview`

Không thấy `duongtrcnhiem-restore-test` trong danh sách binding hiển thị. **Bước 162 PASS cho cấu hình Pages Preview đã quan sát**. Ảnh chỉ cắt phần Bindings, không có environment selector nên phép suy luận môi trường Preview phụ thuộc ngữ cảnh thao tác người vận hành. Bằng chứng `/api/auth/status` ở bước trước hỗ trợ rằng API cơ bản đã truy cập D1 trên alias Preview.

Giới hạn: chỉ một cấu hình Pages Preview được kiểm tra, chưa chứng minh database `restore-test` không bị một Worker/Pages project khác sử dụng; chưa khớp UUID database với binding runtime thực tế, chưa xác nhận Production binding, chưa chứng minh các bảng Phase 6 đã có trong `auth-preview`.

**Bước kế tiếp (163, chỉ đọc):** mở Settings → chọn environment Production → Bindings của `duongtrcnhiem-test`; chụp các dòng Type/Name/Value nhưng không thay đổi cấu hình, bấm Reveal, hoặc chia sẻ secret. Không bắt đầu migration/bật cờ Phase 6.
