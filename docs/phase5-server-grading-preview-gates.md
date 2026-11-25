# Phase 5D — soạn API chấm bài DEMO trên máy chủ (chưa bật)

Ngày: 25/11/2026. Chỉ dùng chuyên đề toán học GIẢ trong nhánh Preview.
**Tình trạng: server-side code + kiểm thử offline, KHÔNG bật API ghi.**

## Chốt kiểm chứng từ người vận hành

- Sau hai trình duyệt A/B đọc cùng chuyên đề `p5_demo_math` từ Cloudflare
  D1 Preview, truy vấn chỉ đọc xác nhận:
  `students=3, old_score_10=1, topics=1, phase5_attempts=0`.
- Database đích duy nhất: `duongtrcnhiem-auth-preview` qua
  `AUTH_DB_PREVIEW` trên hostname
  `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
- Sao lưu SQL độc lập đã được người vận hành xuất, kiểm tra SHA256
  và khôi phục thử trong SQLite RAM trước khi Phase5 schema/seed được áp dụng.
- **Không chạy thêm SQL, không đụng tài khoản/điểm Phase4.**

## Phần API mới

`POST /api/phase5/attempts/student` yêu cầu **đồng thời** các cờ:

- `PHASE5_SYNTHETIC_GRADING_ENABLED=true` — **MỚI, mặc định OFF, chưa bật**.
- `PHASE5_READONLY_TOPICS_ENABLED=true`, `PHASE4_PREVIEW_HOST_OPT_IN=true`.
- `PHASE4_STAGING_HOSTNAME` trùng chính xác alias Preview.
- Staging Firebase auth, chữ ký JWT do Google xác nhận và
  tài khoản DEMO đang active trong D1 Preview.
- Origin cùng website, method POST, content-type JSON, payload nhỏ.

Hiện tại mã frontend **chưa gọi endpoint này**. Không tự tạo biến
`PHASE5_SYNTHETIC_GRADING_ENABLED` trên Cloudflare.
Chỉ tiếp tục bật sau khi có màn hình nộp bài DEMO và kết quả kiểm thử
riêng kèm kế hoạch rollback rõ ràng.

### Giao thức dữ liệu giả (để tích hợp UI ở PR sau)

Bài DEMO cố định `p5_demo_math` revision 1 (dữ liệu published trong D1):

```json
{"action":"submit","topicId":"p5_demo_math","revision":1,
 "answers":{"q1":1}}
```

- Bản 2 câu giả có thể được mô phỏng trong kiểm thử local, nhưng
  dữ liệu Preview hiện chỉ có 1 câu. Dữ liệu thật khác sẽ bị từ chối.
- `answers`: map `question_id -> index 0..3`; không chứa UID, điểm hay
  `correct_index`. Máy chủ tự đọc khóa đáp án trong bảng
  `phase5_content_answer_keys`, tự tính `correct_count` và
  `score_tenths` (0..100), rồi ghi đúng **một lần**.
- Trả điểm `score` theo thang 10, `maxScore=10` và trạng thái.
- `{"action":"result","topicId":"p5_demo_math","revision":1}`
  dùng để xem lại điểm đã lưu của **chính** UID đang đăng nhập, phục vụ
  trường hợp mạng chập chờn. Không có endpoint trả kết quả của UID khác.
- D1 UNIQUE `(student_uid,topic_id,revision)` cùng trigger
  `phase5_attempt_no_update` / `phase5_attempt_no_delete`
  chống ghi đè và sửa kết quả.
- Gửi lại cùng đáp án trả kết quả cũ, `created:false`.
  Gửi đáp án khác trả HTTP 409 `ALREADY_SUBMITTED`, không sửa điểm.
- Không trả đáp án đúng, lời giải, `answers_json` hay UID trong
  phản hồi. Dữ liệu thực tế không được phép sử dụng.

### Giới hạn quan trọng

- API này là **DEMO**, không phải hệ thống thi thật.
- Chưa có cơ chế bắt đầu phiên học có giới hạn thời gian: trường
  `started_at` được ghi bằng cùng timestamp với `submitted_at`
  (không được khẳng định có chống gian lận thời gian).
- Chưa có giao diện nộp bài/khôi phục mất phản hồi; sẽ là PR riêng.
- Chưa có trang Admin xem điểm Phase 5; sẽ là PR riêng.
- Chỉ cho phép `p5_demo_math` revision 1, không có cách nhập bộ đề
  thực hoặc tạo bài trên API.
- Chỉ dùng dữ liệu tổng hợp; tuyệt đối không đưa tài liệu đào tạo nội bộ,
  thông tin quân nhân hoặc điểm thực lên D1/Firebase chưa được phê duyệt.

## Kiểm thử tự động

`node --test tests/phase5-synthetic-grading-http.test.mjs` dùng
SQLite bộ nhớ và JWT giả được ký bằng RSA thử nghiệm. Các ca xác thực:

1. Bài 1 hoặc 2 câu giả, tự chấm 10/10, 5/10, 0/10 phía máy chủ.
2. Đáp án đúng ở bảng riêng, không lộ khóa, UID, lời giải, mã bí mật.
3. Đăng nhập bị khóa, không đăng nhập, sai project/provider, giả JWT.
4. Mặc định OFF, sai hostname, sai Origin, sai kiểu yêu cầu, binding D1
   Preview không tồn tại: không ghi bản ghi.
5. Không thêm bớt câu hoặc tự gửi điểm/UID bằng payload.
6. Gửi lặp không ghi đè, trả 409 cho câu trả lời thay đổi.
7. Không đọc bài của học viên B từ phiên A.
8. Triggers D1 chặn UPDATE và DELETE các lượt nộp đã ghi.
9. Điểm DEMO Phase 4 của A giữ nguyên trong SQLite giả sau các lần nộp.

Những ca này là **mô phỏng offline**, không xác minh runtime ghi
D1 Cloudflare thật. Chỉ khi kiểm thử bổ sung bằng tài khoản DEMO và
môi trường Preview mới được cân nhắc bật cờ ghi.
