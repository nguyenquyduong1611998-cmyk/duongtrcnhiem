# Giai đoạn 7A — kiểm tra D1 Preview trước nghiệm thu (CHỈ ĐỌC, KHÔNG VPS)

Ngày 25/11/2026. Sau PR23 đã gộp vào `feature/staging-demo-quiz-pilot`.
PR này chỉ mở nhánh phát triển và chuẩn bị công cụ; không chạy câu SQL nào
trên D1 Cloudflare thật, không thay đổi Cloudflare/Firebase, không xử lý
dữ liệu học viên hoặc đề thi thật, không động tới `main`.

**Kiến trúc giữ nguyên:** Cloudflare Pages + Pages Functions + Cloudflare
D1 + Firebase Authentication + PWA. **KHÔNG dùng VPS.**

## 1. Kết quả đã kiểm chứng và những gì chưa làm

Đã có Phase 6A–6F mã nguồn và kiểm thử offline bằng SQLite RAM,
100 UID toán DEMO cùng các rào bảo vệ PWA. CI xanh không chứng minh
Cloudflare D1 Preview thật đã có Phase6 schema/migration, đã sao lưu
khôi phục thật hoặc chịu được 100 người đồng thời trên mạng.

Giai đoạn này thêm **API Google Admin chỉ đọc**:

`POST /api/phase7/preflight`

Body duy nhất:

```json
{"action":"inspect"}
```

API KHÔNG nhận tên bảng, SQL, đường dẫn file, UID, mật khẩu hoặc
token trong body. Máy chủ chỉ đọc `sqlite_master` và
`PRAGMA table_info` qua các lệnh có tên đối tượng **cố định trong
mã nguồn**. Không `SELECT` từ bảng học viên, bảng điểm hay khóa đáp
án. Không `INSERT/UPDATE/DELETE/CREATE/DROP`; không trigger
migration, backup hay restore.

Phản hồi chỉ có trạng thái nhóm:
- `baseline`: DEMO auth Phase4 và mô hình Phase5;
- `phase6b`: nháp Admin;
- `phase6c`: metadata xuất bản;
- `phase6a`: phiên thi có thời hạn;
- `phase6d`: lượt nộp và kết quả bất biến.

Mỗi nhóm trả trạng thái `ABSENT`, `SCHEMA_CANDIDATE`,
`BLOCKED_INCOMPLETE_OR_MISMATCHED`. Kiểm tra tên/cột, kiểu bảng,
một số khóa/constraint, index và trigger quan trọng. Không xác minh
mọi đặc tính bảo mật hoặc SQL của bản migration; kết quả
`SCHEMA_CANDIDATE` **không có nghĩa chứng nhận đủ điều kiện**.
Ngay cả khi mọi nhóm là `SCHEMA_CANDIDATE`, API vẫn trả:
`deployAuthorized:false`, `freshBackupVerified:false`,
`targetDatabaseIdentityVerified:false`, `migrationsExecuted:false`.

## 2. Rào bảo vệ

API mặc định **OFF**. Muốn cho Google Admin thử *chỉ đọc* về sau
phải có thẩm quyền và xét duyệt riêng:

- Server `PHASE7_PREVIEW_SCHEMA_PREFLIGHT_ENABLED=true`;
- `STAGING_AUTH_ENABLED=true` và Firebase **duongtrcnhiem-staging**;
- `PHASE4_PREVIEW_HOST_OPT_IN=true` và
  `PHASE4_STAGING_HOSTNAME=feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`;
- HTTP URL `https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`
  khớp tuyệt đối, đúng Origin/POST JSON;
- `AUTH_DB_PREVIEW` trỏ D1 Preview riêng — **không fallback** sang
  `AUTH_DB` hoặc D1 Production;
- Firebase ID token signed RS256 của **Google Admin staging** xác thực
  trên máy chủ. Anonymous, học viên DEMO, UID không phải Admin
  hoặc token sai đều không được đọc schema;
- UI mới ở mục Quản trị chỉ xuất hiện với
  `VITE_PHASE7_PREVIEW_PREFLIGHT_UI=true` trên đúng Preview.
  Cờ UI chỉ kiểm soát hiển thị; cờ server và JWT là lớp bảo vệ thực.

**Đừng bật bất kỳ cờ nào chỉ để xem Preview khi chưa kiểm tra
Cloudflare Access, quyền truy cập công khai và binding D1.**

## 3. Các bước người quản trị sẽ phải tự xác minh trước khi cho thử trên Preview

1. Tại Cloudflare Dashboard → Workers & Pages →
   `duongtrcnhiem-test` → Deployments, kiểm tra deployment thực
   của nhánh `feature/staging-demo-quiz-pilot` và hostname pin.
   Đối chiếu commit SHA đã triển khai với nhánh, đảm bảo build
   `VITE_FIREBASE_ENV=staging`.
2. Kiểm tra D1 `duongtrcnhiem-auth-preview`: xác nhận đúng
   **database ID** gắn `AUTH_DB_PREVIEW` ở Preview env; không trỏ
   `duongtrcnhiem-auth-staging` hoặc Production. Kiểm tra mọi
   Preview cùng môi trường chung để tránh dùng nhầm binding.
3. Xác nhận quyền Cloudflare Access và hostname Preview bị giới hạn
   trước khi bật API kiểm tra. Không đăng ảnh có token, secret,
   tài khoản, dữ liệu backup hoặc D1 ID nhạy cảm.
4. **Chỉ sau khi được phép:** bật riêng cờ server preflight, tùy
   chọn cờ UI, đăng nhập Google Admin staging trên Preview và bấm
   “Kiểm tra cấu trúc D1 Preview”. Công cụ chỉ báo trạng thái,
   KHÔNG bao giờ tự chạy migration.
5. Nếu báo `BLOCKED_*` → **dừng**, đọc báo cáo trong phạm vi
   được ủy quyền, không tự chạy lệnh SQL để “sửa cho xanh”.
   Nếu báo `MIGRATION_REVIEW_REQUIRED` → chưa đủ migration hoặc
   chưa có theo thứ tự; vẫn phải chờ backup và review.
   Nếu `SCHEMA_CANDIDATE_REVIEW_ONLY` → chỉ là cờ nghiên cứu
   cấu trúc, **chưa** xác minh D1 identity, fresh backup, restore.
6. Để tiến tới triển khai DEMO có phê duyệt: sao lưu D1 Preview
   **mới nhất** sau bài nộp Phase5, khôi phục thử sang D1 phụ
   tách biệt, đối chiếu integrity/FK/row-count, xem xét SQL thứ tự
   6B → 6C → 6A → 6D, kiểm tra staging login A/B/Admin và
   khả năng tắt cờ/rollback logic.
7. Chỉ khi nghiệm thu an toàn mới tính đến các bước bật thử từng
   API Phase6 và thử tải mạng thật 30–100 người. Khi chưa có bằng
   chứng, **NO-GO** cho sử dụng nội dung hoặc điểm thật.

## 4. Kiểm thử offline có trong PR

```sh
node --test tests/phase7a-preview-d1-schema-http.test.mjs
bun test tests/phase7a-preview-browser.test.ts
bun run lint
bun run build
```

Bộ kiểm thử tạo SQLite RAM với base + draft 6B/6C/6A/6D;
kiểm tra đủ, thiếu, một phần, sai thứ tự, trùng tên đối tượng,
read-only và chặn SQL tùy ý. Tự tạo RSA JWT giả chỉ trong test;
kiểm tra Admin thật qua chữ ký test, student/anonymous bị chặn,
hostname sai, feature OFF, missing Preview binding không fallback,
lỗi DB trả 503, response không lộ dữ liệu. CI không yêu cầu D1 thật.

**Không có migration hoặc backup nào đã được thực hiện trên Cloudflare
do PR7A này.** Sau khi gộp vào Staging nếu CI đạt, muốn bắt đầu
nghiệm thu trực tiếp cần một yêu cầu và phê duyệt thao tác riêng.
