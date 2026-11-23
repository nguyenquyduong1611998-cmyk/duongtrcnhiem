# Giai đoạn 4C — Checklist triển khai DEMO trên staging (chưa thực hiện)

> **Chỉ là tài liệu bàn giao và diễn tập offline.** Không một lệnh nào trong tài liệu
> này đã được chạy lên Cloudflare D1, Firebase hay website đang hoạt động.
> Không triển khai khi chưa có sự chấp thuận riêng của người quản trị.

## Phạm vi duy nhất cho lần thử

- Cloudflare Pages **staging/preview đã kiểm tra độc lập**, không phải trang chính.
- Firebase **duongtrcnhiem-staging** và D1 **duongtrcnhiem-auth-staging**.
- Chỉ thử tính năng `PHASE4_SYNTHETIC_QUIZ_ENABLED`, không mở bất kỳ
  `PHASE3_*` nào, không bật đồng bộ học viên thật, không thay đổi Firebase Rules.
- **Một** migration mới: `serverless/d1-phase4-synthetic-graded-quiz.sql`.
- Bảng được tạo là `synthetic_graded_attempts`; không truy cập/sửa bảng điểm
  `attempts` hiện có, không tải đề thi thật hay danh sách học viên thật.

## Công cụ kiểm tra schema chỉ đọc (mới chuẩn bị, chưa triển khai)

Mã nguồn `functions/_shared/phase4-staging-preflight.mjs` và route
`POST /api/demo-quiz/preflight` hỗ trợ đọc schema D1 **sau này**, nếu riêng
môi trường staging được phê duyệt triển khai và bật cờ server
`PHASE4_STAGING_PREFLIGHT_ENABLED=true`. Mặc định endpoint là 404, yêu cầu
**Firebase Google Admin ID Token được xác minh**, chỉ nhận JSON
`{"action":"inspect"}`; không chấp nhận SQL tùy ý từ người dùng.

Kết quả trả trạng thái `REVIEW_MIGRATION_ONLY`,
`SYNTHETIC_SCHEMA_PRESENT` hoặc `BLOCKED`, tên bảng cố định, trạng thái cột,
khóa ngoại/trigger/index và các **số đếm tổng hợp**. Không trả từng bản ghi,
UID, mật khẩu, token, định nghĩa bảng hay bí mật. Các truy vấn chỉ gồm
`SELECT` và `PRAGMA`; không có `CREATE`, `ALTER`, `DROP` hoặc `UPDATE`.
Endpoint không xác nhận đã có bản sao lưu, quyền IAM, hostname, hay quyền
được phép triển khai; trường `deploymentAuthorized` luôn là `false`.

**Hiện chưa có kết nối Cloudflare D1 trực tiếp trong cuộc hội thoại để kiểm
tra staging thật.** Không có người dùng nào đã bật endpoint này; mọi kiểm
thử cho nó chỉ dùng SQLite giả lập và token Google được ký thử trong bộ nhớ.
Tình trạng `REVIEW_MIGRATION_ONLY` chỉ có nghĩa cấu trúc cơ sở đạt điều kiện
để con người **xem xét**, không tự cho phép áp dụng migration.

## Kiểm tra bản sao lưu SQLite trên máy (mã Phase 4E, chưa đọc dữ liệu thật)

Có thêm công cụ nội bộ `scripts/phase4-verify-local-backup.mjs` chỉ đọc
bản sao lưu **định dạng cơ sở dữ liệu SQLite** đang lưu trên máy.
Nó **không** kết nối Internet, không chạy migration, không đổi nội dung
tệp và không tải bản sao lưu lên GitHub/Cloudflare/ChatGPT.

Ví dụ với PowerShell trên Windows, từ thư mục mã nguồn đã có Node.js:

```powershell
node .\scripts\phase4-verify-local-backup.mjs "C:\duong-dan-rieng\staging-backup.sqlite"
```

Chỉ dùng đường dẫn của **bản sao lưu đã tạo trước**; đừng trỏ vào tệp
cơ sở dữ liệu đang hoạt động. Không chia sẻ đường dẫn thật, nội dung
backup, tên tài khoản, mật khẩu hoặc token trong ảnh chụp màn hình.
Đầu ra chỉ gồm trạng thái schema, số bản ghi tổng hợp và các cờ
`deployAllowed:false`, `isFreshBackupVerified:false`,
`matchesLiveStagingVerified:false`.

Khi báo `LOCAL_STRUCTURE_CHECK_PASSED`, điều đó chỉ có nghĩa
SQLite trong tệp cục bộ đã vượt qua `PRAGMA integrity_check`,
`PRAGMA foreign_key_check` và kiểm tra schema hiện biết.
Đây **không** phải xác thực sao lưu mới, so khớp với D1 thật,
đã cấp quyền triển khai hay đã thử khôi phục thành công.

**Quan trọng:** Cloudflare D1 có thể xuất bản sao lưu dạng `.sql`,
khác với ảnh cơ sở dữ liệu SQLite (`.sqlite`/`.db`).
Công cụ kiểm tra SQLite vẫn **từ chối file SQL**
(`BACKUP_NOT_SQLITE_SNAPSHOT`) để không vô tình thực thi tệp SQL.
Với file `.sql`, dùng **công cụ riêng chỉ đọc và không thực thi SQL**:

```powershell
node .\scripts\phase4-inspect-d1-sql-export.mjs "C:\duong-dan-rieng\staging-export.sql"
```

Công cụ Phase 4F này chỉ xem văn bản xuất D1 để đối chiếu **khai báo
bảng và các cột bắt buộc**. Nó loại trừ nội dung comment/chuỗi dữ liệu,
phát hiện thiếu bảng, khai báo trùng và những câu lệnh có thể làm thay
đổi dữ liệu cần rà soát. Không chạy SQL, không gọi Cloudflare, không
hiển thị hàng dữ liệu, tên tài khoản, mật khẩu hoặc đường dẫn file.

Trạng thái `SQL_EXPORT_STRUCTURE_REVIEW_ONLY` chỉ có nghĩa phần
**khai báo cấu trúc** đã được nhận diện để tiếp tục xem xét thủ công.
Không có xác nhận bản SQL hoàn chỉnh, thực thi được hoặc chứa đầy đủ
dữ liệu. Đầu ra luôn có `integrityVerified:false`,
`foreignKeysVerified:false`, `rowsVerified:false`,
`importabilityVerified:false`, `deployAllowed:false`.
Khi `BLOCKED`, phải dừng để đánh giá nguyên nhân; không chạy SQL đó.

Vẫn bắt buộc một lần **khôi phục thử được thẩm định trong môi trường
SQLite cô lập**, rồi kiểm tra tính toàn vẹn, khóa ngoại, số bản ghi
và đối chiếu với D1 staging thật. **Chưa có thao tác khôi phục thử nào
được tự động hóa hoặc thực hiện trên bản sao lưu thực tế.**
Công cụ chỉ đọc text hỗ trợ tối đa 32 MiB; tệp lớn hơn cần quy trình
xét duyệt riêng, không tự cắt hoặc nén lại để coi là hoàn tất.

Bộ kiểm thử `tests/phase4-local-backup-verify.test.mjs` chạy trên
file SQLite giả được tạo tạm: xác nhận không thay đổi byte nào, không
lộ tài khoản và mật khẩu, chặn schema thiếu, khóa ngoại lỗi và từ chối
SQL dump có nội dung nguy hiểm. **Chưa kiểm tra file backup thật**.

## Cửa kiểm soát trước khi ghi D1

1. GitHub Actions của **commit định triển khai** phải đạt: TypeScript/build,
   `phase4-synthetic-quiz.test.mjs`,
   `phase4-synthetic-quiz-http-e2e.test.mjs`,
   `phase4-staging-migration-dry-run.test.mjs`,
   `phase4-local-backup-verify.test.mjs`,
   `phase4-sql-export-static.test.mjs` và kiểm
   tra hồi quy các tính năng đang chạy.
2. **Kiểm tra read-only trên D1 staging** bằng tài khoản có quyền phù hợp:
   xác nhận có `demo_students`, `login_attempts`, `unit_accounts`; đối chiếu
   `sqlite_master` và `PRAGMA table_info` với schema đã được triển khai
   (không suy ra schema thật chỉ từ file trong GitHub). Xem có tên
   `synthetic_graded_attempts`/trigger trùng hay không; nếu có thay đổi
   không dự kiến thì **dừng lại, không chạy migration**.
3. **Sao lưu mới tại thời điểm triển khai**, không dùng mặc định bản
   22/11/2026 làm bản sao lưu hiện tại. Kiểm tra tệp backup đọc được trong
   SQLite riêng, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`,
   đối chiếu số dòng và mẫu schema. Không đưa backup chứa dữ liệu hay bí mật
   lên GitHub/chat.
4. Xác minh rõ binding `AUTH_DB` trỏ đúng staging D1 và Firebase project
   là `duongtrcnhiem-staging`; kiểm tra hostname Cloudflare Pages preview
   và chính sách auto-deploy **trước khi push/merge**. Không cấu hình
   Firebase Auth key hoặc secret trong frontend/Vite.
5. Người vận hành phê duyệt rõ việc thử **riêng môi trường staging** và
   kế hoạch xử lý sự cố. Chưa được phê duyệt thì **không tiếp tục**.

## Quy trình triển khai có kiểm soát — chỉ áp dụng sau khi phê duyệt

1. Giữ tính năng OFF, xác nhận bản backup mới nhất; tiến hành migration
   `serverless/d1-phase4-synthetic-graded-quiz.sql` vào đúng **staging D1**
   bằng phương thức triển khai đã thẩm định. **Không chạy** các file D1 Phase 3
   hoặc thay đổi Firebase Rules.
2. Kiểm tra read-only: bảng `synthetic_graded_attempts` tồn tại, rỗng;
   index và trigger `synthetic_grade_no_update` tồn tại, dữ liệu/tổng số dòng
   `demo_students`, `login_attempts`, `unit_accounts` không thay đổi;
   integrity và foreign key check sạch.
3. Triển khai code tương ứng đúng commit trên staging preview đã xác nhận;
   bật duy nhất biến server-only
   `PHASE4_SYNTHETIC_QUIZ_ENABLED=true` trên môi trường staging đó.
   Không bật ở `main`, production hoặc preview khác.
4. Dùng trình duyệt A đăng nhập tài khoản `test_hv_*` DEMO hiện có, mở
   **Kiểm thử Cloud Storage → Bài kiểm tra DEMO**, chọn đáp án và nộp một
   lần. Quan sát điểm do máy chủ trả về; không gửi điểm từ frontend.
5. Trình duyệt B đăng nhập cùng tài khoản DEMO (phiên độc lập) → đọc lại
   kết quả từ D1; dùng một tài khoản DEMO khác kiểm tra **không đọc được**
   điểm của người thứ nhất. Trình duyệt Admin đăng nhập Google staging →
   xem danh sách điểm hai tài khoản.
6. Kiểm tra tài khoản đã khóa không nộp/đọc được, Admin chưa đăng nhập
   không xem được, gửi đáp án lại không thay đổi điểm, và HTTP cache
   `no-store`. So sánh D1 với API. Chỉ ghi nhận các **ID giả đã che bớt**,
   không lưu token/mật khẩu/khóa hay dữ liệu thật trong báo cáo.
7. Đánh giá lại backup và quyền truy cập trước khi cân nhắc mở rộng.
   **Không dùng kết quả DEMO như điểm chính thức.**

## Phase 4G — nộp bài mất kết nối và kết quả đã có từ phiên khác (chưa thử trên mạng thật)

Frontend staging xử lý ba trạng thái kết quả riêng: `new` là lượt nộp mới
được máy chủ xác nhận; `existing` là bài đã nộp từ trước (có thể ở một
trình duyệt khác), không ghi đè điểm; `recovered` là trình duyệt không
nhận được phản hồi của lệnh nộp nhưng sau đó **đọc được một điểm đã lưu**
từ D1. Trạng thái `recovered` **không chứng minh chính yêu cầu vừa gửi
đã tạo ra điểm**, vì trình duyệt khác có thể đã nộp bài trước đó.

Khi yêu cầu nộp bài bị lỗi mạng hoặc trả phản hồi thành công không đọc
được nội dung, frontend chỉ gọi `result` thêm **một lần** để đối chiếu
D1. **Tuyệt đối không tự động nộp lại đáp án**. Nếu không thể đọc D1
hoặc chưa có điểm, giao diện hiện lỗi và hướng dẫn dùng nút đọc kết quả;
không tự nhận đã nộp thành công. Lỗi rõ ràng như 401, 403, 404, 5xx
không được đổi thành thông báo thành công.

Nếu máy chủ trả 409 `ALREADY_SUBMITTED` cùng điểm đã lưu, giao diện
hiển thị rõ đây là **kết quả cũ**, không phải kết quả nộp mới. Phải
kiểm tra trên hai trình duyệt thật rằng điểm không bị ghi đè và trạng
thái hiển thị chính xác khi mất mạng. Bộ kiểm thử
`tests/phase4-browser-submit-recovery.test.ts` dùng dữ liệu giả để
chứng minh không có POST tự động thứ hai; chưa kiểm chứng qua Internet.

## Tiêu chí dừng và cách quay về trạng thái an toàn

- Bất cứ lỗi schema, quyền truy cập, tài khoản khác xem được điểm, sai D1
  binding, không thể đọc backup hoặc điểm khác nhau giữa hai trình duyệt
  đều là tín hiệu **DỪNG**.
- **Tắt ngay** `PHASE4_SYNTHETIC_QUIZ_ENABLED` trên staging để hai API trả
  404. Nếu cần, trả staging code về commit đã kiểm chứng.
- Không vội `DROP TABLE`, xóa dữ liệu hay restore D1 từ backup:
  đó là thao tác hủy dữ liệu, cần kế hoạch và phê duyệt riêng. Migration
  được thiết kế additive; khi tắt cờ, bảng mới có thể để nguyên không dùng.
- Cần đánh giá sau sự cố, sửa mã trên PR Draft và kiểm thử lại trước
  khi bật cờ.

## Những gì bài diễn tập offline *không* chứng minh

- Không phải một cuộc thử trên Cloudflare D1 staging thực tế, không chứng minh
  quyền IAM, hostname, cấu hình Pages hoặc backup 22/11 còn cập nhật.
- 100 tài khoản chỉ là dữ liệu giả trong SQLite, không phải benchmark tải
  100 người dùng đồng thời, không chứng minh độ trễ trên mạng thật.
- Chưa có đăng nhập học viên thật, đề thi chính thức, chấm bài thật, quản lý
  kết quả chính thức, chống gian lận hoặc thu hồi đầy đủ Firebase ID Token.
- Khi cần bàn giao thật, người vận hành phải chấp thuận chính xác môi trường,
  phạm vi migration và cửa sổ triển khai; **không merge PR #2** chỉ để thử một
  endpoint nhỏ.
