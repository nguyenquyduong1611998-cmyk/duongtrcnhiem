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

## 10. Bước 141 — Bảo vệ deadline và phiên thi (operator screenshot)

Người vận hành chạy phép thử độc lập trên `node:sqlite` trong RAM: tạo 1 phiên thi DEMO giả với `phase6_exam_sessions` và trigger từ dự thảo Phase 6A, sau đó thử tăng `expires_at` và `DELETE` phiên.

Kết quả ảnh CMD: `Extend deadline: PASS`; `Delete session: PASS`; `Result: PASS`. Hai thao tác đều bị SQLite từ chối với trigger `PHASE6_SESSION_IMMUTABLE`.

Giới hạn: đây chỉ là thử nghiệm trigger cục bộ trên dữ liệu giả, không chứng minh một client/API bên ngoài không thể khai thác lỗ hổng khác. Không thao tác vào D1 Cloudflare, không áp dụng migration thật hoặc bật flags.

## 11. Bước 142 — Chặn nộp trùng và bảo toàn điểm

Theo ảnh CMD người vận hành cung cấp, phép thử SQLite `:memory:` cục bộ dùng các bảng demo giả và SQL `serverless/d1-phase6d-timed-submissions-draft.sql` đã tạo một bài nộp hợp lệ, rồi thử nộp trùng cùng `session_id`, sửa `score_tenths`, và xóa bài nộp.

- `Duplicate submit: PASS` — ràng buộc duy nhất chặn nộp trùng.
- `Edit score: PASS` — trigger `PHASE6_SUBMISSION_IMMUTABLE` từ chối sửa.
- `Delete submission: PASS` — trigger `PHASE6_SUBMISSION_IMMUTABLE` từ chối xóa.
- `One immutable grade: PASS` — giữ lại đúng một điểm gốc trong thử nghiệm.

Giới hạn: phép thử chỉ trong SQLite RAM với dữ liệu tổng hợp, không kiểm chứng phân quyền HTTP/Firebase hoặc tranh chấp đồng thời trên D1 thực tế. Không cập nhật D1 Cloudflare, flags, deployment hay dữ liệu người dùng.

## 12. Bước 143 — Ràng buộc chủ phiên và hạn nộp (operator screenshot)

Người vận hành thực thi phép thử SQLite `:memory:` cục bộ với cấu trúc DEMO giả và `serverless/d1-phase6d-timed-submissions-draft.sql`. Kết quả ảnh CMD:
- `Wrong owner rejected: PASS` — `student_uid` khác chủ phiên bị từ chối.
- `Valid submission: PASS` — phiên hợp lệ được nộp.
- `Expired rejected: PASS` — phiên đã hết hạn bị từ chối.
- `One valid grade: PASS` — chỉ một điểm được lưu.
- `Result: PASS`.

Giới hạn: bài thử xác nhận ràng buộc SQLite cục bộ, chưa kiểm tra quyền Firebase HTTP, Cloudflare Access enforcement, giờ thực tế bên ngoài, hoặc D1 live. Không thay đổi Production hoặc database Preview.

## 13. Bước 144 — Từ chối nộp từ tài khoản không còn hoạt động

Ảnh CMD người vận hành cung cấp cho thấy phép thử SQLite `:memory:` dùng SQL `serverless/d1-phase6d-timed-submissions-draft.sql` và học viên DEMO giả; lúc `demo_students.active=0` trigger chặn nộp, sau khi đổi `active=1` trong dữ liệu giả, bài nộp được lưu.

- `Inactive student rejected: PASS`
- `Active student accepted: PASS`
- `Result: PASS`

Đây là thử nghiệm **ràng buộc database cục bộ**, không phải bằng chứng Cloudflare/Firebase Access đang chặn đúng tài khoản bị khóa trên môi trường thực. Không thay đổi database, migration, flags hoặc Production. PR giữ Draft.

## 14. Bước 145 — Kiểm tra ranh giới giây hết hạn bằng đồng hồ giả lập

Người vận hành chạy phép thử SQLite `:memory:` với `unixepoch()` được giả lập và bản dự thảo `serverless/d1-phase6d-timed-submissions-draft.sql`, hai học viên DEMO giả và hai phiên độc lập có cùng deadline.

Kết quả ảnh CMD:
- `Exact deadline: PASS` — bài được chấp nhận ở đúng `expires_at`.
- `One second late: PASS` — bài nộp trễ một giây bị từ chối.
- `Saved grades: 1` — chỉ một bài hợp lệ được ghi.
- `Result: PASS`.

**Giới hạn:** đây là kiểm thử trigger trong SQLite RAM với đồng hồ giả; chưa chứng minh độ chính xác giờ D1 Cloudflare live, điều kiện mạng hoặc phân quyền token trên thiết bị.

## 15. Kết luận tạm thời sau Bước 145 — NO-GO cho vận hành Phase 6

**Đã kiểm tra cục bộ theo ảnh người vận hành:** export SQL khôi phục được vào SQLite RAM; 8 bảng gốc không đổi sau khi áp dụng draft 6B→6C→6A→6D; 5 bảng và 12 trigger Phase 6 có mặt; test 100 học viên tổng hợp đạt; thử bounds 1–240 phút, audit create/save/delete, bất biến phiên và điểm, nộp trùng, sai chủ phiên, tài khoản khóa, hết giờ đều PASS trên SQLite.

**Chưa được xác minh hoặc chưa hoàn tất:** ràng buộc Cloudflare Access thực thi trên đường dẫn Preview thật; Preview deployment commit và runtime D1 đúng phiên bản; snapshot mới nhất và phục hồi D1 độc lập/so sánh dòng; phê duyệt riêng cho SQL draft 6A–6D và kế hoạch rollback; kiểm thử signed Firebase A/B/Admin trên D1 Preview; kiểm thử thiết bị PC/iPhone với mạng gián đoạn; đo tải thực tế 30–100 người và hạn mức; review quyền dữ liệu thật.

**Không được suy ra từ các PASS cục bộ rằng hệ thống đã an toàn để bật API.** Giữ PR Draft, không merge, không chạy D1 migration Cloudflare, không đổi `PHASE6_*` hoặc `main`/Production. Bước kế tiếp nên kiểm tra **hiệu lực Cloudflare Access trong cửa sổ ẩn danh** mà không gửi token hay dữ liệu, sau đó đối chiếu Preview deployment SHA (chỉ đọc).

## 16. Bước 146 — Quan sát Cloudflare Access trên Preview trong cửa sổ ẩn danh

Theo ảnh trình duyệt do người vận hành cung cấp ngày 27/11/2026, khi mở hostname Preview của nhánh Staging trong cửa sổ Chrome ẩn danh **chưa đăng nhập**, người dùng nhận trang `Cloudflare Access` với tiêu đề `Log in to duongtrcnhiem-test - Cloudflare Pages`, ô `Email` và nút `Send login code`.

**Xác nhận qua ảnh:** trang Preview đã bị chặn ở cổng xác thực đối với phiên không đăng nhập (`ANONYMOUS_ACCESS_CHALLENGE_OBSERVED`).

**Chưa xác minh:** danh tính email không nằm trong allowlist có bị từ chối; người đã xác thực có truy cập được ứng dụng; route API có cùng chính sách; Cloudflare Access session timeout; Cloudflare deployment SHA/branch runtime/D1 schema; kiểm thử Phase 6 live. Cấu hình Dashboard trước đó cho thấy policy Allow chỉ gồm một rule Emails xác định, nhưng ảnh hiện tại chưa chứng minh hiệu lực tất cả trường hợp.

**Quyết định:** Gate truy cập ẩn danh có bằng chứng tích cực; vẫn `NO-GO` cho chạy migration, bật `PHASE6_*`, dùng dữ liệu thật, hoặc merge PR. Bước sau kiểm tra đăng nhập bằng email chủ sở hữu được cho phép và so sánh deployment SHA, không gửi OTP hay cookie vào repo/chat.

## 17. Bước 147 — Đăng nhập hợp lệ qua Access, Preview hiển thị website

Ảnh trình duyệt do người vận hành cung cấp ngày 27/11/2026: sau khi hoàn tất đăng nhập Cloudflare Access tại URL Preview theo quy trình ở Bước 146, trình duyệt hiển thị giao diện website Tiểu đoàn 3, có phiên tài khoản thử nghiệm, ba thẻ chuyên đề và nhãn UI báo trạng thái lưu đám mây. **Không lưu ảnh, email, tên người dùng, nội dung chuyên đề hay dữ liệu tài khoản vào GitHub.**

- `AUTHORIZED_ACCESS_PAGE_LOAD_OBSERVED: PASS` — người dùng được phép đã truy cập thành công giao diện website sau thử cổng Access ẩn danh.
- `CLIENT_CLOUD_SAVED_BADGE_OBSERVED` — chỉ là nhãn hiển thị từ client; **không** tự xác nhận đồng bộ backend D1.
- `DEPLOYED_BRANCH_SHA_VERIFIED: false` — chưa đối chiếu commit cụ thể với Cloudflare Pages Deployments.
- `PHASE6_LIVE_TESTED: false` — không có bằng chứng đã triển khai SQL Phase 6 hay bật các flags, không nộp bài thử Phase 6.

Bước tiếp theo: tại Cloudflare Pages test project → Deployments, kiểm tra đúng nhánh `feature/staging-demo-quiz-pilot`, deployment gần nhất, status và commit SHA; **không** deploy lại hoặc merge PR36, không bật `PHASE6_*`.

## 18. Bước 148 — Deployment Preview ghi nhận từ Cloudflare Dashboard

Theo ảnh `Workers & Pages → duongtrcnhiem-test → Deployments` do người vận hành cung cấp ngày 27/11/2026:
- Cloudflare Pages test **Production** hiển thị nguồn nhánh `fix-firebase-l...` commit `01b59ce` và dấu trạng thái thành công. Đây là Production **của dự án Pages thử nghiệm**, không đồng nghĩa website chính/Main đã được thay đổi.
- All deployments hiển thị hai **Preview** build thành công với commit `6c5c959` (newer) và `bf605f6` (older). GitHub PR #36 HEAD được đối chiếu đúng `6c5c959b9d4dfecdda11c1995f6e7d7bb5970099`; PR #36 đang `open`, `draft`, `merged:false`, base `feature/staging-demo-quiz-pilot`.
- Vì hai build trên tương ứng commit nhánh PR #36, kết quả không chứng minh HEAD của **Staging base branch** đã được deploy trên hostname branch alias ổn định `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
- Trạng thái deploy thành công chỉ là bằng chứng build/deploy, không xác minh API Phase 6 đang bật, Phase 6 migrations ở D1, hoặc các kiểm thử live.

**Bước tiếp theo (chỉ đọc):** lọc/tìm đúng deployment từ branch `feature/staging-demo-quiz-pilot` trên Cloudflare Pages và chụp `Branch / Commit SHA / Status / Deployment URL`. Không bấm Retry/Rollback, không đổi branch control, không kích hoạt Phase6, không merge PR.

## 19. Bước 149 — Đối chiếu deployment Staging PR33 với HEAD PR35

Ảnh Cloudflare Pages Deployments do người vận hành cung cấp hiển thị một Preview `feature/stagin...` tại commit `fc24211`, status thành công, URL deployment riêng dạng hash. GitHub xác nhận `fc242110911df8991d3f5265afbc2da0043e0591` là merge commit PR #33.

So sánh GitHub `fc24211...feature/staging-demo-quiz-pilot`: `ahead_by:11`, `behind_by:0`. GitHub `feature/staging-demo-quiz-pilot` hiện khớp chính xác với PR #35 merge commit `75f2d814b0ef70b5a4ae7118885cd2e0548e69a8` (`status:identical`, `ahead_by:0`, `behind_by:0`). Do đó deployment trong ảnh **cũ hơn HEAD nhánh Staging 11 commit**.

**Chưa xác minh** có hoặc không một deployment mới hơn ở SHA `75f2d81`: ảnh chỉ hiển thị một hàng Staging, không phải danh sách lọc đầy đủ. GitHub combined statuses của merge commit PR35 không trả về status trong lần kiểm tra; không suy ra build thành công/thất bại.

**Bước tiếp theo:** tìm chính xác deployment commit `75f2d81` trên Cloudflare Pages (hoặc chứng minh không có) bằng bộ lọc Staging và trạng thái Details; không Retry/Deploy/Change branch controls trong bước này. PR36 tiếp tục Draft, SQL/flags Phase 6 giữ OFF.

## 20. Bước 150 — Tìm thấy Staging Preview tại HEAD PR35

Theo ảnh Cloudflare Pages → All deployments do người vận hành cung cấp ngày 27/11/2026, bản Preview có Source `feature/stagin...` và commit `75f2d81` hiển thị dấu triển khai **thành công**. URL deployment dạng hash được hiển thị: `https://bb66501a.duongtrcnhiem-test.pages.dev`. Một bản Preview khác thuộc `feature/phase7...` cũng xuất hiện với cùng commit `75f2d81`; chỉ bản Source Staging mới được dùng để xác minh nhánh Staging.

Đối chiếu GitHub: merge commit PR #35 là `75f2d814b0ef70b5a4ae7118885cd2e0548e69a8`; so sánh với `feature/staging-demo-quiz-pilot` cho trạng thái `identical`, ahead/behind đều 0. Vì thế có bằng chứng Dashboard về **Staging Preview deployment successful at HEAD PR35**; không cần kích hoạt redeploy chỉ để tìm commit này.

Cảnh báo phạm vi: trạng thái Pages thành công **không** chứng minh Cloudflare Access áp dụng riêng cho URL hash, runtime đang dùng `AUTH_DB_PREVIEW`, migrations Phase 6 đã áp dụng, flags bật, hay API thực thi thành công. Các phép thử signed student/Admin và dữ liệu Preview vẫn chưa được phép tiến hành cho đến khi gate được review.

**Bước kế tiếp:** click `Details` trên chính dòng `feature/stagin... 75f2d81`, kiểm tra đầy đủ Branch/Commit/Status/Deployment URL và ghi lại chỉ thông tin công khai. Không Retry/Promote/Rollback/merge, không SQL trên D1, không bật `PHASE6_*`.

## 21. Bước 151 — Chi tiết deployment Staging tại HEAD PR35

Ảnh người vận hành cung cấp từ Cloudflare Pages deployment details của dự án `duongtrcnhiem-test`:
- Environment: `Preview`
- Deployment ID: `bb66501a-f7e8-45d6-b19d-8cdffc69f11e`
- Deployment URL: `https://bb66501a.duongtrcnhiem-test.pages.dev`
- Alias: `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`
- Source branch: `feature/staging-demo-quiz-pilot` (giao diện rút gọn `feature/stagi...`)
- Commit: `75f2d81`, merge PR35 (HEAD branch đã đối chiếu trên GitHub)
- Status: `success`, Cloudflare ghi 3:43 PM November 27, 2026; build duration 16s.

**Kết luận:** đúng branch/commit/URL/alias và trạng thái build-deployment thành công theo Dashboard. **Không suy ra** Functions/API đã chạy đúng, D1 binding runtime đã hợp lệ, Access policy áp trên từng URL hash, SQL Phase 6 đã triển khai, hoặc các `PHASE6_*` đã bật.

**Bước kế:** mở tab `Functions` của chính deployment này chỉ để xem các route Functions đã được đóng gói/triển khai, không thực hiện gọi API có quyền ghi, không chạy migration hoặc sửa cấu hình.

## 22. Bước 152 — Tab Functions của Pages Deployment chỉ hiển thị log stream và hướng dẫn Bindings

Ảnh Cloudflare Deployment Details → `Functions` do người vận hành cung cấp chỉ hiển thị thẻ `Bindings` (hướng dẫn cấu hình), khu vực `Real-time Logs (Beta)`, nút `Begin log stream` và trạng thái `Ready to stream`. Không thấy danh sách route hoặc invocation; **không thể suy ra từ ảnh rằng `/api/phase6/*` đang xử lý request thành công hay runtime binding đã sẵn sàng**.

Đã kiểm tra mã tại đúng GitHub merge commit PR35 `75f2d814b0ef70b5a4ae7118885cd2e0548e69a8`:
- `functions/api/auth/status.js` là GET-only, chỉ báo `stage`, `ready`, `d1Connected`, `tablesReady`, `login`, `mode`; chỉ kiểm tra schema `demo_students` và `login_attempts`.
- `functions/_shared/staging-db-binding.mjs` chỉ dùng `AUTH_DB_PREVIEW` tại alias `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`. URL deployment **hash** bị cố ý đặt `AUTH_DB: undefined`.
- Các endpoint Phase 6 exam/results có mặt trong mã nhưng POST-only, Preview-pinned, các cờ độc lập mặc định OFF. Không nên gọi để chẩn đoán trong bước đọc-only.

**Bước kiểm tra an toàn tiếp theo:** trong trình duyệt đã qua Cloudflare Access, truy cập GET `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev/api/auth/status`, chỉ đọc và báo lại các trường boolean; không gửi cookie, mã OTP, bearer token, nội dung bảng hoặc logs. Kết quả `ready:true` chỉ chứng minh endpoint auth baseline, **không** chứng minh schema Phase 6 hiện có. Không bấm `Begin log stream` nếu không cần.
