# Phase 5F — Google Admin đọc bảng điểm DEMO trên D1 Preview

Ngày chuẩn bị: 25/11/2026. Bảng này chỉ hiển thị **kết quả toán học giả**.
Không có dữ liệu học viên thật, đề thi thật hay mật khẩu thực.

## Bằng chứng từ người vận hành trước khi tạo giao diện

- Học viên A đã nộp và đọc lại được điểm **10/10**, B nộp và
  đọc lại được điểm **0/10** từ hai trình duyệt khác nhau.
- D1 Preview xác nhận `phase5_attempts=2`,
  `distinct_students=2`, `score_10=1`, `score_0=1`,
  kết quả Phase4 cũ `old_score_10=1` và tổng học viên DEMO `students=3`.
- Ảnh tải lại trang của B hiển thị điểm 0/10 và nút nộp đã khóa.
- Tệp sao lưu trước lượt nộp `d1-preview-before-phase5-submit-20261125.sql`
  đã được người vận hành xác minh `LOCAL_RESTORE_OK`. Dữ liệu từ
  hai lượt nộp mới **không nằm trong bản sao lưu trước đó**;
  nên xuất thêm bản sao lưu mới trước thay đổi lớn kế tiếp.

## Phạm vi PR

- `POST /api/phase5/attempts/admin`, chỉ `action:'list'`.
  Không có INSERT, UPDATE, DELETE hoặc API chỉnh sửa kết quả.
- Phải có đồng thời:
  - **Biến mới mặc định OFF** `PHASE5_ADMIN_RESULTS_ENABLED='true'`
    tại **Preview runtime**; chưa được đặt trong PR;
  - `PHASE5_READONLY_TOPICS_ENABLED='true'`,
    `PHASE4_PREVIEW_HOST_OPT_IN='true'`, đúng hostname staging và
    Firebase project staging; exact Preview alias
    `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`;
  - ID Token **Google Admin** có chữ ký Google chính xác, UID
    bootstrap Admin, provider `google.com` và dự án Firebase staging.
- Đọc `phase5_content_attempts JOIN demo_students` trên
  `AUTH_DB_PREVIEW` nhưng **chỉ chọn** `username,topic_id,revision,
  correct_count,total_count,score_tenths,submitted_at,marker`
  cho `p5_demo_math` revision 1.
- Trả ra các trường `username,topicId,revision,correctCount,totalCount,
  score,maxScore,submittedAt` đã xác minh và không lộ Firebase UID,
  answer keys, đáp án đã chọn, password salt/hash, lời giải, attempt_id.
- Tối đa 100 kết quả và không trả danh sách một phần khi dữ liệu vượt
  giới hạn hoặc có hàng sai định dạng.
- Giao diện `Đã lưu đám mây` của Google Admin có nút
  `Xem bảng điểm Phase 5 từ D1`, xem điểm cùng mã tài khoản DEMO.
  Học viên không thấy nút này.
- Đây là mục tiêu kiểm thử **đồng bộ Admin**; chưa phải hệ thống báo cáo
  điểm lớp hay chế độ thi thật.

## Cách kiểm thử sau khi PR được gộp (chỉ khi được đồng ý)

1. Giữ `PHASE5_ADMIN_RESULTS_ENABLED` **CHƯA ĐẶT/OFF** ngay sau merge.
   Xác minh endpoint vẫn trả HTTP 404 khi gửi POST không token từ
   trình duyệt đã qua Cloudflare Access (không dùng PowerShell curl
   nếu Access đưa tới login 302).
2. Chỉ trên **Preview**, thêm cờ Text
   `PHASE5_ADMIN_RESULTS_ENABLED=true`, Save và redeploy chính
   nhánh Preview. Không sửa Production.
3. Đăng nhập Google Admin staging ở trình duyệt khác, mở
   `Đã lưu đám mây` → `Bảng điểm Phase 5 — Google Admin` → nút
   `Xem bảng điểm Phase 5 từ D1`.
4. Mong đợi **2 bản ghi** của các tài khoản DEMO, điểm 10/10 và 0/10;
   chỉ hiển thị tên thử nghiệm `test_hv_...`, không hiển thị UID,
   password hoặc đáp án.
5. Trên trình duyệt học viên A/B, không thấy bảng điểm Admin.
   Không bao giờ gửi Firebase ID Token hoặc mật khẩu lên chat.
6. Dùng truy vấn SELECT COUNT trên D1 Preview để xác nhận dữ liệu
   Phase5 và Phase4 không thay đổi sau thao tác đọc; không nộp lại bài.

## Những điều chưa làm

- Không gộp `main`, không sửa cơ sở dữ liệu D1, không đổi cờ Cloudflare,
  không tạo hoặc xóa tài khoản, không bật Admin API trong PR này.
- Không ghi dữ liệu hay chấm lại điểm, không thay đổi bài nộp của A/B.
- Không có phân quyền cho giáo viên khác ngoài bootstrap Google Admin
  staging đã xác minh; cần thiết kế riêng trước khi dùng ngoài DEMO.
