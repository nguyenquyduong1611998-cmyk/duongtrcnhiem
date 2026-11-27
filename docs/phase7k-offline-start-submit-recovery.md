# Bước 116 / Phase 7K — Khôi phục an toàn khi mất mạng giữa lúc bắt đầu hoặc nộp bài DEMO

Ngày 27/11/2026. Base: `feature/staging-demo-quiz-pilot` sau PR #34.
Nền tảng giữ Cloudflare Pages + Firebase + D1; không VPS.

## Hiện trạng và vấn đề

- D1 Phase 6D đã được **thiết kế** ghi một phiên thi bất biến theo UID + topic + revision, với `started_at` và `expires_at` là giờ máy chủ. Việc đổi máy không bắt đầu lại giờ.
- Điểm chỉ tồn tại trên server khi bản nộp thành công. Phiên **chưa nộp** không đồng bộ đáp án giữa PC/iPhone.
- Trong mạng không ổn định, POST `start` hoặc `submit` có thể **đã được D1 ghi nhưng trình duyệt không nhận phản hồi**. Trước thay đổi UI không có nút `read` rõ ràng ở màn hình chưa có phiên, và sau khi POST `submit` thất bại người dùng vẫn có thể bấm nộp ngay.

## Thay đổi chỉ ở giao diện DEMO Phase 6D

1. Trước khi bắt đầu, học viên có nút **Đọc lại phiên từ D1 (sau mất mạng)**; nút chỉ gọi action `read`, không POST `start` lần nữa. Nếu D1 có phiên, đồng hồ theo `expiresAt` cũ, không gia hạn.
2. Ngay khi người dùng bấm nộp, UI đánh dấu **phiên nộp chưa xác định**; nếu POST thất bại, giữ cảnh báo và khóa nút nộp cho **đúng sessionId** tới khi học viên bấm `Đọc lại kết quả từ D1` và máy chủ trả lời thành công. Không tự động nộp lại hay tự khởi động lại phiên.
3. Nếu đọc kết quả thấy điểm đã lưu, hiển thị điểm, xóa lựa chọn chưa nộp và không cho nộp lại. Nếu D1 trả `result:null` cho đúng phiên, bỏ trạng thái chưa xác định, học viên chỉ có thể **tự xác nhận và nộp thủ công** nếu còn giờ.
4. Nếu đọc kết quả bị mất mạng, vẫn giữ trạng thái chưa xác định và không tự gửi lại.
5. Đăng nhập lại/reload không phục hồi được trạng thái cảnh báo trong bộ nhớ (cố ý không lưu token/đáp án). Backend có cơ chế phiên/lượt chấm bất biến và từ chối quá giờ ngay cả khi giao diện khác.

## Kiểm thử offline PC/iPhone

`tests/phase7k-offline-start-submit-browser.test.ts` mô phỏng hai profile có Firebase token riêng và một trạng thái server DEMO chung:

- POST `start` lưu phiên nhưng mất response; `read` trên PC/iPhone nhận cùng sessionId và cùng deadline.
- POST `submit` ghi điểm rồi mất response; điện thoại thấy kết quả và lịch sử, Admin thấy tổng hợp, tài khoản khác không thấy.
- POST thất bại trước khi ghi: đọc `result:null`, phiên còn nguyên giờ cũ, nộp sau deadline bị từ chối.
- Mất mạng ngay lúc đọc kết quả: giao diện không gửi POST `submit` tự động lần hai.
- Kiểm tra no-store, không lộ token/đáp án, và các affordance trong mã giao diện.

## Ranh giới bảo mật và vận hành

- Chỉ sửa client code, tests và tài liệu. **Không sửa API backend, SQL, migration, Cloudflare/D1/Firebase binding hay feature flags.**
- Không chạy với tài khoản người thật, không ảnh hưởng kết quả B/C/D, `main` hay Production.
- Phase 6A/B/C/D/6E còn **mặc định OFF** trên Preview và chưa được nghiệm thu D1 thật. Preview chưa xác nhận Cloudflare Access bảo vệ nên chỉ dùng DEMO toán giả.
- Test dùng mô phỏng không phải bằng chứng kiểm thử thiết bị thật hoặc D1 Cloudflare live.
- Quy trình nghiệm thu thực tế vẫn cần bảo vệ Preview, backup/khôi phục D1 riêng, review migrations, anti-abuse, giám sát quota và phê duyệt.

## Lệnh CI

```sh
bun test tests/phase7k-offline-start-submit-browser.test.ts
bun run lint
bun run build
```
