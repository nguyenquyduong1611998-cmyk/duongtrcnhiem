# Giai đoạn 2 — Chuẩn bị đồng bộ dữ liệu thực (KHÔNG triển khai dữ liệu thực lúc này)

**Môi trường:** `duongtrcnhiem-test.pages.dev`, nhánh `fix-firebase-login`, Firebase `duongtrcnhiem-staging`, Cloudflare D1 `duongtrcnhiem-auth-staging`.

## Điều đã được kiểm thử thực tế bằng dữ liệu GIẢ

- Admin staging tạo được tài khoản `test_hv_...` và D1 lưu mã băm, không lưu mật khẩu gốc.
- Học viên đăng nhập trên trình duyệt khác và nhận Firebase UID riêng dạng `student_...`.
- Học viên A ghi, đọc và xóa `demo_result_probes/{uid}` với điểm giả cố định 7/10.
- Cùng học viên A đọc lại được dữ liệu từ trình duyệt khác.
- Học viên B nhận `permission-denied` khi thử đọc và xóa dữ liệu giả của A; sau đó A đọc lại được dữ liệu nguyên vẹn.
- Firebase Rules Emulator chưa được sử dụng để kiểm thử đầy đủ mọi vai trò và mọi truy vấn. Các phép thử này chứng minh hành vi của *collection giả*, không chứng minh tính an toàn của kết quả thi thật.

## Các điểm chặn bắt buộc trước khi mở cho học viên thật

1. **Cơ chế đăng nhập cũ chưa an toàn:** `src/data/defaultData.ts` chứa username/password mặc định; `src/utils/storage.ts` tạo lại tài khoản Admin từ dữ liệu mẫu; `src/App.tsx` vẫn có luồng xác thực mật khẩu phía trình duyệt cho tài khoản cũ. Vai trò `admin` và lịch sử lưu ở localStorage không phải chứng cứ về quyền truy cập. **Không được mở Cloudflare Access công khai khi vẫn còn điểm chặn này.** Đã bổ sung bước chặn UI Admin trên staging: cần Google Admin được Firebase xác nhận để xem và sửa dữ liệu qua trang Quản trị. Biện pháp UI này không thay thế phân quyền máy chủ.
2. **Giữ tên tài khoản/mật khẩu:** Có thể giữ tên đăng nhập hiện có. Giữ nguyên mật khẩu đòi hỏi quản trị viên nhập/đăng ký lại mật khẩu qua giao diện bảo vệ để máy chủ băm tại chỗ; không thể lấy lại mật khẩu gốc từ mã băm an toàn. Các mật khẩu mặc định/yếu hoặc đã xuất hiện trong mã nguồn không thể coi là bí mật và phải thay mới trước khi sử dụng dữ liệu thật.
3. **D1 thực sự xác thực tài khoản:** Thiết kế bảng `unit_accounts` riêng với unique normalized username, random Firebase UID, password hash có version, trạng thái khóa, ngày đổi mật khẩu; chỉ Cloudflare Functions truy cập bằng binding `AUTH_DB`. Không thêm tên thật/mật khẩu vào bảng demo hiện có. Ghi log sự kiện không chứa mật khẩu. Cần IP rate limit, credential-stuffing protections, khả năng thu hồi phiên Firebase khi khóa tài khoản, giới hạn số lần đăng nhập, phòng lộ thông tin qua thông báo lỗi.
4. **Quản trị tài khoản tập trung:** Mọi thao tác thêm/sửa/khóa/đặt lại mật khẩu đi qua endpoint server được xác minh Firebase Admin UID + chữ ký; không cho client tự gán role; không ghi credential hay mã băm vào Firestore công khai.
5. **Bộ đề/chuyên đề:** Hiện frontend đã chứa câu hỏi cùng `correctIndex` và giải thích. Với bài kiểm tra cần chống gian lận, không phân phát đáp án đúng tới trình duyệt trước khi nộp. Phải có nguồn bộ đề chính thức trên máy chủ, xuất bản phiên bản nội dung không chứa khóa đáp án, và hạn chế sửa/xóa theo vai trò Admin.
6. **Điểm thi và lịch sử:** Hiện luồng thi tính điểm phía client; học viên có thể sửa điểm/đáp án nếu client là nguồn tin cậy. Cần endpoint nộp bài trên Cloudflare Functions hoặc môi trường tin cậy khác: xác nhận Firebase ID token, danh tính đã đăng ký và đang hoạt động, đối chiếu câu trả lời với khóa đáp án trên máy chủ, giới hạn thời gian/việc nộp lại và tạo `attempt` bất biến. Firestore Rules chỉ cho chủ UID đọc của mình, Admin chỉ đọc dữ liệu được phân quyền. Không cho học viên tự ghi `score` hoặc `role`.
7. **Dữ liệu và quyền riêng tư:** Bộ dữ liệu mẫu hiện có họ tên, đơn vị và điểm mô phỏng. Không tự động tải bộ dữ liệu localStorage lên cloud. Cần phân loại dữ liệu và sự phê duyệt phù hợp của đơn vị trước khi đưa thông tin cán bộ/học viên hoặc thông tin nội bộ lên hệ thống Internet bên ngoài. Định nghĩa rõ thời hạn lưu, người có quyền xem/xóa, sao lưu và khôi phục.
8. **Cloudflare Access / môi trường:** Hiện Access của website thử nghiệm chỉ cấp quyền cho Admin email. Trước khi học viên thật truy cập, phải cấu hình lại cổng truy cập và phân quyền API phù hợp (hoặc tách giao diện Admin riêng), kèm WAF/rate limit. Cloudflare Access không được xem là thay thế xác thực server.
9. **Kiểm thử:** Firestore Emulator positive/negative tests cho Admin, student A, student B, user disabled, user anonymous và unauthenticated; kiểm thử API chống giả danh/đổi UID/đoán mật khẩu; kiểm thử gián đoạn mạng, đồng bộ trên hai thiết bị, sao lưu, thất bại và phục hồi; review toàn bộ bộ đề và thang điểm.
10. **Triển khai an toàn:** Mọi thay đổi trên `fix-firebase-login` và staging trước; giữ `main`/Firebase production chưa đổi. Có bản sao lưu được xác minh, kế hoạch rollback và chỉ mở dữ liệu thật sau khi mọi kiểm thử bắt buộc đều đạt.

## Lộ trình triển khai theo từng chặng

- **2A — Bảo vệ giao diện Admin trên staging.** Chặn thao tác Quản trị dựa thuần vào localStorage, yêu cầu đã kết nối Google Admin. *Đã viết mã; cần kiểm tra trực tiếp trên trình duyệt.*
- **2B — Bảng và API tài khoản tập trung (tài khoản tổng hợp, không dùng thật).** Tạo/đổi mật khẩu/khóa tài khoản/thu hồi phiên; giữ username bằng cách thay nguồn xác thực client bằng server. Kiểm thử cả đăng nhập đúng/sai và trạng thái khóa.
- **2C — Bộ đề không lộ đáp án và nộp bài được tính điểm trên server.** Chỉ tài khoản đăng ký hợp lệ được nhận đề và gửi bài; kiểm tra tự sửa điểm.
- **2D — Firestore kết quả bất biến và phân quyền đầy đủ.** A thấy lịch sử A, B không thấy A, Admin xem theo quyền; có bảng tổng hợp, đồng bộ đúng trên nhiều thiết bị.
- **2E — Chạy thử tải 30–100 người, quy trình sao lưu/phục hồi, và chỉ sau đó đánh giá đưa dữ liệu thật.**

**Lưu ý bảo mật:** `FIREBASE_PRIVATE_KEY` và các service-account secret chỉ ở Cloudflare Secret, không được xuất vào bundle Vite, GitHub, ảnh chụp hoặc chat. Nếu khóa đã bị lộ, thu hồi và tạo khóa mới ngay.

**Không có tính năng nào trong tài liệu này tự động bật đồng bộ thật.**
