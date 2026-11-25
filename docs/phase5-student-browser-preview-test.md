# Phase 5B — kiểm thử học viên đọc chuyên đề giả trên Preview

Ngày chuẩn bị: 25/11/2026. Chỉ dùng dữ liệu giả; tài khoản A/B DEMO đã có.
**Trạng thái:** Chờ PR triển khai vào nhánh thử nghiệm và thử nghiệm thực tế.

## Mục tiêu

Học viên DEMO A và B đăng nhập **Cloudflare Pages Preview** và nhấn nút
`Tải danh sách chuyên đề Phase 5` trong cửa sổ `Đã lưu đám mây`.
Nhấn `Xem câu hỏi từ D1` để tải phiên bản `p5_demo_math` đã xuất bản.
Không nhập UID, password, bearer token hoặc mã xác thực vào chat/console.

Đường dẫn Preview cố định:
`https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`

### Các điều kiện đã biết trước lần triển khai giao diện

- Đã kiểm tra D1 `duongtrcnhiem-auth-preview` có 5 bảng
  `phase5_content_*`, một chuyên đề và 1 câu hỏi đã published.
- `PHASE5_READONLY_TOPICS_ENABLED=true` ở **Preview**; tuyệt đối không
  đổi flag tương tự ở Production.
- Không thay đổi các tài khoản `demo_students` và bài Phase 4;
  kiểm tra đọc chỉ làm `GET`, không có ghi SQL.
- Đã thử trực tiếp `GET /api/phase5/topics` không kèm token, máy
  chủ trả `{"error":"UNAUTHORIZED"}` như mong đợi.

## Trình tự thử trên giao diện (sau khi PR được gộp và Preview Success)

1. Giữ đăng nhập học viên A hiện có, không cần nộp lại bài Phase 4.
   Chỉ tải lại trang Preview nếu cần cập nhật giao diện mới.
2. Vào `Đã lưu đám mây` → `Chuyên đề Phase 5 — đọc trực tiếp từ
   Cloudflare D1` → `Tải danh sách chuyên đề Phase 5`.
3. Mong đợi một chuyên đề `Toán học DEMO`, phiên bản 1, 1 câu hỏi.
   Nhấn `Xem câu hỏi từ D1`.
4. Mong đợi câu `2 + 2 bằng bao nhiêu?`, bốn lựa chọn `3,4,5,6`.
   **Không** có nút chấm/nộp bài; **không** có nhãn đáp án đúng.
5. Dùng trình duyệt khác đang đăng nhập học viên B và làm lại các
   thao tác chỉ đọc, cùng chuyên đề và câu hỏi.
6. Kiểm tra Admin không được trao API học viên qua client; thử truy cập
   URL API không token tiếp tục `UNAUTHORIZED`; không dán token.
7. Nếu gặp `401`, `404`, `503` hoặc lỗi mạng, giữ nguyên trạng thái
   tài khoản, gửi ảnh lỗi **không kèm token**, không tự chạy SQL/seed lại.
8. Đối chiếu số bản ghi D1 Phase 4 và `phase5_content_attempts` vẫn
   không thay đổi sau mọi lần tải nội dung.

## Thiết kế an toàn

- Frontend chỉ hiển thị trên hostname Preview cụ thể và với Firebase
  staging, vai trò học viên và UID khớp tài khoản hiện tại.
- API thực hiện xác minh lại chữ ký Firebase và tài khoản active trong
  `AUTH_DB_PREVIEW`; mọi kiểm tra frontend chỉ hỗ trợ trải nghiệm, không
  có tác dụng cấp quyền máy chủ.
- Browser gọi đúng hai endpoint `GET` không có query, không POST,
  không gửi câu trả lời hoặc điểm, `cache:'no-store'`.
- Firebase `getIdToken()` được dùng ngay trong yêu cầu, không lưu
  token lên `localStorage` mới và không in token ra màn hình.
- Response chỉ được phép chứa danh sách/chuyên đề/câu hỏi theo trường
  đã chọn: không sao chép object JSON nguyên bản trả về vào giao diện.
  Client loại bỏ trường bất thường như `correct_index`, `score`,
  `password_hash` ngay cả khi máy chủ vô tình trả kèm.
- Không tích hợp với `QuizFlow` hiện tại; không nhập chuyên đề thật,
  không chấm điểm Phase5, không thay đổi Production.

## Cổng trước khi gộp

CI `bun run lint`, `bun run build`, các test Phase4/Phase5,
`bun test tests/phase5-browser-readonly.test.ts` và Cloudflare Pages
Preview phải success. Chỉ sau đó mới đề nghị gộp vào nhánh
`feature/staging-demo-quiz-pilot`, không gộp `main`.

Bất kỳ việc đưa bộ đề hoặc hồ sơ học viên nội bộ/thật lên cloud ngoài
đơn vị đều cần phân loại và phê duyệt của người có thẩm quyền.
