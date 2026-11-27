# Phase 7J — Lịch sử điểm DEMO đọc D1 khi mở màn hình; chống dữ liệu cũ khi đổi thiết bị

Ngày 27/11/2026. Base `feature/staging-demo-quiz-pilot` sau PR #33.

## Trước PR

- API Phase 6E đã thiết kế lưu **điểm sau khi nộp** tập trung ở D1 và trả lịch sử theo Firebase UID đã ký. Nhưng trang lịch sử Phase 6 chưa tự tải khi mở: học viên phải bấm `Tải kết quả từ D1`.
- Các phép đọc HTTP có thể trả về muộn sau khi UI chuyển tài khoản/vai trò; UI đang chặn phần lớn bằng remount `key={firebaseUser.uid}`, nhưng chưa có hàng rào chống phản hồi cũ trong component.
- Học viên làm dở chưa nộp **không** có bản nháp trên D1 và **không** đồng bộ đáp án giữa PC và điện thoại. Không được gọi đây là đồng bộ đề đang làm.

## Thay đổi (chỉ frontend Preview 6E)

1. Khi mở component lịch sử học viên/Google Admin (đang đặt dưới các Vite flag mặc định OFF), gọi read-only Phase 6E một lần lấy trang đầu tiên từ D1; không polling, không auto retry.
2. Nút `Tải lại` tiếp tục đọc mới thủ công nếu vừa nộp điểm ở thiết bị khác. Phân trang vẫn 25 lượt/trang.
3. Mỗi lần đọc được gắn role/UID + thế hệ request; response muộn bị loại khi account/role/thứ tự request đã đổi hoặc component unmount.
4. Trước lần đọc mới và khi kết nối thất bại, ẩn bảng điểm cũ; không giới thiệu dữ liệu cũ là dữ liệu đã đồng bộ thành công.
5. Không đưa điểm, đáp án hay Firebase ID token vào localStorage, IndexedDB hoặc service worker. Backend vẫn tự xác thực quyền theo UID, không tin role do frontend truyền.

## Không thực hiện

- Không đổi endpoints, SQL, schema, Firebase, Cloudflare, flags, AUTH_DB_PREVIEW hoặc Production.
- Không tự tạo/trả điểm thật, không tự động nộp bài, không đồng bộ đáp án chưa nộp.
- Không nhập nội dung/names thực tế lên Preview chưa có Access được xác minh.
- Không đảm bảo consistency của phân trang offset nếu đồng thời nhiều lượt nộp; nội dung DEMO giả và giới hạn cũ vẫn giữ.
- CI là kiểm thử offline; **không phải** nghiệm thu Cloudflare D1 thật.

## Kiểm thử

```sh
bun test tests/phase7j-history-on-open.test.ts
bun run lint
bun run build
```
