# Phase 6 — Thời gian do Admin chọn cho đề DEMO (cải thiện giao diện, không bật máy chủ)

Ngày 27/11/2026. Phạm vi: nhánh PR thử nghiệm từ `feature/staging-demo-quiz-pilot`, không đụng `main` hoặc dữ liệu Cloudflare.

## Tình trạng có sẵn trước PR

- Trong bài tập `QuizFlow` hiện tại, học viên đã có ô chọn 1–240 phút ở màn hình trước khi bắt đầu, theo yêu cầu trước đây. Đây là luồng luyện tập **lưu cục bộ trên bản Staging**, không phải đồng bộ điểm/giờ được D1 xác thực.
- Phase 6B/6C đã có cơ chế **Google Admin** tạo/sửa bản nháp toán DEMO và chọn **1–240 phút mỗi đề**. Xuất bản bất biến lưu `time_limit_seconds = minutes * 60`.
- Phase 6D lấy thời lượng bản đã xuất bản; khi học viên bắt đầu, **D1** lưu `started_at` và `expires_at` bằng đồng hồ máy chủ. Thời gian trong browser chỉ để hiển thị; backend từ chối nộp quá hạn. Không thay đổi hạn đã ấn định dù Admin sửa bản nháp sau đó.

## Thay đổi trong PR này

1. Nút đặt nhanh **15/30/45/60 phút** cho Admin; vẫn có thể nhập bất cứ số phút nguyên nào từ 1 đến 240.
2. Chỉ báo nhập thời lượng không hợp lệ; giải thích rằng cần lưu và xuất bản revision mới để giờ thi mới có hiệu lực, không kéo dài phiên đang làm.
3. Đồng hồ đếm ngược trên giao diện Phase 6D dùng `performance.now()` tính khoảng thời gian sau `serverNow`, giảm ảnh hưởng từ việc chỉnh đồng hồ hệ điều hành. Đồng hồ vẫn chỉ mang tính tham khảo, **D1 quyết định hạn nộp**.
4. Kiểm thử ranh giới 1/240 phút và đồng hồ hiển thị, kết nối vào CI.

## Không thực hiện

- Không bật `PHASE6_ADMIN_DRAFTS_ENABLED`, `PHASE6_STUDENT_TIMED_EXAM_ENABLED`, `PHASE6_ADMIN_PUBLISH_ENABLED` hoặc cờ Vite.
- Không chạy migration, không đổi cấu trúc DB hoặc binding, không đụng điểm học viên B/C/D.
- Không làm cho ba chuyên đề/lịch sử thi hiện tại tự động đồng bộ; còn cần triển khai và nghiệm thu riêng.
- Không bật Phase 6 chỉ vì GitHub Actions xanh: cần kiểm tra bảo vệ Preview, backup mới, khôi phục độc lập, quyền truy cập, danh tính D1 và phê duyệt trước mọi thay đổi thật.
- Không xử lý nội dung hoặc tài khoản người thật trên Preview hiện chưa được xác nhận có Cloudflare Access.

## Kiểm tra

```sh
bun test tests/phase6-admin-time-ui.test.ts
bun run lint
bun run build
```

Kiểm thử này chỉ chạy offline. Chưa xác nhận hành vi trên D1 Preview thật.
