# Giai đoạn 6B — Google Admin quản lý đề toán giả trên Preview (mặc định OFF)

Ngày 25/11/2026. Nhánh gốc: `feature/staging-demo-quiz-pilot`.
Giai đoạn 6A và PR16 đã được gộp vào nhánh Preview.

## Chức năng trong PR này

- Trang Admin có một mô-đun **tùy chọn** cho các bản nháp toán học DEMO.
  Có thể tạo, liệt kê, mở, đổi tên từ ba nhãn cố định, đặt **1–240 phút**,
  chọn / bỏ / sắp xếp tối đa **12 câu hỏi giả** từ bốn biểu thức toán.
  Chỉ lưu ở D1 khi Admin bật hành động và API đã được phép sử dụng.
- API `POST /api/phase6/admin/drafts` xử lý các action
  `list`, `get`, `create`, `save`, `delete`.
  Không có `publish`, `submit`, `import`, nộp bài hay xem điểm.
- Cấu trúc nháp tách biệt: `phase6_admin_drafts` lưu mã mẫu và thông số,
  không lưu nội dung câu hỏi tự do hay thông tin học viên.
  `phase6_admin_draft_events` ghi sự kiện `create/save/delete`
  để truy vết metadata; không lưu token/đáp án/điểm.
- Từng lần `save` và `delete` đòi `version` trùng bản ghi trong D1
  (optimistic concurrency), từ chối 409 khi hai thiết bị sửa cùng một bản cũ.
- Mã template và đáp án mẫu chỉ ở module `functions/_shared`;
  dữ liệu trả cho Admin là danh sách câu hỏi và các lựa chọn, **không có
  `correctIndex` hoặc khóa đáp án**, học viên không có API đọc bản nháp.
- Giữ nguyên luồng Phase 5 đã publish, kết quả A/B và Phase 4.

## Hai cờ **độc lập**, mặc định tắt

1. Client build: `VITE_PHASE6_ADMIN_DRAFTS_UI=true` để hiện mô-đun trên đúng
   Preview alias; không cấu hình cờ thì không hiện gì trong giao diện.
2. Server Preview: `PHASE6_ADMIN_DRAFTS_ENABLED=true`, đồng thời
   `PHASE4_PREVIEW_HOST_OPT_IN=true` và `PHASE4_STAGING_HOSTNAME`
   phải trỏ chính xác
   `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
   Thiếu bất kỳ điều kiện nào, API luôn trả **404**.
   Khi bật cần `STAGING_AUTH_ENABLED` và Firebase staging đúng.
   Google Admin token phải được xác minh bằng chữ ký RS256, audience,
   issuer, UID bootstrap Admin và provider `google.com`.
   **Không dùng role trong client/localStorage để cấp quyền API.**
3. D1 chỉ qua `AUTH_DB_PREVIEW` của alias Preview nói trên, tuyệt đối
   không fallback sang `AUTH_DB` / `duongtrcnhiem-auth-staging`.
   Chưa có database/bảng phải trả 503, không tạo schema lúc request.

**CHƯA BẬT CỜ NÀO TRONG PR NÀY; KHÔNG CHẠY SQL/MIGRATION TỪ XA.**
Trang Production/main, Pages test Production, các nhánh Preview khác đều
không được phép dùng API Phase 6B.

## SQL bản nháp — chưa được chạy

`serverless/d1-phase6b-synthetic-admin-drafts-draft.sql` được kiểm thử
trên SQLite RAM. SQL chỉ tạo hai bảng và trigger Phase 6B mới,
không ghi/xóa/sửa bảng `phase5_content_*`, `demo_students`,
`synthetic_graded_attempts` hay `unit_accounts`.

Muốn mở vận hành thử trên Cloudflare cần **quy trình duyệt riêng**:
định danh đúng database Preview, xuất backup độc lập MỚI sau Phase 5F,
kiểm chứng khôi phục backup ở môi trường cô lập, review SQL và hàng rào
xác thực, chạy migration sau phê duyệt rồi xác minh A/B, rollback,
rate limits và mọi quyền truy cập không hợp lệ.

Không bao giờ tự chạy file SQL trên Production hoặc thay thế kết quả
của học viên. Tệp này là bản thiết kế, không phải lệnh yêu cầu người dùng
thực hiện ngay.

## Kiểm thử offline / CI

```sh
node --test tests/phase6b-admin-drafts-http.test.mjs
bun run lint
bun run build
```

Các trường hợp gồm: tạo/sửa/đọc/xóa, danh sách, không lộ đáp án, audit
không chứa thông tin riêng, 2 thao tác cập nhật bản cũ 409, token học viên/
giả mạo/sai Firebase project/sai provider từ chối, cờ OFF, host sai,
Origin khác, request sai định dạng, thiếu DB, không nhập đề thật và các
bảng Phase 4/5 vẫn nguyên trạng.

Không được coi kiểm thử SQLite RAM là bằng chứng đã kiểm tra D1 Cloudflare
thật. Mọi nội dung quân sự/nội bộ, danh tính và điểm người thật cần
được cơ quan có thẩm quyền cho phép xử lý trên dịch vụ Internet/cloud.

## Tiếp theo: 6C

Thiết kế quy trình duyệt và xuất bản một **revision bất biến** từ bản nháp
đã kiểm tra, đưa câu hỏi vào bảng public và đáp án vào bảng server-only;
kèm kiểm tra phát hành trùng, audit, rollback và quyền Admin; vẫn chỉ dữ
liệu toán giả Preview. Chưa triển khai ở PR 6B này.
