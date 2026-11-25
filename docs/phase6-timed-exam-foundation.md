# Giai đoạn 6A — nền tảng thời hạn phiên thi do máy chủ quản lý

Ngày: 25/11/2026. Dành riêng cho website Tiểu đoàn 3 trên nhánh
`feature/staging-demo-quiz-pilot`, dữ liệu *toán học giả* và SQLite RAM.

## Phạm vi vừa xây dựng

1. `functions/_shared/phase6-timed-exam.mjs` — các quy tắc **server only**:
   - Đọc cấu hình từ phiên bản chuyên đề **published** đã xác thực từ DB;
     giới hạn 1–240 phút (bước 1 phút), 1–500 câu; điểm tối đa hiện cố định 10.
   - Khởi tạo `startedAt` và `expiresAt` từ đồng hồ **máy chủ**;
     khóa thời hạn sau khi bắt đầu và buộc UID đã xác thực khớp với phiên.
   - Từ chối nộp bài sau thời hạn, trước thời điểm bắt đầu, hoặc khác UID.
   - Chấm trên server bằng khóa riêng, không tin điểm/đáp án đúng do client gửi;
     chỉ xuất số câu đúng, tổng câu và điểm, không xuất khóa.
2. `serverless/d1-phase6-timed-sessions-draft.sql` — **bản nháp chưa chạy**:
   bảng `phase6_exam_sessions` riêng có UNIQUE `(student_uid,topic_id,revision)`,
   liên kết phiên bản chuyên đề đã xuất bản, thời hạn bất biến và trigger
   kiểm tra thời gian bắt đầu gần đồng hồ SQLite/D1.
3. `tests/phase6-timed-exam.test.mjs` — kiểm thử offline với đề toán giả:
   thời lượng, danh tính, ranh giới hết giờ, kết quả 0/5/10, thao túng điểm,
   phiên bản chưa publish, phiên trùng, đổi hạn và bảo toàn dữ liệu Phase 5.
4. CI chạy bài test Phase 6A cùng các hồi quy Phase 4/5 và bản build hiện có.

**Không có API `/api/phase6` được tạo, không có thao tác D1 từ xa, không thêm
Cloudflare env/binding, không seed dữ liệu, không thay đổi Firebase hay main.**
Chức năng thực tế cho học viên thi có thời hạn **chưa được bật**.

## Phân biệt với PR16

PR16 cho phép học viên chọn 1–240 phút khi làm **bài ôn luyện cục bộ**;
đồng hồ frontend không phải bằng chứng chống gian lận. Phase 6A chỉ chuẩn bị
thời hạn **do server sở hữu**, lấy từ cấu hình revision đã publish. Học viên
không được tự kéo dài hạn khi gửi bài, kể cả khi đổi tab, đồng hồ máy hoặc POST.

Không dùng `QuizFlow` chứa `correctIndex` trong bundle để chứng nhận thi thật.
Không dùng dữ liệu `localStorage` làm căn cứ phân quyền, điểm hoặc thời gian.

## Những bước cần có trước khi bật kiểm tra có điểm

- **6B — Admin quản lý dự thảo:** Firebase Google Admin token đã kiểm tra ở
  server, API tạo/sửa chuyên đề nháp và 4 lựa chọn/câu hỏi, khóa đáp án riêng;
  chỉ synthetic Preview. Audit và chống thay đổi bản published.
- **6C — Xuất bản an toàn:** xác minh đầy đủ nội dung, phiên bản bất biến,
  cấu hình số câu/thời gian/thang điểm do máy chủ giữ; xuất câu hỏi không kèm key.
- **6D — Phiên thi/điểm D1:** endpoint bắt đầu phiên, kiểm tra thời hạn ngay
  trong giao dịch ghi kết quả một lần, chống race/submit trùng/lost response;
  HTTP API fail-closed, default-OFF, chỉ hostname Preview đã pin.
- **6E — Học viên và bảng điểm:** đọc lại kết quả của chính UID, Admin đọc
  danh sách theo chuyên đề/học viên; bảo đảm không rò rỉ khóa, UID hoặc dữ liệu riêng.
- **6F — Duyệt vận hành:** sao lưu và khôi phục thử D1 Preview MỚI (vì đã có
  bài nộp Phase 5 sau backup cũ), kiểm thử âm tính A/B/Admin/anonymous/locked,
  kiểm tra 30–100 người dùng, kế hoạch khôi phục và phê duyệt nội dung hợp lệ.

**Không chạy file SQL Phase 6A trên Cloudflare Console.** Trước mọi migration
thật cần duyệt nhánh, xem diff, backup độc lập, thử khôi phục, và kiểm tra đúng
database `duongtrcnhiem-auth-preview` qua `AUTH_DB_PREVIEW`. Không dùng
`AUTH_DB` hay `duongtrcnhiem-auth-staging` cho thử nghiệm này. Không đưa
nội dung quân sự nhạy cảm, thông tin quân nhân hoặc đề thi thật lên cloud
khi chưa có phê duyệt của người có thẩm quyền.

## Kiểm thử

```sh
node --test tests/phase6-timed-exam.test.mjs
bun run lint
bun run build
```

Bài test SQL chạy trên SQLite bộ nhớ; **không xác nhận** migration hoạt động
trên D1 thật. Kiểm thử chức năng HTTP, giao diện và tải phải được làm ở các PR
sau và chỉ được coi là đạt khi có CI cùng xác nhận Preview riêng.
