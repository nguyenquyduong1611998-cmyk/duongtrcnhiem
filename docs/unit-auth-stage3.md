# Giai đoạn 3 — Đăng nhập học viên thật (kế hoạch triển khai an toàn)

> Tài liệu chuẩn bị cho nhánh `feature/unit-auth-stage3`. CHƯA mở đăng nhập học viên thật; chưa đổi D1, Firebase hoặc cấu hình Cloudflare.

## Hiện trạng được xác minh từ mã nguồn

- Môi trường thử nghiệm: `fix-firebase-login`; Cloudflare Pages staging sử dụng D1 và Firebase project `duongtrcnhiem-staging`.
- `test_hv_*` đăng nhập qua `functions/api/auth/student/login.js`, đọc `demo_students` và phát Firebase Custom Token. Luồng A/B bằng hai trình duyệt đã được kiểm thử bởi người vận hành.
- `test_unit_*` được lưu trong `unit_accounts`, hỗ trợ tạo/khóa/mở/đặt lại mật khẩu và xác minh/đổi mật khẩu thử; **cố ý không phát token hoặc phiên đăng nhập**.
- `functions/_shared/auth.mjs` chứa thuật toán băm `cf-chain-v1` phục vụ **DEMO/staging**; mã nguồn cảnh báo không sử dụng cho người thật khi chưa được đánh giá độc lập.
- `src/App.tsx` còn đường đăng nhập cục bộ cho tài khoản không thuộc `test_hv_*` và `test_unit_*`; cần chặn mọi đường đi vòng qua backend khi triển khai đăng nhập thật.
- `firestore.rules` trong repository hiện có nhiều quyền ghi dành riêng cho `google.com`, không tự động tương thích với Firebase Custom Token học viên. Xác minh và triển khai rules **staging** riêng trước khi bật truy cập dữ liệu học viên thật. Không ghi đè rules production chỉ để kiểm thử.

## Mốc sao lưu đã xác minh — 22/11/2026 (staging)

- Đã nhận được bookmark của D1 staging. **Không chạy lệnh restore** trừ khi có sự cố và đã phê duyệt khôi phục.
- Người vận hành xuất `duongtrcnhiem-auth-staging` bằng Wrangler thành tệp SQL lưu **trên máy tính cá nhân**, không tải lên GitHub.
- Tệp SQL được nạp vào SQLite trong bộ nhớ thành công; số bản ghi so sánh bằng `COUNT(*)` khớp với Cloudflare D1 ngay tại thời điểm kiểm tra: `unit_accounts=1`, `demo_students=4`, `login_attempts=3`.
- Phép đếm này **chưa phải** kiểm toán từng hàng hoặc diễn tập khôi phục toàn bộ Cloudflare D1. Cần giữ bản sao lưu an toàn, sao chép thêm vào kho lưu trữ mã hóa, xác minh được khôi phục trong một cơ sở dữ liệu thử nghiệm trước khi migration dữ liệu thật.

## Phạm vi tối thiểu

1. Admin được máy chủ xác thực có quyền tạo học viên, cấp mật khẩu tạm một lần, khóa/mở và reset mật khẩu; mọi thao tác được ghi audit không chứa mật khẩu.
2. Học viên phải đổi mật khẩu tạm trước khi được cấp Firebase Custom Token; đăng nhập sau đó thông qua backend, không qua mật khẩu trong localStorage.
3. D1 lưu trạng thái và mã băm bằng phương án KDF **được chuẩn hóa, được thẩm định cho tài khoản thật**; không dùng `cf-chain-v1` DEMO cho tài khoản thật.
4. Firebase UID ổn định, không trùng hoặc dùng lại UID DEMO; hoàn thiện cấp danh tính và khôi phục khi lỗi giữa D1/Firebase.
5. Firestore Security Rules kiểm tra danh tính và quyền theo UID; học viên đọc được nội dung được phép và chỉ ghi/đọc kết quả thuộc mình. Admin vẫn yêu cầu Google Admin được xác nhận trên máy chủ.
6. Khi Admin khóa/reset tài khoản, các phiên cũ cũng bị chặn theo chính sách thu hồi token và/hoặc kiểm tra trạng thái; không chỉ đổi cờ `active` trong D1. Xem xét cả thời gian sống của ID token.
7. Đăng nhập cùng tài khoản trên hai trình duyệt, đọc lại kết quả, và kiểm thử học viên B không đọc/xóa kết quả của A.

## Hàng rào an toàn khi làm

- Chỉ code trên nhánh riêng; không merge hay triển khai staging mặc định khi chưa có kiểm thử và phê duyệt.
- Sao lưu D1 trước khi chạy migration hoặc sửa dữ liệu; xác minh có phương án khôi phục.
- Dùng cờ riêng (mặc định tắt) để bật pilot tài khoản thật trên **staging**; không dùng `STAGING_AUTH_ENABLED` hiện tại để ngầm mở toàn bộ hệ thống.
- Không thay đổi dữ liệu, mật khẩu hoặc UID của `test_hv_*`, `test_unit_*`, Google Admin, tài khoản đang vận hành và môi trường Firebase production.
- Không in mật khẩu, khóa riêng tư, custom token hoặc mã băm vào log / phản hồi công khai / ảnh chụp màn hình.
- Mọi thao tác cấp/khóa/reset được xác thực và phân quyền **ở backend**, không tin vai trò do browser gửi.

## Kiểm thử bắt buộc trước khi bật tài khoản thật

- [ ] Kiểm tra snapshot/backup D1 trước migration và khả năng rollback.
- [ ] Thử tài khoản mới: tạo -> bị khóa/chờ reset -> đổi mật khẩu -> đăng nhập thành công.
- [ ] Thử sai mật khẩu, vượt giới hạn, tài khoản không tồn tại, không lộ thông tin tài khoản.
- [ ] Thử Admin không được xác thực, người lạ tạo/khóa/reset tài khoản: phải bị từ chối.
- [ ] Thử khóa hoặc reset khi học viên đã đăng nhập: không được tiếp tục truy cập dữ liệu được bảo vệ.
- [ ] Thử hai trình duyệt cùng học viên nhận đúng dữ liệu; học viên B không đọc/xóa dữ liệu của A.
- [ ] Thử `test_hv_*` và `test_unit_*` vẫn giữ đúng hành vi cũ.
- [ ] Typecheck, kiểm thử backend, Firebase Rules emulator, staging integration và rollback thử.
- [ ] Kiểm tra bảo mật độc lập của mật khẩu/session/rules trước khi sử dụng với dữ liệu thật.

## Bước chuẩn bị tiếp theo

Xác nhận bản sao lưu D1 staging. Sau đó triển khai từng phần backend trên nhánh riêng, có kiểm thử, trước khi sửa giao diện hoặc bật cờ cho pilot. Mọi phát hành ra môi trường chạy phải được duyệt riêng.
