# Giai đoạn 6E — Lịch sử thi và bảng điểm DEMO đọc từ D1 (mặc định OFF)

Ngày 25/11/2026. Nhánh phát triển riêng: `feature/phase6e-readonly-results-20261125`.
Nền tảng giữ nguyên: **Cloudflare Pages + Cloudflare Functions + D1 + Firebase + PWA. KHÔNG dùng VPS.**

## Mục tiêu và giới hạn

6D đã có phiên thi toán học giả `p6_demo_*`, đồng hồ D1, bảng
`phase6_exam_submissions` và một lần nộp/UID/topic/revision.
6E **chỉ đọc** kết quả đã nộp, phục vụ hai vai trò:

- Học viên DEMO: xem lịch sử điểm **chính tài khoản UID đã được xác thực**
  trong tab `Lịch sử`. API không nhận UID, username hoặc khóa kết quả của
  tài khoản khác từ browser.
- Google Admin staging được xác minh bằng Firebase RS256: tab `Quản trị`
  xem danh sách các lượt nộp theo tài khoản DEMO `test_hv_*`, chuyên đề,
  phiên bản, số câu đúng, điểm/10, thời gian. Tổng hợp **số lượt nộp**,
  **số học viên đã nộp duy nhất** và **điểm trung bình các lượt nộp**.
  Đây không phải điểm trung bình từng học viên hoặc tiêu chí đạt/trượt.

Học viên và Admin có API riêng và cờ bật riêng. Lịch sử phân trang
**25 bản ghi/trang**, offset 0,25,... đến 10000 (chỉ dữ liệu DEMO).
Mỗi lượt tải gọi D1 trực tiếp sau khi cấp Firebase ID token mới;
không ghi localStorage điểm, không có chức năng sửa/thu hồi/export.
Phân trang dựa trên offset; nếu nhiều người nộp đồng thời có thể làm
thứ tự trang biến động; cân nhắc keyset pagination trong 6F nếu cần.

**Không sử dụng dữ liệu quân sự, nội bộ hoặc điểm thật** khi chưa được
phê duyệt về bảo mật và nơi lưu trữ.

## API hợp đồng

`POST /api/phase6/results/student`

```json
{"action":"list","offset":0}
```

`POST /api/phase6/results/admin`

```json
{"action":"summary"}
```

hoặc:

```json
{"action":"list","offset":0}
```

Cả hai API chỉ trả các trường được chọn trước, không truy vấn bảng
`phase5_content_answer_keys`, không trả `answers_json`, session ID,
Firebase UID, JWT, username trong phản hồi học viên, mật khẩu, dữ liệu
định danh khác hoặc khóa đáp án.

Admin board chỉ trả **mã tài khoản DEMO** đã validate `test_hv_...`,
không dùng tên người thật. Mọi rows phải thuộc một
`phase6_admin_publications` đã được kiểm chứng `published`; không
kéo điểm Phase 4/Phase 5 cũ vào thống kê Phase 6.

## Gating và quyền

- Server `PHASE6_RESULTS_READONLY_ENABLED=true` bật cả API student
  (cờ **mặc định OFF**); Admin **đồng thời** cần
  `PHASE6_ADMIN_RESULTS_ENABLED=true` (cờ **mặc định OFF**).
- Luôn cần `PHASE4_PREVIEW_HOST_OPT_IN=true` và
  `PHASE4_STAGING_HOSTNAME=feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
  Chỉ đúng hostname pin trong Request URL, kiểm tra origin, HTTPS, POST JSON
  với body nhỏ, không có query params.
- Firebase staging ID token được xác minh chữ ký máy chủ. Student phải
  có `sign_in_provider=custom`, UID `student_<32hex>`,
  **active** trong `demo_students` của Preview D1;
  Admin phải có Google provider, đúng bootstrap UID.
  Không dựa trên localStorage role.
- Chỉ `AUTH_DB_PREVIEW`; không fallback vào `AUTH_DB` của staging khác,
  không có D1 Production.
- Giao diện có cờ riêng:
  `VITE_PHASE6_STUDENT_HISTORY_UI=true` (tab Lịch sử học viên)
  và `VITE_PHASE6_ADMIN_RESULTS_UI=true` (tab Quản trị).
  Cả hai OFF nếu biến môi trường không thiết lập.
- Cờ xem điểm **không phụ thuộc cờ 6D nộp bài**: có thể tắt bài thi mới
  nhưng vẫn cho học viên tra cứu kết quả đã lưu, khi được vận hành phê duyệt.

## Không chạy migration hoặc bật Cloudflare thật

6E **không thêm bảng D1**: chỉ SELECT trên các bảng Phase 6A/6C/6D và
`demo_students` đã được thiết kế. Các migration 6A/6B/6C/6D vẫn
**chưa được chạy trên Cloudflare Preview D1**, và 6E không đụng
bất kỳ binding hay cấu hình Cloudflare/Firebase thực tế nào.

Trước nghiệm thu Preview:
1. Review an toàn và phân loại dữ liệu, chỉ toán giả.
2. Sao lưu D1 Preview hiện tại; khôi phục thử trên bản sao tách biệt,
   xác minh target DB `duongtrcnhiem-auth-preview`/`AUTH_DB_PREVIEW`.
3. Review tuần tự migration 6A/6B/6C/6D, test sự tương thích với kết quả
   A/B Phase4/5, rồi mới cân nhắc bật riêng từng cờ.
4. Test đồng thời 30–100 người, network disconnection, token refresh,
   quyền Admin, row counts, quotas, rate limiting, caching, timezone.
5. Không bật trên `main`, không đưa dữ liệu thật lên Internet nếu chưa
   có phê duyệt.

## Kiểm thử mã nguồn

```sh
node --test tests/phase6e-results-readonly-http.test.mjs
bun run lint
bun run build
```

Bộ kiểm thử tạo RSA token giả tại chỗ và D1 mô phỏng bằng SQLite RAM,
test học viên A/B, Admin và giả mạo, phân trang trên 28 lượt nộp, tổng hợp
lượt thi/2 học viên/điểm TB, cấm UID/answer key/answers, cấm SQL write,
schema thiếu, cờ OFF, host sai, khóa tài khoản và không thay đổi điểm
Phase4/5 cũ. Kiểm thử RAM không chứng minh D1 Cloudflare thật đã chạy.

**Bước sau: 6F — kiểm định phục hồi dữ liệu, bảo mật, quy trình PWA,
hiệu năng và độ sẵn sàng trước khi cân nhắc vận hành.**
