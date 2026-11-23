# Giai đoạn 3 — Đăng nhập học viên thật (kế hoạch triển khai an toàn)

> Tài liệu chuẩn bị cho nhánh `feature/unit-auth-stage3`. CHƯA mở đăng nhập học viên thật; chưa đổi D1, Firebase hoặc cấu hình Cloudflare.

## Hiện trạng được xác minh từ mã nguồn

- Môi trường thử nghiệm: `fix-firebase-login`; Cloudflare Pages staging sử dụng D1 và Firebase project `duongtrcnhiem-staging`.
- `test_hv_*` đăng nhập qua `functions/api/auth/student/login.js`, đọc `demo_students` và phát Firebase Custom Token. Luồng A/B bằng hai trình duyệt đã được kiểm thử bởi người vận hành.
- `test_unit_*` được lưu trong `unit_accounts`, hỗ trợ tạo/khóa/mở/đặt lại mật khẩu và xác minh/đổi mật khẩu thử; **cố ý không phát token hoặc phiên đăng nhập**.
- `functions/_shared/auth.mjs` chứa thuật toán băm `cf-chain-v1` phục vụ **DEMO/staging**; mã nguồn cảnh báo không sử dụng cho người thật khi chưa được đánh giá độc lập.
- `src/App.tsx` còn đường đăng nhập cục bộ cho tài khoản không thuộc `test_hv_*` và `test_unit_*`; cần chặn mọi đường đi vòng qua backend khi triển khai đăng nhập thật.
- `firestore.rules` trong repository hiện có nhiều quyền ghi dành riêng cho `google.com`, không tự động tương thích với Firebase Custom Token học viên. Xác minh và triển khai rules **staging** riêng trước khi bật truy cập dữ liệu học viên thật. Không ghi đè rules production chỉ để kiểm thử.

## Mốc sao lưu đã xác minh — 22/11/2026 (staging)

- Đã nhận được bookmark của D1 staging. **Không chạy lệnh restore** trừ khi có sự cố và đã phê duyệt khôi phục.
- Người vận hành xuất `duongtrcnhiem-auth-staging` bằng Wrangler thành tệp SQL lưu **trên máy tính cá nhân**, không tải lên GitHub.
- Tệp SQL được nạp vào SQLite trong bộ nhớ thành công; số bản ghi so sánh bằng `COUNT(*)` khớp với Cloudflare D1 ngay tại thời điểm kiểm tra: `unit_accounts=1`, `demo_students=4`, `login_attempts=3`.
- Phép đếm này **chưa phải** kiểm toán từng hàng hoặc diễn tập khôi phục toàn bộ Cloudflare D1. Cần giữ bản sao lưu an toàn, sao chép thêm vào kho lưu trữ mã hóa, xác minh được khôi phục trong một cơ sở dữ liệu thử nghiệm trước khi migration dữ liệu thật.

## Chặng 3A đã viết trên nhánh riêng — quản lý tài khoản pilot chưa đăng nhập

- Thêm schema `serverless/d1-phase3-pilot-enrollments.sql` chỉ tạo **hai bảng mới**: `student_pilot_enrollments` và `student_pilot_audit`. Không sửa bảng D1 đang chạy. Chưa chạy migration trên Cloudflare.
- Thêm API `POST /api/auth/admin/pilot-enrollments`, hỗ trợ hai lệnh nội bộ `create` và `list` cho tài khoản GIẢ `pilot_hv_...`. Tài khoản chỉ có trạng thái `pending`, không có mật khẩu, Firebase UID, điểm hay dữ liệu cá nhân. Giới hạn tối đa 100 bản ghi pilot. Ghi audit với UID Admin đã được xác thực.
- API chỉ được phép hoạt động nếu biến server-only `PHASE3_PILOT_ENROLLMENT_ENABLED=true` được cấu hình **riêng trên staging**; mặc định thiếu biến nên trả 404. Ngoài ra vẫn yêu cầu toàn bộ điều kiện staging hiện có và xác thực chữ ký Google Admin. Chưa thêm biến này lên Cloudflare.
- API không mở chức năng đăng nhập hoặc cấp Firebase token, không thay đổi tài khoản test_hv_/test_unit_, không gọi vào cơ sở dữ liệu production.
- Kiểm thử `tests/phase3-pilot-enrollments.test.mjs`, `tests/phase3-auth-isolation.test.mjs` và `scripts/check-phase3-schema.ts` được nối vào GitHub Actions; kiểm tra cú pháp, loại trừ truy cập trái phép, ràng buộc SQLite và build. **Chạy tự động chỉ trên bản mã GitHub, không chạm dữ liệu Cloudflare.**

**Chưa mở tài khoản thật.** Chặng kế tiếp mới thiết kế đăng ký học viên thật, mật khẩu, thu hồi phiên, bảo vệ kết quả và cập nhật Rules staging. Không chạy file SQL hoặc bật biến khi chưa có bước kiểm thử sau đó.

## Chặng 3B — mật khẩu tạm và bắt buộc đổi (đã viết mã, không phát hành)

- Bổ sung `serverless/d1-phase3-pilot-passwords.sql`, đề xuất các bảng **mới, riêng biệt**: `student_pilot_credentials`, `student_pilot_password_attempts`, `student_pilot_password_audit`. Chưa chạy SQL này trên Cloudflare.
- `functions/api/auth/admin/pilot-password-reset.js`: API cấp lại mật khẩu tạm **chỉ cho tài khoản GIẢ** `pilot_hv_...`, yêu cầu chữ ký Firebase Google Admin và flag riêng `PHASE3_PILOT_PASSWORDS_ENABLED=true`. Mặc định API trả 404. Mật khẩu ngẫu nhiên chỉ được trả về một lần trong phản hồi cho Admin, không lưu mật khẩu gốc trong D1.
- `functions/api/auth/student/pilot-password-change.js`: xác nhận mật khẩu tạm qua D1 và thay bằng mật khẩu mới ở backend; đối chiếu trạng thái `pending`, kiểm tra độ mạnh, giới hạn 5 lần thử sai trong 15 phút, cập nhật version/CAS, ghi audit, không trả mã băm hoặc token. Mặc định cũng trả 404.
- Dùng `cf-chain-v1` **chỉ để kiểm thử tài khoản GIẢ**, tương tự mã thử nghiệm trước; thuật toán này KHÔNG phải lựa chọn được duyệt cho người dùng thật. Trước khi dùng với tài khoản thực phải chốt KDF/nhà cung cấp xác thực được đánh giá độc lập.
- Thành công đổi mật khẩu vẫn trả `loginEnabled:false`; không gọi Firebase Custom Token, không cấp phiên đăng nhập, chưa có frontend mới.
- Bài thử `scripts/check-phase3-password-flow.mjs` dùng SQLite **trong bộ nhớ** (không gọi Cloudflare), thực hiện cấp/reissue/đổi mật khẩu, invalidation mật khẩu cũ, khóa sau 5 lần sai, chặn tài khoản `disabled`, và xác minh không có phiên đăng nhập. Các hàng rào tĩnh bổ sung vào `tests/phase3-auth-isolation.test.mjs`.
- Không merge, không bật biến, không triển khai schema lên Cloudflare, không dùng người thật hay dữ liệu thật ở chặng này.

**Vẫn còn thiếu trước khi dùng thật:** thiết kế quản lý danh tính và KDF cho người thật, Firebase UID có kiểm tra, thu hồi phiên hoạt động, Firestore Rules theo UID, tính điểm phía máy chủ, kiểm thử tải và kiểm tra bảo mật riêng.

## Chặng 3C — xác thực Firebase ID Token và kiểm soát phiên ở Cloudflare (đã viết mã, chưa phát hành)

- `functions/_shared/student-session.mjs`: xác minh **Firebase ID Token** đã được Firebase phát hành (không chấp nhận trực tiếp Firebase Custom Token) bằng RSA-SHA256 qua khóa công khai Google. Bắt buộc đúng issuer/audience `duongtrcnhiem-staging`, `sign_in_provider=custom`, UID dạng `student_...`, claim `unitStudent=true` và `unitAuthVersion` hợp lệ, cùng các mốc thời gian chuẩn. Các claim chỉ được tin sau khi chữ ký đã xác minh.
- Đối chiếu **trong D1 mỗi yêu cầu Cloudflare được bảo vệ** với `student_auth_identities`: phải `active=1`, đã đổi mật khẩu, phiên bản xác thực khớp, `auth_time` mới hơn `tokens_valid_after`. Bảng đề xuất này **mặc định active=0, bắt đổi mật khẩu**, chưa tạo/đăng ký tài khoản thật.
- `POST /api/auth/student/session-check`: thử bảo vệ endpoint. Trả 404 trừ khi flag riêng `PHASE3_STUDENT_SESSION_CHECK_ENABLED=true` được bật trên staging; **chưa bật flag**. Endpoint không cấp phiên và không chứa dữ liệu học tập.
- `POST /api/auth/admin/session-block`: Admin Google được xác minh có thể khóa quyền truy cập tại Cloudflare với `active=0`, tăng `auth_version`, cập nhật `tokens_valid_after` và ghi audit có event ID đồng bộ trong giao dịch D1. Mặc định trả 404 trừ khi có `PHASE3_STUDENT_BLOCK_ENABLED=true`; **chưa bật flag**.
- `serverless/d1-phase3-session-registry.sql`, `serverless/d1-phase3-session-audit.sql`: bản phác thảo hai bảng riêng, **chưa chạy trên Cloudflare**.
- `tests/phase3-student-session.test.mjs`: thử RSA chữ ký thật bằng khóa thử trong bộ nhớ; giả mạo chữ ký, sai project/issuer, sai provider, token hết hạn, phiên cũ, sai phiên bản, tài khoản bị vô hiệu hóa đều bị từ chối.
- `scripts/check-phase3-session-block.mjs`: thử SQL với SQLite trong bộ nhớ, bao gồm khóa phiên, audit, khóa lặp lại, tranh chấp phiên bản và quyền Admin. Không sử dụng Cloudflare/Firebase đang chạy.

**Giới hạn quan trọng:** Đây là cơ chế **chặn truy cập vào API Cloudflare** có gọi `authorizeStudentIdentity` trên mỗi yêu cầu; chưa thu hồi Firebase refresh token và **không tự chặn Firestore truy cập trực tiếp**. Firebase có thể tiếp tục chấp nhận ID token còn hạn nếu Firestore Rules chưa kiểm tra metadata phiên hoặc tài khoản. Trước khi dùng với học viên thật phải triển khai thu hồi refresh token bằng cơ chế Firebase được hỗ trợ và cập nhật Rules (hoặc buộc dữ liệu nhạy cảm đi qua backend), sau đó kiểm thử emulator cho A/B/Admin/đã khóa. <https://firebase.google.com/docs/auth/admin/manage-sessions>.

Tài khoản thật vẫn chưa đăng nhập được: thiếu backend cấp danh tính thực, KDF chuẩn/nhà cung cấp xác thực phù hợp, liên kết `firebase_uid` bền vững, phát custom token có claim phiên bản, và giao diện quản trị/học viên được kiểm thử đầy đủ. Không cấp quyền truy cập thật bằng cách bật flag.

## Chặng 3D — Firestore Rules thử nghiệm, kiểm thử thật bằng Emulator (đã có mã, chưa phát hành)

- Tạo **bộ Rules riêng** `firestore.phase3.pilot.rules` và cấu hình `firebase.phase3-emulator.json` cho project giả lập `demo-phase3-session-guard`. KHÔNG sửa `firestore.staging.rules` hoặc `firestore.rules` đang phục vụ app.
- Hai collection **chỉ để kiểm thử**: `pilot_session_states/{studentUid}` (client không được đọc/ghi) và `pilot_session_probes/{ownerUid}` (kết quả giả 7/10; không phải điểm thi thật). Tất cả đường dẫn khác mặc định từ chối.
- Mỗi yêu cầu vào probe phải có UID khớp owner, provider `custom`, claim `unitStudent=true`, phiên bản `unitAuthVersion` khớp với metadata Firestore, `active=true`, và `auth_time > revokeAfterSeconds`. Metadata thiếu / bị khóa / phiên bản không khớp / thời điểm cũ / truy cập chéo UID đều bị từ chối.
- `tests/phase3-firestore-rules.test.mjs` kiểm tra bằng **Firebase Firestore Emulator**, gồm student A/B, người ẩn danh, Google Admin, token phiên bản cũ, thao tác sai dữ liệu, cấm list/update, và sau khi server giả lập khóa phiên thì ID token cũ không thể đọc/xóa probe.
- Workflow `.github/workflows/phase3-firestore-emulator.yml` dùng Firebase CLI + Rules Unit Testing, Java 21, dự án `demo-...`. Không có bất kỳ lệnh `firebase deploy` nào. Kiểm thử Emulator đã đạt trên nhánh phát triển.
- Hạn chế cần xử lý **trước khi bật học viên thật**: endpoint `session-block` hiện ghi D1, chưa có cơ chế tin cậy đồng bộ trạng thái khóa sang tài liệu `pilot_session_states` trên Firestore; hai hệ thống không có giao dịch chéo; phải thiết kế đồng bộ fail-closed, idempotent, quan trắc lỗi và kiểm tra chính thức. Cần thu hồi Firebase refresh token bằng API Admin được hỗ trợ, kiểm thử emulator cả Rules cuối cùng (không chỉ bộ proof độc lập), và bảo vệ các collection dữ liệu học tập thật.
- **Không dùng quy tắc pilot thay nguyên tệp Rules staging**: nó mặc định đóng mọi collection của ứng dụng, sẽ khiến hệ thống đang chạy không truy cập dữ liệu. Nó chỉ là chứng minh kỹ thuật được giới hạn.

Tài liệu Firebase: <https://firebase.google.com/docs/auth/admin/manage-sessions>, <https://firebase.google.com/docs/rules/unit-tests>.

## Chặng 3E — hàng đợi khóa phiên D1 → Firestore (đã có mã thử, không chạy thật)

- Đề xuất schema mới `serverless/d1-phase3-session-mirror-outbox.sql`. Khi Admin khóa một tài khoản trong backend đã được bảo vệ, ba lệnh D1 thực hiện trong cùng **một batch nguyên tử**: khóa trạng thái D1, ghi audit, ghi event outbox trạng thái `pending`. Những thay đổi này mới chỉ ở nhánh phát triển, **chưa chạy migration**.
- `functions/_shared/session-mirror-outbox.mjs` là bộ tiêu thụ hàng đợi **chưa nối HTTP, cron hoặc Firebase thực tế**. Nó cấp lease, có thể lấy lại việc sau khi worker chết, retry theo backoff, yêu cầu bằng chứng `active=false` và version/timestamp không thấp hơn mức cần khóa, rồi mới ghi `delivered`.
- Module chỉ chấp nhận một adapter `writer.applyRevokedState` do **dịch vụ máy chủ tin cậy** cung cấp. Adapter thực phải dùng transaction/điều kiện cập nhật đơn điệu (không giảm phiên bản, không giảm mốc thu hồi và không vô tình mở khóa). Chưa có adapter Firebase production, **không được bật bất kỳ scheduler nào** để tiêu thụ queue ngoài môi trường giả lập.
- `scripts/check-phase3-mirror-outbox.mjs` kiểm tra tại chỗ bằng SQLite trong bộ nhớ: khi writer lỗi thì queue được giữ và thử lại, không trả kết quả giả rằng Firestore đã khóa; xử lý lặp, cạnh tranh lease, mất worker, sự kiện đến muộn, và version không bị lùi.
- `tests/phase3-firestore-outbox-bridge.test.mjs` nối D1 SQLite giả lập với Firestore Emulator. Nó cố ý chứng minh lỗ hổng thời gian: **sau khi D1 bị khóa nhưng trước khi queue được giao, người dùng vẫn có thể đọc Firestore trực tiếp**. Sau khi adapter thử ghi trạng thái khóa, Firebase Rules từ chối token cũ, và học viên B không bị ảnh hưởng.
- Không có token thật, mật khẩu thật hoặc dữ liệu học viên thật trong bất kỳ bài thử nào. Không đưa queue schema vào cơ sở dữ liệu Cloudflare đang dùng.

**Điểm chặn an toàn trước khi đưa vào vận hành:**
1. Hoàn thiện adapter Firebase tin cậy, kiểm tra quyền/phiên của tài khoản thật, cơ chế tái lập từ log và quan trắc queue trễ/chết; kiểm thử bằng emulator và staging tách biệt.
2. **Khoảng trễ đồng bộ có thể làm Firestore vẫn truy cập được dù D1 đã khóa**. Không dùng mô hình Firestore trực tiếp cho dữ liệu nhạy cảm khi chưa có giải pháp chặn đồng bộ tức thì, hoặc chuyển mọi truy cập dữ liệu nhạy cảm qua backend kiểm tra D1 trên mỗi yêu cầu.
3. Cần thêm quy trình Firebase Admin revoke refresh tokens/disabled user, chính sách mở khóa, đồng bộ hai chiều hoặc một nguồn thẩm quyền, xử lý re-enable sau khóa, và Firestore Rules cuối cùng.
4. Chỉ cho phép dữ liệu thật sau khi có phê duyệt vận hành và rà soát an ninh đầy đủ.

## Chặng 3F — adapter Firebase OAuth có kiểm tra phiên bản (đã viết và kiểm thử giả lập, chưa nối vận hành)

- `functions/_shared/firestore-session-writer.mjs` là adapter **chỉ phía máy chủ**, dùng JWT ký bởi **tài khoản dịch vụ riêng** để đổi lấy Google OAuth token có scope `https://www.googleapis.com/auth/datastore`. Không dùng lại khóa đăng nhập học viên; không chứa SDK Admin trong frontend.
- Chỉ ghi `pilot_session_states/student_...` thuộc `duongtrcnhiem-staging`, không nhận tên project, collection hoặc đường dẫn từ client. Trước khi ghi đọc phiên bản Firestore và dùng precondition `currentDocument.updateTime` / `currentDocument.exists=false` để tránh ghi đè khi có cập nhật cạnh tranh. Giá trị `active=false` không bao giờ bị đổi thành true bởi adapter.
- Sau khi ghi, adapter đọc lại tài liệu và chỉ xác nhận thành công nếu trạng thái thực sự đã khóa, version và thời điểm thu hồi **không thấp hơn** yêu cầu. Nếu phiên bản mới hơn đang mở (`active=true`), yêu cầu cũ bị từ chối và cần người vận hành kiểm tra thay vì vô tình khóa phiên mới.
- Cần ba cấu hình **server-side** trên staging mới có thể khởi tạo: `PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED=true`, `PHASE3_FIRESTORE_SERVICE_ACCOUNT_EMAIL`, `PHASE3_FIRESTORE_PRIVATE_KEY`. Mặc định không được cấu hình, nên adapter **không hoạt động**; các secret phải được bảo vệ trong Cloudflare Secrets, không đưa vào GitHub, chat hay frontend. Tài khoản dịch vụ này cần IAM riêng tối thiểu có thể dùng được; OAuth từ tài khoản dịch vụ **bỏ qua Firestore Security Rules**, nên không thể thay cho kiểm soát IAM.
- `tests/phase3-firestore-writer.test.mjs` kiểm tra ký OAuth RS256 bằng khóa thử tạo trong bộ nhớ, mục tiêu project cố định, ghi mới, cập nhật có điều kiện, giao dịch cạnh tranh, sự kiện cũ, và lỗi OAuth/Firestore. Toàn bộ HTTP được mô phỏng, **không gửi yêu cầu tới Google thật**.
- Adapter **chưa được nối** vào trình tiêu thụ outbox, HTTP route hoặc lịch chạy; chưa có truy cập đến Firebase Auth, chưa thu hồi refresh token, chưa tắt user Auth, và chưa có quy trình bù trừ khi đồng bộ thất bại. Không bật flag hoặc triển khai migration lúc này.
- Kết quả của phần kiểm thử chỉ khẳng định logic trong môi trường mô phỏng; trước khi hoạt động thực tế phải kiểm thử IAM, API REST thực, account disable/revoke, Firestore Rules và trường hợp mở khóa, kèm cảnh báo hàng đợi trễ.

Tham khảo tài liệu chính thức: <https://firebase.google.com/docs/firestore/use-rest-api>, <https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/patch>.

## Chặng 3G–3H — Firebase Auth disable + điều phối hai dịch vụ (đã lập trình, chưa triển khai)

- `functions/_shared/firebase-auth-revoker.mjs`: adapter thử nghiệm dành cho tài khoản GIẢ `student_...`, sử dụng **tài khoản dịch vụ riêng** và OAuth 2.0, scope `https://www.googleapis.com/auth/identitytoolkit`. Chỉ gửi yêu cầu quản trị tới **đúng Firebase staging** `/v1/projects/duongtrcnhiem-staging/accounts:update` với `localId`, `disableUser=true` và `validSince` không thấp hơn mốc thu hồi. Sau cập nhật phải gọi `accounts:lookup` để xác minh `disabled=true` cùng `validSince`, không tin mỗi HTTP 200. Cần IAM `firebaseauth.users.update` và `firebaseauth.users.get`.
- Tham số server-only cho adapter: `PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED=true`, `PHASE3_AUTH_SERVICE_ACCOUNT_EMAIL`, `PHASE3_AUTH_PRIVATE_KEY`. **Chưa cấu hình** những biến này trên Cloudflare; không đưa khóa JSON hay token vào kho GitHub/chat.
- `functions/_shared/pilot-revocation-coordinator.mjs` nối Firestore writer + Firebase Auth revoker làm một tác vụ duy nhất của bộ tiêu thụ outbox D1. Nó kiểm tra D1 vẫn `active=0`, `auth_version` còn khớp và mốc thu hồi không bị hạ; **kiểm tra lại ngay trước khi gọi Firebase Auth** để giảm nguy cơ khóa một tài khoản đã được Admin mở lại. Nếu một bước lỗi, không trả xác nhận hoàn tất và outbox sẽ thử lại.
- `runTrustedPilotRevocationCycle` là hàm dành riêng cho backend nội bộ, chỉ hoạt động nếu cả ba cờ `PHASE3_TRUSTED_REVOCATION_DRAIN_ENABLED=true`, `PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED=true`, `PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED=true`. **Không gắn vào HTTP route, lịch cron, frontend hoặc dịch vụ nào đang chạy.**
- `tests/phase3-firebase-auth-revoker.test.mjs` thử chữ ký OAuth RSA với khóa thử, dự án cố định, tài khoản sai, disable + validSince, lỗi mạng, lỗi xác nhận và không cấp quyền ngoài phạm vi. `tests/phase3-revocation-coordinator.test.mjs` thử trình tự D1 → Firestore → D1 → Firebase Auth, các tình huống mất kết nối, đổi phiên bản và sai xác nhận. Toàn bộ API Google được giả lập và kiểm thử dùng dữ liệu giả.
- **Chưa giải quyết hoàn toàn tính nguyên tử giữa D1, Firebase Auth và Firestore**: D1 không thể giao dịch nguyên tử với Google. Có khoảng trễ đồng bộ sau khóa và vẫn có khả năng mở khóa đồng thời trong khi tác vụ đang chạy; trước khi vận hành phải thiết kế quy trình mở khóa chỉ khi hàng đợi hết tác vụ, áp dụng hàng rào phiên bản, cảnh báo tác vụ lỗi, diễn tập phục hồi và bảo vệ dữ liệu nhạy cảm thông qua backend.
- `disableUser=true` ngăn đăng nhập/đổi token mới, nhưng ID token đã phát hành có thể còn hợp lệ tới khi hết hạn; cần Firestore Rules chặn dựa trên trạng thái máy chủ cùng kiểm tra D1 ở API. Không được chỉ dựa vào thao tác cập nhật Firebase Auth.
- Đối với Cloudflare Pages, nếu sau này cần chạy định kỳ, cân nhắc **Worker riêng** với Cron Trigger và quyền tối thiểu; chưa tạo cron hoặc quyền IAM mới. Không mở một endpoint tiêu thụ hàng đợi có thể gọi từ Internet trước khi có chứng thực nội bộ, kiểm soát tốc độ và audit.

Tham khảo: <https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/update>, <https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup>, <https://firebase.google.com/docs/auth/admin/manage-sessions>, <https://developers.cloudflare.com/workers/configuration/cron-triggers/>.

## Chặng 3I–3J — giám sát hàng đợi và chốt điều kiện mở khóa (mã thử nghiệm, chưa triển khai)

- `functions/_shared/pilot-outbox-health.mjs`: thống kê **chỉ đọc** D1 về tổng yêu cầu đang chờ, đang xử lý, đã giao, quá hạn 5 phút, xử lý lỗi 5 lần trở lên, lease hết hạn và yêu cầu đến hạn gửi lại. Phân mức `clear` / `attention` / `critical`; kết quả **không chứa Firebase UID, tên, mật khẩu, token hay event ID**. Tình trạng `clear` không có nghĩa rằng toàn bộ quyền truy cập Firebase đã bị thu hồi.
- `POST /api/auth/admin/pilot-queue-health`: endpoint xem số liệu **mặc định 404**, chỉ hoạt động trong môi trường staging khi cấu hình riêng `PHASE3_PILOT_QUEUE_MONITOR_ENABLED=true` và có Firebase Google Admin ID Token đã xác minh. Đây chưa phải hệ thống cảnh báo, dashboard hay theo dõi định kỳ; **chưa bật** trên Cloudflare.
- `functions/_shared/pilot-unlock-preflight.mjs`: **kiểm tra an toàn chỉ đọc**, không phải API mở khóa. Phải xác minh D1 vẫn khóa, tất cả sự kiện outbox liên quan đã `delivered`, block gần nhất đúng phiên bản, trạng thái Firestore thật là `active=false` và mốc thu hồi không thấp hơn D1, Firebase Auth thật đang `disabled=true` và `validSince` không cũ hơn mốc D1. Thiếu bất kỳ bằng chứng nào đều phải từ chối.
- Ngay cả khi preflight trả `eligibleForManualReview=true`, giá trị `canEnableNow=false` **luôn đúng**; không có tài khoản nào được mở tự động, không cấp token, không viết D1/Firebase. Đây chỉ là ảnh chụp trạng thái có thể lỗi thời, **không phải xác nhận an toàn để mở khóa**.
- Bộ kiểm thử `tests/phase3-queue-health.test.mjs` và `tests/phase3-unlock-preflight.test.mjs` kiểm tra số liệu SQL với SQLite giả lập, không tiết lộ UID/token, chặn người chưa xác thực, từ chối hàng đợi lỗi, trường hợp lệch trạng thái ba hệ thống, và cấm thao tác mở khóa từ preflight. Các bài thử này được nối vào GitHub Actions.

**Điểm chặn vận hành vẫn còn:** trước khi mở khóa tài khoản thật phải thiết kế một quy trình khóa/mở **nguyên tử ở cấp D1 với phiên bản tăng dần**, khóa phát hành token trong lúc trạng thái chuyển đổi, đọc lại có điều kiện sau mỗi bước từ xa, cập nhật Firestore Rules cuối cùng, xử lý mất kết nối và tái cấp mật khẩu/phiên mới. Phải có lịch xử lý hàng đợi, cảnh báo sự cố và phê duyệt IAM riêng, nhưng chưa kích hoạt. Không đưa dữ liệu học viên thật vào môi trường thử nghiệm này.

## Phạm vi tối thiểu

1. Admin được máy chủ xác thực có quyền tạo học viên, cấp mật khẩu tạm một lần, khóa/mở và reset mật khẩu; mọi thao tác được ghi audit không chứa mật khẩu.
2. Học viên phải đổi mật khẩu tạm trước khi được cấp Firebase Custom Token; đăng nhập sau đó thông qua backend, không qua mật khẩu trong localStorage.
3. D1 lưu trạng thái và mã băm bằng phương án KDF **được chuẩn hóa, được thẩm định cho tài khoản thật**; không dùng `cf-chain-v1` DEMO cho tài khoản thật.
4. Firebase UID ổn định, không trùng hoặc dùng lại UID DEMO; hoàn thiện cấp danh tính và khôi phục khi lỗi giữa D1/Firebase.
5. Firestore Security Rules kiểm tra danh tính và quyền theo UID; học viên đọc được nội dung được phép và chỉ ghi/đọc kết quả thuộc mình. Admin vẫn yêu cầu Google Admin được xác nhận trên máy chủ.
6. Khi Admin khóa/reset tài khoản, các phiên cũ cũng bị chặn theo chính sách thu hồi token và/hoặc kiểm tra trạng thái; không chỉ đổi cờ `active` trong D1. Xem xét cả thời gian sống của ID token.
7. Đăng nhập cùng tài khoản trên hai trình duyệt, đọc lại kết quả, và kiểm thử học viên B không đọc/xóa kết quả của A.

## Hàng rào an toàn khi làm

- Chỉ code trên nhánh riêng; không merge hay triển khai staging mặc định khi chưa có kiểm thử và phê duyệt.
- Sao lưu D1 trước khi chạy migration hoặc sửa dữ liệu; xác minh có phương án khôi phục.
- Dùng cờ riêng (mặc định tắt) để bật pilot tài khoản thật trên **staging**; không dùng `STAGING_AUTH_ENABLED` hiện tại để ngầm mở toàn bộ hệ thống.
- Không thay đổi dữ liệu, mật khẩu hoặc UID của `test_hv_*`, `test_unit_*`, Google Admin, tài khoản đang vận hành và môi trường Firebase production.
- Không in mật khẩu, khóa riêng tư, custom token hoặc mã băm vào log / phản hồi công khai / ảnh chụp màn hình.
- Mọi thao tác cấp/khóa/reset được xác thực và phân quyền **ở backend**, không tin vai trò do browser gửi.

## Kiểm thử bắt buộc trước khi bật tài khoản thật

- [ ] Kiểm tra snapshot/backup D1 trước migration và khả năng rollback.
- [ ] Thử tài khoản mới: tạo -> bị khóa/chờ reset -> đổi mật khẩu -> đăng nhập thành công.
- [ ] Thử sai mật khẩu, vượt giới hạn, tài khoản không tồn tại, không lộ thông tin tài khoản.
- [ ] Thử Admin không được xác thực, người lạ tạo/khóa/reset tài khoản: phải bị từ chối.
- [ ] Thử khóa hoặc reset khi học viên đã đăng nhập: không được tiếp tục truy cập dữ liệu được bảo vệ.
- [ ] Thử hai trình duyệt cùng học viên nhận đúng dữ liệu; học viên B không đọc/xóa dữ liệu của A.
- [ ] Thử `test_hv_*` và `test_unit_*` vẫn giữ đúng hành vi cũ.
- [ ] Typecheck, kiểm thử backend, Firebase Rules emulator, staging integration và rollback thử.
- [ ] Kiểm tra bảo mật độc lập của mật khẩu/session/rules trước khi sử dụng với dữ liệu thật.

## Bước chuẩn bị tiếp theo

Xác nhận bản sao lưu D1 staging. Sau đó triển khai từng phần backend trên nhánh riêng, có kiểm thử, trước khi sửa giao diện hoặc bật cờ cho pilot. Mọi phát hành ra môi trường chạy phải được duyệt riêng.
