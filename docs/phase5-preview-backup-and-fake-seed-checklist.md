# Giai đoạn 5: kiểm tra backup và chuẩn bị chuyên đề giả trước khi chạm D1 Preview

**Ngày:** 25/11/2026. **Trạng thái:** Chỉ chuẩn bị trên nhánh GitHub riêng.
KHÔNG có kết nối D1 Cloudflare trực tiếp trong ChatGPT hiện tại.
Chưa xuất/kiểm tra được **bản sao lưu thực tế** của `duongtrcnhiem-auth-preview`;
chưa chạy schema/seed trên D1 thật; chưa bật cờ Phase 5.

## Cơ sở dữ liệu và phạm vi duy nhất

- Pages project: `duongtrcnhiem-test`.
- Preview host đã pin: `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
- Binding **chỉ Preview**: `AUTH_DB_PREVIEW`.
- Database đích **chỉ Preview**: `duongtrcnhiem-auth-preview`.
- Không động đến `AUTH_DB` / `duongtrcnhiem-auth-staging`, Pages Production,
  GitHub `main`, hay Firebase production.
- Ba bảng Phase 4 đã được kiểm thử qua giao diện trước đó:
  `demo_students`, `login_attempts`, `synthetic_graded_attempts`.
  Đây là thông tin từ thử nghiệm trước, KHÔNG phải xác minh cấu trúc live tại hôm nay.
- Phase 5 thêm các bảng `phase5_content_*` trên bản nháp, không sửa bảng cũ.

## 1. Trước khi thao tác: chỉ kiểm tra bằng mắt

Cloudflare Dashboard → **Storage & databases → D1 SQL database** →
**`duongtrcnhiem-auth-preview`**. Xác nhận đúng tên cơ sở dữ liệu,
không phải `duongtrcnhiem-auth-staging`.

Ở mục Backups / Time Travel nếu có, chỉ **xem** thông tin.
Cloudflare Time Travel thường tự duy trì lịch sử theo thời gian và
`restore` là thao tác GHI ĐÈ dữ liệu, tuyệt đối không bấm Restore
để "thử". Khoảng khôi phục mặc định thường là 7 ngày ở Free / 30 ngày
ở Paid, tùy hệ thống và trạng thái D1.
Nguồn: https://developers.cloudflare.com/d1/reference/time-travel/

**Tuyệt đối không tạo/xóa bảng, đổi binding, bật cờ hoặc khôi phục D1
trong bước kiểm tra này.**

## 2. Xuất bản sao dữ liệu thật — để riêng trên máy, không gửi GitHub/chat

Cloudflare có lệnh Wrangler chính thức
`npx wrangler d1 export NAME --remote --output=FILE.sql`
để sao lưu schema và dữ liệu D1 thành SQL.
Nguồn: https://developers.cloudflare.com/d1/best-practices/import-export-data/

Trong PowerShell trên máy người vận hành đã đăng nhập Wrangler bằng
đúng tài khoản Cloudflare, chạy lệnh sau từ thư mục repo (không chạy
nếu chưa xác minh DB tên đúng):

```powershell
npx wrangler d1 info duongtrcnhiem-auth-preview
npx wrangler d1 export duongtrcnhiem-auth-preview --remote --output="$env:USERPROFILE\Documents\d1-preview-before-phase5-20261125.sql"
```

Lệnh `export` chỉ **đọc** D1 nhưng có thể tạm chặn request khác trong
thời gian xuất. Chỉ chạy khi phù hợp hoạt động website.
File `.sql` có thể chứa hash mật khẩu, UID, thông tin đăng nhập và điểm
DEMO; hãy bảo vệ file ở thư mục riêng, không đăng lên GitHub, chat, drive
công khai hoặc dán nội dung vào ảnh chụp. Không chạy `d1 execute`
trong giai đoạn sao lưu.

Nếu không dùng được Wrangler, cần người vận hành có quyền Cloudflare thực
hiện xuất. Không khẳng định đã sao lưu chỉ vì Cloudflare có Time Travel.

## 3. Kiểm tra cấu trúc SQL file theo đúng profile Preview — chỉ đọc, không restore

Trên máy có clone code GitHub mới nhất, kiểm tra tĩnh file vừa xuất:

```powershell
node .\scripts\phase4-inspect-d1-sql-export.mjs --preview "$env:USERPROFILE\Documents\d1-preview-before-phase5-20261125.sql"
```

Chế độ `--preview` yêu cầu `demo_students`, `login_attempts` và
`synthetic_graded_attempts` đúng cột tối thiểu, **không** bắt buộc
`unit_accounts` (vốn thuộc thử nghiệm khác). Công cụ không thực thi SQL,
không gửi mạng, không in nội dung dòng, UID, mật khẩu hoặc đường dẫn.

Khi thấy `SQL_EXPORT_STRUCTURE_REVIEW_ONLY`, điều đó chỉ chứng tỏ
**cấu trúc văn bản** trông phù hợp. Kết quả luôn có
`deployAllowed:false`, `integrityVerified:false`,
`matchesLiveStagingVerified:false` và
`requiresIsolatedRestoreForIntegrityCheck:true`.
`BLOCKED` có nghĩa dừng, đối chiếu lại file và cơ sở dữ liệu.

Để được phép **áp dụng migration thực sự**, ngoài soát file SQL còn cần
bằng chứng xuất bản backup mới, hash/timestamp, kiểm tra file nguyên vẹn,
khôi phục được trên môi trường **cô lập** và đối chiếu số dòng.
**Không** thử khôi phục vào `duongtrcnhiem-auth-preview` đang hoạt động.
Không tải bản sao dữ liệu có UID/mật khẩu lên hệ thống bên ngoài không
được phép chỉ để thử khôi phục.

## 4. Đã chuẩn bị nhưng CHƯA chạy SQL trên D1

- Schema **bản nháp**:
  `serverless/d1-phase5-content-model-draft.sql`.
- Seed DEMO **một lần duy nhất**:
  `serverless/d1-phase5-preview-synthetic-math-seed.sql`.
- Duy nhất một chuyên đề `p5_demo_math`, phiên bản 1:
  "2 + 2 bằng bao nhiêu?" với 4 lựa chọn `3,4,5,6`.
- Đáp án đúng `correct_index=1` (chỉ trong bảng
  `phase5_content_answer_keys` phía server).
- Seed chỉ `INSERT` vào `phase5_content_*` và `UPDATE` trạng thái
  phiên bản từ `draft` sang `published`; không đụng
  `demo_students`, `login_attempts`,
  `synthetic_graded_attempts` hay `unit_accounts`.
- Chạy lại seed sẽ bị lỗi trùng khóa thay vì âm thầm sửa nội dung.
- Kiểm thử bằng SQLite in-memory khởi tạo cả 3 bảng Phase 4 với dữ liệu
  giả trước khi tạo Phase5; xác nhận sau seed dữ liệu Phase4 vẫn giữ
  nguyên, `foreign_key_check` rỗng và `integrity_check` = `ok`.
  Đây KHÔNG thay cho phục hồi backup thật.

## 5. Chốt an toàn khi muốn bật 5B sau này

- Backup thực tế đã được kiểm tra/khôi phục cô lập.
- Đã xác nhận binding `AUTH_DB_PREVIEW` đúng D1 Preview và quyền
  Cloudflare Access của hostname.
- Chỉ chạy schema và seed trên đúng D1 Preview sau khi được duyệt.
- Chỉ bật `PHASE5_READONLY_TOPICS_ENABLED=true` ở Preview sau khi
  bản seed đã xác minh và có khả năng rollback. Không bật cho Production.
- Tài khoản học viên Firebase staging vẫn xác thực và đang active ở D1;
  API chỉ có GET và chỉ đọc chuyên đề `p5_demo_*`.
- Test API của A và B trước khi nối UI. Cấm tải chuyên đề nội bộ và
  thông tin học viên thật trước khi có phê duyệt phân loại/quyền riêng tư.

**Kết luận hiện tại:** Chuẩn bị và kiểm thử offline đã triển khai trên
GitHub riêng; **checkpoint chưa hoàn tất** cho đến khi kiểm tra backup
thực tế. Không được đánh đồng kết quả CI với phê duyệt migration.
