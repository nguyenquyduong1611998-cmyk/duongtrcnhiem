# Giai đoạn 6D — Học viên DEMO thi có thời hạn và chấm trên D1 (mặc định OFF)

Ngày 25/11/2026. Repo: `duongtrcnhiem`, base `feature/staging-demo-quiz-pilot`
sau PR20 đã gộp. Kiến trúc: **Cloudflare Pages + Pages Functions +
Cloudflare D1 + Firebase, KHÔNG VPS**.

## Phạm vi của PR 6D

- **Một API sinh viên riêng:** `POST /api/phase6/exam`, các action
  `list/start/read/submit/result`. Chỉ nhận Firebase DEMO UID xác thực
  bằng chữ ký RS256 (provider `custom`) và học viên đang active trong
  bảng `demo_students` của **D1 Preview riêng**.
- **Nội dung toán học giả:** chỉ những revision `p6_demo_<32 hex>` đã
  xuất bản bởi 6C (bảng `phase6_admin_publications`), tối đa 12 câu.
  Học viên nhận câu hỏi và 4 lựa chọn **không có correctIndex**.
- **Bắt đầu và khôi phục:** phiên thi được tạo tại DB với
  `started_at=unixepoch()`, `expires_at=unixepoch()+time_limit_seconds`
  trong cùng lệnh INSERT. Một phiên/UID/topic/revision, UNIQUE D1.
  Truy cập lại/dùng thiết bị thứ hai chỉ nhận chính phiên đã tạo,
  không được kéo dài giờ thi.
- **Nộp một lần:** đáp án (mỗi câu 0–3) được so với khóa riêng
  `phase5_content_answer_keys` **bên máy chủ** rồi ghi vào bảng
  `phase6_exam_submissions`. SQL `INSERT ... SELECT` kiểm tra cùng
  UID, phiên, active enrollment, published revision và
  `unixepoch() BETWEEN started_at AND expires_at` trong chính câu ghi.
  Trigger D1 bổ sung điều kiện UID/timestamp/deadline và khóa cập nhật/xóa.
  Hết giờ **1 giây** là từ chối, đúng giây hết hạn được chấp nhận.
- **Mất phản hồi/multi-device:** kết quả duy nhất không bị ghi đè;
  nộp lại cùng đáp án đọc receipt cũ, khác đáp án trả 409.
  Student result chỉ đọc của UID đã xác thực, không lộ answer key.
  Giao diện có nút **Đọc lại kết quả từ D1**; khi mạng lỗi, không tự động
  gửi POST lần hai (tránh nộp nhầm).
- **Tách biệt Phase5:** bảng Phase 6 mới lưu điểm, không ghi vào
  `phase5_content_attempts` của học viên DEMO A/B. Không tự động
  đưa kết quả Phase 6 lên bảng điểm Admin Phase5; đó là công việc 6E.
- **Frontend timer chỉ là tham khảo** dựa trên `serverNow` từ D1 và
  thời gian trôi trên thiết bị. Đồng hồ, tab, reload hay set clock trình
  duyệt **không quyết định** hạn nộp ở D1.
- **Không hỗ trợ điểm chính thức**, không cho nhập tài liệu quân sự/
  nội bộ/người thật, không có VPS hoặc backend thường trực.

## Cờ mặc định OFF và hệ thống bảo vệ

- Backend: `PHASE6_STUDENT_TIMED_EXAM_ENABLED=true` **chỉ** sau duyệt
  vận hành. Bắt buộc `PHASE4_PREVIEW_HOST_OPT_IN=true`,
  `PHASE4_STAGING_HOSTNAME=feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`,
  `STAGING_AUTH_ENABLED=true`, cấu hình Firebase staging đúng và
  `AUTH_DB_PREVIEW`. Mất binding Preview: HTTP 503, **không fallback**
  vào `AUTH_DB`/Production D1.
- Build UI: `VITE_PHASE6_STUDENT_TIMED_UI=true` mới hiển thị
  `Phase6StudentExamPanel` cho DEMO student `currentUser.id===firebaseUser.uid`
  trên đúng Preview host. Không đặt cờ: không thay đổi luồng chuyên đề cũ.
- API luôn giới hạn hostname chính xác, HTTPS, Origin cùng nguồn,
  POST JSON, body nhỏ, không có query. Token admin/guest giả, sai
  Firebase project/provider, học viên đã khóa đều bị từ chối.
- Student API **không** phụ thuộc cờ bật 6C của Admin để đọc revision đã
  xuất bản; quyền *xuất bản mới* và quyền *thi* được bật/tắt độc lập.
  Không thể tạo revision mới qua API học viên.

## SQL là bản nháp offline — CHƯA CHẠY TRÊN CLOUDFLARE

`serverless/d1-phase6d-timed-submissions-draft.sql` thêm bảng
`phase6_exam_submissions`, index và trigger bảo vệ. Phụ thuộc vào:
1. Phase 5 additive schema (đã tồn tại trên Preview sau thẩm định);
2. 6B draft schema, 6C publication schema (hiện **chưa áp dụng**);
3. 6A session schema (hiện **chưa áp dụng**).

Không có migration nào chạy trên D1 thật trong PR này. Không được
paste/chạy tệp SQL này vào Cloudflare Console / D1 Production.

Trước khi bật thử thật trên Preview, cần *phê duyệt riêng*: xuất **backup
D1 Preview mới** sau bài làm Phase5, kiểm tra khả năng khôi phục bản sao
cô lập, review thứ tự migration, test D1 thực tế và xác minh Phase5 A/B
không đổi. Cần rate-limiting, chặn abuse, giám sát quota và kế hoạch
sự cố trước khi cấp quyền cho nhiều người dùng. Bất kỳ xử lý dữ liệu
người thật hoặc nội dung đơn vị cũng cần phê duyệt về bảo mật/Internet.

## Kiểm thử CI offline

```sh
node --test tests/phase6d-student-timed-exam-http.test.mjs
bun run lint
bun run build
```

Bài kiểm thử trên SQLite RAM và JWT RSA tự sinh: học viên A/B, xem đề,
đọc lại phiên cũ, hạn thời gian đúng giây/+1 giây, không có UID/timestamp/
điểm do trình duyệt quyết định, nộp trùng/mất phản hồi, khác tài khoản,
khóa học viên, giả JWT/Admin, Origin/host sai, cờ OFF, thiếu bảng D1,
trigger bất biến và bảo toàn toàn bộ điểm A=10, B=0 ở Phase 5.

SQLite RAM **không** thay thế nghiệm thu Cloudflare D1 thật hoặc tải
30–100 user. Cần Giai đoạn 6E (lịch sử điểm/ban Admin), 6F (backup,
kiểm thử tải, phân quyền, bảo mật, sẵn sàng PWA) trước vận hành.

**Dự án đi theo hướng không dùng VPS.**
