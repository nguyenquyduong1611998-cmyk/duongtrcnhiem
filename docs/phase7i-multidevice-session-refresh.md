# Phase 7I — Làm mới phiên thi mà không xóa đáp án đang chọn (offline, Preview)

Ngày 27/11/2026. Bước 112, nhánh thử nghiệm sau PR #32. Không VPS, không bật Cloudflare Access hoặc cờ Phase 6.

## Phát hiện

Trong giao diện Phase 6D trước thay đổi, mọi lời gọi `setExam` (bao gồm nút **Đồng bộ phiên thi**) đều đặt `answers={}`. Khi học viên đã chọn câu trả lời nhưng chưa nộp, tải lại **cùng phiên** từ máy chủ sẽ làm mất mọi lựa chọn trên thiết bị đó.

**Giới hạn quan trọng:** Server D1 chỉ lưu phiên thi có giờ bắt đầu/hết hạn và **đáp án sau khi nộp**. Đáp án đang chọn *chưa được lưu trên D1*, không đồng bộ qua PC/iPhone, không phục hồi sau đóng tab hoặc reload. Không được diễn giải việc đọc cùng `sessionId` là đồng bộ bản nháp đáp án.

## Thay đổi

- Khi nút **Đồng bộ phiên thi** hoặc **Mở đề** tải lại đúng cùng `sessionId`, UID (do API xác thực), topic, revision, mốc giờ và nội dung câu hỏi, UI giữ các đáp án đang chọn **trong RAM trên thiết bị hiện tại**. Vẫn yêu cầu tích xác nhận nộp lại.
- Nếu phiên/topic/hạn giờ/câu hỏi thay đổi, đã hết hạn theo `serverNow` hoặc đã có kết quả nộp, UI xóa toàn bộ đáp án đang chọn; không tái sử dụng vào bài khác.
- Khi nút **Đọc lại kết quả từ D1** tìm thấy điểm do thiết bị khác nộp, UI xóa đáp án chưa nộp còn trong RAM và chỉ hiển thị điểm máy chủ.
- Thông báo rõ đáp án chưa nộp không đồng bộ giữa thiết bị và việc refresh không đặt lại giờ trên D1; phần **Lịch sử Phase 6E** chỉ có điểm đã nộp, tách biệt lịch sử bài luyện tập cục bộ/điểm Phase 4.
- Tests dùng dữ liệu giả thuần in-memory, không gọi Firebase/Cloudflare và không làm thay đổi SQL hay API.

## Chưa thực hiện

- Không tự động lưu draft answers trên server, không localStorage/IndexedDB/service-worker caching, không đồng bộ đáp án khi đổi máy.
- Không bật Phase 6D/6E hoặc tạo bảng D1 Preview, không sửa điểm B/C/D hay Production.
- Không kết luận sẵn sàng dùng đề/điểm người thật; Cloudflare Access của Preview vẫn chưa được xác minh.
- CI offline không thay thế thử nghiệm UI trên thiết bị thật khi được phê duyệt.

## Kiểm thử

```sh
bun test tests/phase7i-session-refresh.test.ts
bun run lint
bun run build
```
