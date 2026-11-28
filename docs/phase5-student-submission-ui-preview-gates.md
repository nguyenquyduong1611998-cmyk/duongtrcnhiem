# Phase 5E: giao diện nộp bài DEMO — mặc định tắt

Ngày chuẩn bị: 25/11/2026. **Chỉ dữ liệu toán học giả, chỉ trên Preview.**
Đây là kế hoạch thử nghiệm; chưa có phê duyệt kích hoạt tính năng ghi.

## Đã kiểm chứng trước khi lập trình

Người vận hành kiểm tra từ Cloudflare D1 Preview sau khi học viên A và B
đọc cùng chuyên đề toán học:

- `students=3`, `old_score_10=1`, `topics=1`, `phase5_attempts=0`.
- Học viên A/B đều đọc được chuyên đề `p5_demo_math`, revision 1,
  câu hỏi `2 + 2 bằng bao nhiêu?` từ cùng D1.
- Kết quả DEMO Phase 4 của A 10/10 vẫn nguyên vẹn.
- Không có dữ liệu học viên thật hoặc đề thi thật trong Phase 5.

## Hai lớp khóa độc lập

1. **Giao diện**: chỉ hiện nút chọn/nộp/đọc lại điểm nếu
   `VITE_PHASE5_SYNTHETIC_SUBMIT_UI=true` tại **Preview build**,
   Firebase staging, học viên DEMO UID hợp lệ và hostname đúng chính xác
   `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
   Không có biến này, giao diện chỉ đọc danh sách/câu hỏi y như trước.
2. **Máy chủ**: API POST của PR #13 chỉ hoạt động nếu
   `PHASE5_SYNTHETIC_GRADING_ENABLED=true` trên **Preview runtime**,
   cộng với cờ đọc Phase 5, hostname và Firebase staging. Nếu thiếu,
   trả HTTP 404. Quyền máy chủ dựa trên Firebase JWT được xác minh và
   tài khoản active trong `AUTH_DB_PREVIEW`, không dựa trên giao diện.

**TUYỆT ĐỐI CHƯA BẬT HAI CỜ TRÊN.** Gộp PR này nếu được phép cũng
không tự bật giao diện hay API nộp, không tạo bảng/seed và không ghi D1.

## Luồng sau khi được cho phép kiểm thử riêng

- Sau khi tải danh sách chuyên đề, nhấn `Xem câu hỏi từ D1`.
- Trước khi cho nộp, gọi `action:'result'` để đọc xem học viên đã
  từng nộp `p5_demo_math` revision 1 chưa. Nếu lỗi, **chặn nộp**.
- Chọn một lựa chọn cho *mỗi* câu hỏi (UI có thể dùng nhiều câu trong
  một phiên bản DEMO), không đưa `correct_index` hay score vào trình duyệt.
- Nhấn `Nộp bài Phase 5 — máy chủ tự chấm` **một lần**. Browser chỉ
  gửi map `question_id:answerIndex` và JWT Firebase của phiên học viên.
- Máy chủ mới là nơi đọc bảng đáp án và tính điểm, lưu một bản ghi
  bất biến `phase5_content_attempts` theo UID + topic + revision.
- Nếu mất phản hồi sau POST, client **không tự POST thêm**:
  đọc `action:'result'` duy nhất một lần để đối soát với D1.
  Nếu vẫn không xác nhận được, khóa nút nộp và yêu cầu dùng
  `Đọc lại điểm Phase 5 từ D1`; không tạo điểm giả ở trình duyệt.
- Nếu một thiết bị khác đã nộp, 409 có biên nhận hợp lệ được hiển thị
  như **điểm cũ được giữ nguyên**, không sửa điểm.
- Chỉ 1 chuyên đề giả `p5_demo_math` revision 1 được phép ghi;
  không có API tạo bộ đề thật hoặc kết quả Admin Phase 5 tại đây.

## Điều kiện trước khi bật thử (không thuộc PR này)

1. GitHub CI TypeScript, unit/integration tests về mạng và nộp trùng,
   Cloudflare Pages Preview: tất cả phải `success`.
2. Kiểm chứng endpoint POST 404 khi cờ tắt trên alias Preview;
   không cần/cấm gửi token bí mật vào chat.
3. Xác nhận D1 Preview hiện `phase5_attempts=0`; nếu không,
   điều chỉnh kế hoạch để không ghi đè kết quả, **không xóa học viên**.
4. Xác nhận sao lưu mới của D1 sau các thay đổi Phase 5 (bản sao lưu
   cũ được tạo trước khi có dữ liệu Phase 5 nên không thay thế được nó).
5. Chỉ khi có phê duyệt kích hoạt riêng mới đặt cả hai cờ tại đúng
   **Preview**, triển khai lại Preview, kiểm thử A/B rồi kiểm tra D1.
6. Không bật trên Production và không đưa đề/bảng điểm thật,
   thông tin quân nhân hay nội dung nội bộ lên hạ tầng này.

## Giới hạn

- Đây vẫn là **DEMO**, không phải hệ thống thi thật.
- Chưa có timer phiên thi đáng tin cậy, chưa có Admin xem điểm Phase 5,
  chưa có phê duyệt đưa dữ liệu nội bộ lên internet.
- Bộ dữ liệu Preview hiện chỉ có **một câu hỏi**. Mã client hỗ trợ nhiều
  câu cùng phiên bản nhưng phải được máy chủ xác thực.
