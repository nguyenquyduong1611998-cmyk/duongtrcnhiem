# Giai đoạn 4C — Checklist triển khai DEMO trên staging (chưa thực hiện)

> **Chỉ là tài liệu bàn giao và diễn tập offline.** Không một lệnh nào trong tài liệu
> này đã được chạy lên Cloudflare D1, Firebase hay website đang hoạt động.
> Không triển khai khi chưa có sự chấp thuận riêng của người quản trị.

## Phạm vi duy nhất cho lần thử

- Cloudflare Pages **staging/preview đã kiểm tra độc lập**, không phải trang chính.
- Firebase **duongtrcnhiem-staging** và D1 **duongtrcnhiem-auth-staging**.
- Chỉ thử tính năng \`PHASE4_SYNTHETIC_QUIZ_ENABLED\`, không mở bất kỳ
  \`PHASE3_*\` nào, không bật đồng bộ học viên thật, không thay đổi Firebase Rules.
- **Một** migration mới: \`serverless/d1-phase4-synthetic-graded-quiz.sql\`.
- Bảng được tạo là \`synthetic_graded_attempts\`; không truy cập/sửa bảng điểm
  \`attempts\` hiện có, không tải đề thi thật hay danh sách học viên thật.

## Cửa kiểm soát trước khi ghi D1

1. GitHub Actions của **commit định triển khai** phải đạt: TypeScript/build,
   \`phase4-synthetic-quiz.test.mjs\`,
   \`phase4-synthetic-quiz-http-e2e.test.mjs\`,
   \`phase4-staging-migration-dry-run.test.mjs\`, Firestore Emulator và kiểm
   tra hồi quy các tính năng đang chạy.
2. **Kiểm tra read-only trên D1 staging** bằng tài khoản có quyền phù hợp:
   xác nhận có \`demo_students\`, \`login_attempts\`, \`unit_accounts\`; đối chiếu
   \`sqlite_master\` và \`PRAGMA table_info\` với schema đã được triển khai
   (không suy ra schema thật chỉ từ file trong GitHub). Xem có tên
   \`synthetic_graded_attempts\`/trigger trùng hay không; nếu có thay đổi
   không dự kiến thì **dừng lại, không chạy migration**.
3. **Sao lưu mới tại thời điểm triển khai**, không dùng mặc định bản
   22/11/2026 làm bản sao lưu hiện tại. Kiểm tra tệp backup đọc được trong
   SQLite riêng, \`PRAGMA integrity_check\`, \`PRAGMA foreign_key_check\`,
   đối chiếu số dòng và mẫu schema. Không đưa backup chứa dữ liệu hay bí mật
   lên GitHub/chat.
4. Xác minh rõ binding \`AUTH_DB\` trỏ đúng staging D1 và Firebase project
   là \`duongtrcnhiem-staging\`; kiểm tra hostname Cloudflare Pages preview
   và chính sách auto-deploy **trước khi push/merge**. Không cấu hình
   Firebase Auth key hoặc secret trong frontend/Vite.
5. Người vận hành phê duyệt rõ việc thử **riêng môi trường staging** và
   kế hoạch xử lý sự cố. Chưa được phê duyệt thì **không tiếp tục**.

## Quy trình triển khai có kiểm soát — chỉ áp dụng sau khi phê duyệt

1. Giữ tính năng OFF, xác nhận bản backup mới nhất; tiến hành migration
   \`serverless/d1-phase4-synthetic-graded-quiz.sql\` vào đúng **staging D1**
   bằng phương thức triển khai đã thẩm định. **Không chạy** các file D1 Phase 3
   hoặc thay đổi Firebase Rules.
2. Kiểm tra read-only: bảng \`synthetic_graded_attempts\` tồn tại, rỗng;
   index và trigger \`synthetic_grade_no_update\` tồn tại, dữ liệu/tổng số dòng
   \`demo_students\`, \`login_attempts\`, \`unit_accounts\` không thay đổi;
   integrity và foreign key check sạch.
3. Triển khai code tương ứng đúng commit trên staging preview đã xác nhận;
   bật duy nhất biến server-only
   \`PHASE4_SYNTHETIC_QUIZ_ENABLED=true\` trên môi trường staging đó.
   Không bật ở \`main\`, production hoặc preview khác.
4. Dùng trình duyệt A đăng nhập tài khoản \`test_hv_*\` DEMO hiện có, mở
   **Kiểm thử Cloud Storage → Bài kiểm tra DEMO**, chọn đáp án và nộp một
   lần. Quan sát điểm do máy chủ trả về; không gửi điểm từ frontend.
5. Trình duyệt B đăng nhập cùng tài khoản DEMO (phiên độc lập) → đọc lại
   kết quả từ D1; dùng một tài khoản DEMO khác kiểm tra **không đọc được**
   điểm của người thứ nhất. Trình duyệt Admin đăng nhập Google staging →
   xem danh sách điểm hai tài khoản.
6. Kiểm tra tài khoản đã khóa không nộp/đọc được, Admin chưa đăng nhập
   không xem được, gửi đáp án lại không thay đổi điểm, và HTTP cache
   \`no-store\`. So sánh D1 với API. Chỉ ghi nhận các **ID giả đã che bớt**,
   không lưu token/mật khẩu/khóa hay dữ liệu thật trong báo cáo.
7. Đánh giá lại backup và quyền truy cập trước khi cân nhắc mở rộng.
   **Không dùng kết quả DEMO như điểm chính thức.**

## Tiêu chí dừng và cách quay về trạng thái an toàn

- Bất cứ lỗi schema, quyền truy cập, tài khoản khác xem được điểm, sai D1
  binding, không thể đọc backup hoặc điểm khác nhau giữa hai trình duyệt
  đều là tín hiệu **DỪNG**.
- **Tắt ngay** \`PHASE4_SYNTHETIC_QUIZ_ENABLED\` trên staging để hai API trả
  404. Nếu cần, trả staging code về commit đã kiểm chứng.
- Không vội \`DROP TABLE\`, xóa dữ liệu hay restore D1 từ backup:
  đó là thao tác hủy dữ liệu, cần kế hoạch và phê duyệt riêng. Migration
  được thiết kế additive; khi tắt cờ, bảng mới có thể để nguyên không dùng.
- Cần đánh giá sau sự cố, sửa mã trên PR Draft và kiểm thử lại trước
  khi bật cờ.

## Những gì bài diễn tập offline *không* chứng minh

- Không phải một cuộc thử trên Cloudflare D1 staging thực tế, không chứng minh
  quyền IAM, hostname, cấu hình Pages hoặc backup 22/11 còn cập nhật.
- 100 tài khoản chỉ là dữ liệu giả trong SQLite, không phải benchmark tải
  100 người dùng đồng thời, không chứng minh độ trễ trên mạng thật.
- Chưa có đăng nhập học viên thật, đề thi chính thức, chấm bài thật, quản lý
  kết quả chính thức, chống gian lận hoặc thu hồi đầy đủ Firebase ID Token.
- Khi cần bàn giao thật, người vận hành phải chấp thuận chính xác môi trường,
  phạm vi migration và cửa sổ triển khai; **không merge PR #2** chỉ để thử một
  endpoint nhỏ.
