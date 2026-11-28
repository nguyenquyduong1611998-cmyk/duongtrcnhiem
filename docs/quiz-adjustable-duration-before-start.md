# Tùy chỉnh thời gian làm bài trước khi bắt đầu — trước Phase 6

## Phạm vi

Áp dụng cho luồng ôn luyện **`src/components/QuizFlow.tsx`** khi học viên mở
một chuyên đề hiện có và gặp màn hình **Họ và tên / Đơn vị công tác /
Bắt đầu làm bài**.

**KHÔNG áp dụng cho Phase 4/5 DEMO chấm điểm trên Cloudflare D1.** Bài
Phase 5 `p5_demo_math` vẫn được server chấm, lưu bất biến; không đổi
`time_limit_seconds`, không thêm lệnh SQL, không sửa kết quả A/B,
không cập nhật Firebase hay biến Cloudflare.

## Cách dùng (sau khi PR được duyệt và triển khai trên Preview)

1. Học viên chọn một chuyên đề ở **Mục Chuyên Đề Ôn Luyện**.
2. Màn hình thông tin thí sinh sẽ hiển thị thêm
   **Thời gian làm bài (phút)**, điền sẵn mức mặc định của chuyên đề.
3. Có thể đổi thành số phút nguyên **1–240**, ví dụ 10, 15, 30, 45,
   60, 90 hoặc 120 phút; không cần Admin sửa chuyên đề.
4. Nhấn **Bắt đầu làm bài**. Đồng hồ đếm ngược theo **thời gian thực đã
   trôi qua**, kể cả khi chuyển tab trong thời gian dài. Không thể đổi
   giới hạn giữa lượt làm; hết giờ tự động hoàn thành.
5. Lượt ôn luyện tiếp theo có thể chọn thời gian khác. Kết quả mới
   ghi thêm `timeLimitMinutes` theo lượt (kết quả cũ vẫn tương thích).
   Màn kết quả cho biết thời gian đã làm và giới hạn đã chọn.

## Giới hạn quan trọng

- Đây là **đồng hồ phía trình duyệt** cho chế độ ôn luyện, không phải
  giới hạn thời gian chống gian lận được máy chủ xác minh. Không dùng
  để chứng nhận thi thật; đồng hồ trên thiết bị người học có thể bị đổi.
- Tải lại trang khi đang làm bài trên luồng ôn luyện hiện có vẫn
  chưa có cơ chế server phục hồi phiên. Không hứa bảo toàn bài chưa nộp.
- Không được hiểu thay đổi này là đã bổ sung cơ chế thời gian cho
  Phase 5 D1; nếu cần thi thật có hạn giờ, phải thiết kế
  `started_at`/`expires_at` theo đồng hồ máy chủ ở Phase 6.
- PR nằm trên nhánh `feature/quiz-adjustable-time-before-start-20261125`
  và chỉ mở vào `feature/staging-demo-quiz-pilot`, **không gộp main**.

## Kiểm thử

`bun test tests/quiz-adjustable-duration.test.ts`:

- Màn bắt đầu hiện ô nhập đúng mặc định.
- Chấp nhận số nguyên 1–240 và từ chối 0, âm, >240, thập phân và dữ liệu sai.
- Quay lại từ tab nền: bộ đếm tính thời gian thực, tự chạm ngưỡng.
- Các ca TypeScript, Vite build, Phase 4/5 CI cũ vẫn được chạy khi PR được cập nhật.
