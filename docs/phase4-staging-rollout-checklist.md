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

## Giai đoạn 4I/4K — URL chính và nhánh Preview riêng biệt (chưa triển khai)

Theo `docs/cloudflare-functions-firebase-staging.md`, dự án Pages thử
`duongtrcnhiem-test` đã dùng URL chính
`https://duongtrcnhiem-test.pages.dev` và nhánh triển khai
`fix-firebase-login`. **Chỉ mới đối chiếu tài liệu trong repository**,
chưa xác minh trạng thái hiện tại của Cloudflare Dashboard.

PR #3 đang nằm trên nhánh `feature/staging-demo-quiz-pilot`; mã trên
nhánh này **không tự xuất hiện** ở URL Pages chính. Cloudflare Pages
có thể tự build Preview cho các nhánh khác, nhưng điều đó phụ thuộc
cấu hình **Preview branch control** của từng Pages project.

Tài liệu chính thức Cloudflare nêu branch alias được tạo bằng cách
đổi ký tự không phải chữ/số thành dấu `-`, nên URL Preview **dự kiến**
cho nhánh trên là:

`https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`

**Alias này đã được xác nhận** trong Cloudflare Pages check của commit
`0cc4159f2eaef05e84548b27480b0f29697e00c9` (Deploy successful).
Cloudflare sử dụng alias rút gọn `feature-staging-demo-quiz-pi`,
không phải alias dài dự đoán từ tên nhánh. Kết quả deployment chỉ chứng
minh thành công build, **chưa chứng minh** Preview được bảo vệ đúng
Cloudflare Access hoặc có binding/secrets D1 Preview.
Trước khi dùng phải vào Cloudflare Dashboard → Workers & Pages →
`duongtrcnhiem-test` → Deployments → mở deployment của đúng nhánh
`feature/staging-demo-quiz-pilot` → kiểm tra hostname, commit SHA,
Build command, `VITE_FIREBASE_ENV=staging`, binding, các lớp
Cloudflare Access và Preview branch control. **Không thay đổi production
branch hoặc cấu hình môi trường** khi chưa được phê duyệt.

Hàm `functions/_shared/phase4-host-guard.mjs` chỉ cho phép hai
hostname **chính xác**, không có wildcard và chỉ khi cấu hình server
khớp với chính hostname đang truy cập:

| Môi trường | `PHASE4_STAGING_HOSTNAME` | Điều kiện bổ sung |
| --- | --- | --- |
| Pages test URL chính | `duongtrcnhiem-test.pages.dev` | Các cờ Phase 4, staging auth và Firebase xác thực |
| Preview nhánh PR #3 | `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev` | **Thêm** `PHASE4_PREVIEW_HOST_OPT_IN=true` cùng các cờ/xác thực bên trên |

Chưa có các biến server này, hoặc chưa bật cờ Phase 4 thì các API
vẫn trả 404. Dù đã bật, học viên vẫn cần token staging hợp lệ,
UID DEMO đang active trong D1; Admin phải qua Google staging JWT.
Không dùng Host/`X-Forwarded-Host` tùy ý, URL hash-based khác,
`http://`, cổng phụ hoặc tên miền khác để bỏ qua giới hạn.

**Đường đi thử nghiệm ưu tiên sau khi có phê duyệt cụ thể:**

1. Đọc Cloudflare Dashboard để xác nhận Preview đã tạo, hostname
   đúng, quyền truy cập Preview bị giới hạn và không bị công khai
   ngoài dự kiến. Kiểm tra **Preview D1 binding** khác với Production
   của Pages test, và không trỏ đến D1 có tài khoản/học viên thật.
2. Xác nhận tệp backup mới, project Firebase staging, phiên bản mã
   build, Access policy và quyền Cloudflare. Nếu Preview bị mọi người
   truy cập được thì **dừng, không bật flags**.
3. Chỉ khi được cho phép: tạo bảng điểm DEMO trên **D1 Preview đã
   xác nhận riêng**, đặt `PHASE4_STAGING_HOSTNAME` đúng alias, bật
   `PHASE4_PREVIEW_HOST_OPT_IN=true` rồi mới bật lần lượt các cờ
   thử nghiệm. Xác nhận phạm vi biến Preview có thể ảnh hưởng nhiều
   nhánh; nếu không phân tách được thì **dừng**.
4. Thử một học viên DEMO ở hai trình duyệt, một Google Admin, kiểm
   tra 401/403, kết quả một lần, tắt flag để rollback. **Không Merge
   PR #3** chỉ để xem Preview; không chạy migration vào D1 đang dùng
   và không mở Access cho toàn Internet.
5. Nếu Preview không tồn tại hoặc alias không đúng, chỉ ghi nhận
   là **chưa sẵn sàng**. Không đổi branch Production Pages test và
   không thêm wildcard để cố truy cập.

Các bài thử `tests/phase4-pinned-host.test.mjs` xác nhận Preview
chỉ qua khi **host khớp và có flag opt-in riêng**, đồng thời từ
chối tên miền chính của website, các hostname hash-based, subdomain
khác, HTTP, giả mạo forwarded-host và thiếu xác thực.

Nguồn tài liệu Cloudflare:
https://developers.cloudflare.com/pages/configuration/preview-deployments/
và https://developers.cloudflare.com/pages/configuration/branch-build-controls/

## Giai đoạn 4N — D1 binding riêng cho bản Preview (chuẩn bị cấu hình)

Ngày 23/11/2026, khi mở `/api/auth/status` trên branch Preview,
kết quả thực tế là `ready:false`, `d1Connected:false`,
`tablesReady:false`. Ảnh Cloudflare cho thấy ở **Preview**
phần `Bindings` trống; Production test Pages đã có
`AUTH_DB → duongtrcnhiem-auth-staging`.

Người quản trị đã tạo **D1 mới rỗng** tên
`duongtrcnhiem-auth-preview` (Number of Tables: 0, Rows written: 0).
Cloudflare UI không cho dùng trùng tên `AUTH_DB` trong màn hình thêm
binding Preview, nhưng chấp nhận tên riêng `AUTH_DB_PREVIEW`.

Các hàm `functions/api/auth/*`, `functions/api/demo-quiz/*` và
`/api/auth/status` được bổ sung
`functions/_shared/staging-db-binding.mjs`:

- Tên miền branch Preview **chính xác**
  `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`
  sẽ dùng **duy nhất** `env.AUTH_DB_PREVIEW`. Nếu biến này vắng mặt,
  tuyệt đối không rơi về `env.AUTH_DB`, dù Cloudflare kế thừa binding
  Production test Pages.
- Tên miền canonical `duongtrcnhiem-test.pages.dev` vẫn dùng `env.AUTH_DB`.
- Những URL deployment hash khác hoặc branch Preview khác của cùng
  Pages project không tự được phép truy cập một trong hai database.

Cấu hình dự kiến tại **Cloudflare Pages → Settings → Preview → Bindings**:

| Binding name | Database |
| --- | --- |
| `AUTH_DB_PREVIEW` | `duongtrcnhiem-auth-preview` |

Không đặt `AUTH_DB_PREVIEW` trên Production. **Chỉ Save binding sau
khi xác nhận hai ô đúng**, không thêm hay xóa binding `AUTH_DB` đang
hoạt động ở Production. Tạo binding cần có một Preview deployment
**sau khi Save** để Functions thấy thay đổi; không cần Merge PR #3.
Việc tạo binding đơn thuần **không chạy SQL, không tạo bảng hoặc cấp
quyền đăng nhập**.

D1 Preview vẫn rỗng: `/api/auth/status` có thể chuyển thành
`d1Connected:true`, nhưng `tablesReady:false` và `ready:false`
là kết quả **đúng dự kiến** cho đến khi có migration và secrets
được thẩm định/cho phép riêng. Không chạy migration, không sao chép
secrets hoặc tài khoản từ database cũ trong bước này.

Bài test `tests/phase4-preview-d1-binding.test.mjs` chứng minh
không có fallback nhầm Production D1 và không trả dữ liệu từ
những URL Preview không được phê duyệt. GitHub CI cũng chạy kiểm
tra này trên mỗi commit của PR #3.

## Giai đoạn 4M — bảo vệ Firebase trong bản Preview

Đã xác minh Cloudflare Pages **deploy successful** commit
`0cc4159f2eaef05e84548b27480b0f29697e00c9`, với URL Preview
`https://70871492.duongtrcnhiem-test.pages.dev` và branch alias
`https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
Cloudflare rút gọn alias; không dùng URL tên nhánh dài dự đoán trước.

Frontend mới chọn **Firebase staging** cho URL chính của test Pages
`duongtrcnhiem-test.pages.dev` và tất cả URL Preview dạng
`*.duongtrcnhiem-test.pages.dev`, ngay cả khi thiếu
`VITE_FIREBASE_ENV=staging`. Điều này **chỉ chọn Firebase staging cho
frontend**, không tự cấp quyền API. Ba endpoint Phase 4 vẫn dùng
**hostname allowlist chính xác**, flags OFF mặc định và kiểm tra JWT,
D1/active-account ở máy chủ.

Trong GitHub Actions, `tests/phase4-firebase-preview-host.test.ts`
kiểm tra rằng Pages test không vô tình dùng Firebase production, còn
hostname trang chính, tên miền gần giống hoặc localhost không bị
đổi môi trường ngoài ý muốn.

**Chưa xác minh thực tế** Firebase Authorized Domains, quyền
Cloudflare Access cho Preview, D1 binding Preview và secrets tại
Dashboard. Thành công build không chứng minh đăng nhập Google/DEMOs
đã hoạt động trên trình duyệt. Không thêm Preview vào Firebase
Authorized Domains hoặc mở Cloudflare Access khi chưa phê duyệt.

## Giai đoạn 4J — kiểm tra bề mặt HTTP staging không cần tài khoản (mới chuẩn bị)

Dự án đã có `scripts/phase4-public-staging-probe.mjs` để **khi người
vận hành cho phép** thử các API từ máy riêng. Công cụ **không tự chạy**:
không có cờ `--allow-network` thì chỉ hiện hướng dẫn và dừng; các bài
test CI thay toàn bộ HTTP bằng `fetch` giả, không kết nối Cloudflare thật.

Khi đã được phép **kiểm tra HTTP không mang dữ liệu học viên**,
có thể chọn URL chính của Pages test hoặc Preview của PR #3:

```powershell
# URL chính của Pages test
node .\scripts\phase4-public-staging-probe.mjs --allow-network

# URL Preview alias của feature/staging-demo-quiz-pilot (chỉ sau khi xác nhận ở Dashboard)
node .\scripts\phase4-public-staging-probe.mjs --allow-network --preview
```

Công cụ chỉ liên hệ đúng một trong **hai hostname cố định**:
`duongtrcnhiem-test.pages.dev` hoặc
`feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`
theo lựa chọn tường minh. Trước khi chọn `--preview`, phải xem alias
và commit có thật trong Cloudflare Pages Dashboard; nếu không thấy
thì dừng, không nhập hostname khác hay tự chuyển hướng. Công cụ
chỉ thực hiện `GET /api/auth/status` cùng ba `POST` không có token:
`/api/demo-quiz/student`, `/api/demo-quiz/admin`,
`/api/demo-quiz/preflight`. Ba lệnh POST chỉ mang JSON cố định
`{"action":"result"}`; **không** đăng nhập, không gửi đáp án, tên,
mật khẩu, Firebase UID hay thông tin người dùng. Các route Phase 4
chưa xác thực phải từ chối trước khi ghi D1. Mọi yêu cầu đều không
gửi cookie, không theo chuyển hướng Cloudflare Access, không retry.

Kết quả chỉ trả về mã trạng thái HTTP và nhãn kiểm tra an toàn:

- `NEW_APIS_OFF_OR_NOT_DEPLOYED`: cả ba route mới đều 404; có thể vì
  **chưa được triển khai**, hoặc đã triển khai nhưng cờ đang tắt.
  Không khẳng định nhánh PR #3 đang được phục vụ trên Pages.
- `ACCESS_GATE_INCONCLUSIVE`: có chuyển hướng/401/403; có thể là
  Cloudflare Access hoặc xác thực API, không cố vượt qua.
- `MANUAL_SECURITY_REVIEW`: một route trả 2xx hoặc 400 khi không
  gửi token; phải kiểm tra vì có thể đã bật API ngoài dự kiến.
- `UNVERIFIED`: có lỗi mạng, hạn mức 429, 5xx hoặc phản hồi khác;
  **không** suy diễn dịch vụ đã sẵn sàng.

Công cụ không in `Location` chuyển hướng, body chứa token, cookie
hoặc nội dung máy chủ không đúng mẫu. Dù `/api/auth/status` thông
báo `ready:true`, đây chỉ là lời khai báo trạng thái; **chưa chứng
minh** D1 binding, schema, file backup, nhánh triển khai hiện tại hay
quyền Cloudflare Access. Đầu ra luôn `approvedForActivation:false`
và `deploymentVerified:false`.

**Hiện chưa chạy công cụ với cờ truy cập mạng, chưa xác minh được
staging thật và chưa có quyền triển khai.** Không bật flag Phase 4
hoặc mở Cloudflare Access để công cụ báo xanh.

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
   sau khi phê duyệt, xác nhận biến server-only
   `PHASE4_STAGING_HOSTNAME=duongtrcnhiem-test.pages.dev` **và**
   bật duy nhất `PHASE4_SYNTHETIC_QUIZ_ENABLED=true` trên Pages test
   project đã xác nhận. Không bật ở GitHub Pages live hay project/host
   preview khác. Chưa được phê duyệt thì không đặt biến/cờ nào.
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

## Phase 4H — chống bỏ qua lỗi D1, khóa tài khoản và tách điểm theo phiên (kiểm thử offline)

- Lệnh lưu bài trong `functions/_shared/synthetic-quiz.mjs` dùng
  `INSERT ... ON CONFLICT(firebase_uid) DO NOTHING` thay cho
  `INSERT OR IGNORE`. Chỉ cho phép gửi lại khi cùng UID đã có điểm;
  lỗi `CHECK`, cấu trúc D1 không khớp và lỗi ràng buộc khác phải nổi lên
  dưới dạng lỗi máy chủ thay vì bị bỏ qua như một lần nộp hợp lệ.
- Kiểm thử SQLite trong bộ nhớ gửi **20 yêu cầu nộp đồng thời** với đáp
  án khác nhau: chỉ một bản ghi được tạo, điểm đã lưu không bị ghi đè.
  Đây là kiểm thử logic, không phải phép đo tải đồng thời 100 người
  trên Cloudflare thật.
- Kiểm thử khóa tài khoản DEMO ngay **trước khi ghi**: lệnh nộp
  không được lưu bài; khóa ngay **sau khi ghi nhưng trước khi đọc**:
  endpoint không được trả điểm cho học viên đã bị vô hiệu hóa.
  Kết quả có thể đã được ghi trước khi khóa, vẫn cần đối chiếu audit nếu
  đây là ứng dụng thật.
- `StagingDemoQuizPanel` được gắn React `key` theo UID học viên
  Firebase đã đối chiếu ở `App.tsx`. Khi đổi tài khoản trong lúc cửa sổ
  Cloud Storage còn mở, câu trả lời/điểm đã đọc cũ được reset thay vì
  hiển thị cho tài khoản mới. Bộ kiểm thử CI có kiểm tra tĩnh liên kết này;
  **chưa thực hiện kiểm thử chuyển tài khoản thực tế trên trình duyệt**.

Việc khóa và mở lại tài khoản DEMO **chưa phải** cơ chế thu hồi
Firebase refresh token/ID token hoàn chỉnh. Không dùng các hàng rào
thử nghiệm này làm xác thực học viên thật.

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
