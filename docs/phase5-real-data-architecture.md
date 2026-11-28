# Giai đoạn 5 — kiến trúc đồng bộ chuyên đề và bài kiểm tra (bản thiết kế, chưa triển khai)

Ngày soạn: 25/11/2026. Phạm vi: website Tiểu đoàn 3, thử nghiệm trên nhánh
`feature/staging-demo-quiz-pilot`, Cloudflare Pages, Cloudflare D1 và Firebase staging.

> **TRẠNG THÁI:** Chỉ kiểm tra mã và tạo cấu trúc/bài test trong nhánh riêng.
> Không chạy migration trên D1 Cloudflare, không tạo bảng thật, không nhập dữ
> liệu tài khoản/đề thi thật, không sửa Firestore Rules hoặc Production.
> Nội dung quân sự/nội bộ chỉ được đưa lên dịch vụ Internet sau khi người có thẩm
> quyền xác nhận phân loại và cho phép. Không mặc định coi dữ liệu mẫu là được duyệt.

## I. Kết quả khảo sát chính xác từ mã nguồn hiện tại

| Phần | Tệp nguồn | Hiện trạng/rủi ro |
| --- | --- | --- |
| Đăng nhập DEMO | `functions/api/auth/student/login.js` | Server kiểm tra D1 + ký Firebase custom token; đã thử 2 trình duyệt |
| Chấm 1 câu DEMO | `functions/_shared/synthetic-quiz.mjs` | Cloudflare tự chấm, bảo vệ 1 lượt theo UID; **chỉ** dùng câu hỏi giả cố định |
| Bộ đề/đáp án hiện tại | `src/types.ts`, `src/data/defaultData.ts` | `Topic.questions[]` chứa `correctIndex`, `explanation` trong frontend |
| Bài thi hiện tại | `src/components/QuizFlow.tsx` | Tính `correctCount` và `score10` trong trình duyệt từ `correctIndex` |
| Lưu cục bộ | `src/utils/storage.ts`, `src/App.tsx` | `localStorage` lưu tài khoản, chuyên đề, lịch sử và phiên nội bộ |
| Đồng bộ Firestore cũ | `src/utils/firebaseSync.ts` | Đăng ký `topics/{id}/questions` nhận cả `correctIndex`; không phù hợp bài thi bảo mật |
| Điểm/honor cũ | `src/App.tsx`, `src/utils/firebaseSync.ts` | Staging giữ bài thi bình thường ở máy, không tự đẩy kết quả thực |
| Danh tính/role cũ | `src/data/defaultData.ts` | Có tài khoản/mật khẩu mẫu và role lưu phía client — không dùng cho dữ liệu thật |
| Quyền Firestore | `firestore.staging.rules` | Cho đọc câu hỏi public chứa trường khóa đáp án, chưa có bộ test Emulator đủ mọi vai trò |
| Môi trường | `docs/phase2-real-data-readiness.md` | Đã nêu các cổng an toàn còn thiếu trước khi dùng dữ liệu thật |

## II. Đích kiến trúc (không cần VPS riêng)

1. **Firebase Authentication** cấp ID Token đã ký; Cloudflare Functions tự
   kiểm tra chữ ký RS256, issuer, audience, hạn dùng, provider và UID.
   Cloudflare Access tiếp tục giới hạn ai được vào Preview nhưng không thay
   cho xác minh token trong mỗi endpoint.
2. **D1** là nguồn dữ liệu tập trung cho các phiên bản chuyên đề được duyệt,
   ngân hàng câu hỏi, **bảng đáp án riêng chỉ máy chủ đọc**, và kết quả bất biến.
   Không đưa khóa đáp án vào bundle Vite, Firestore public hoặc HTTP JSON học viên.
3. **Admin** quản lý dự thảo trên endpoint có xác minh Google Admin phía server;
   sau khi phê duyệt, xuất bản phiên bản bất biến. Sửa chuyên đề -> tạo phiên bản mới.
   Chưa có endpoint này; không cho phép dùng role từ `localStorage` để cấp quyền.
4. **Học viên** đăng nhập bằng danh tính đã kiểm tra + tài khoản **đang hoạt động**
   trong D1. Máy chủ trả câu hỏi công khai của đúng phiên bản nhưng không có khóa;
   khi nộp, chỉ gửi các chỉ số đáp án, không gửi điểm hoặc danh tính do client tự khai.
5. **Máy chủ** kiểm tra session/time limit, idempotency, hạn lượt thi và danh sách
   câu hỏi gốc rồi tự chấm; D1 ghi kết quả trong giao dịch/bảo đảm đồng thời.
   Student xem của chính UID, Admin xem theo quyền server. Không phân quyền bằng
   username hoặc `candidateName` từ client.
6. **Giao diện** nhận dữ liệu D1 từ API phiên bản đã xuất bản, lưu cache cục bộ
   tạm thời nếu cần, nhưng không xem cache là nguồn sự thật để kết luận điểm.

### Contract endpoint dự kiến (chưa viết/triển khai)

| API | Xác thực | Trả về / ghi |
| --- | --- | --- |
| `GET /api/v1/topics` | Firebase student hoặc Admin đã kiểm tra | Danh mục chuyên đề được duyệt |
| `GET /api/v1/topics/:id/versions/:v` | Firebase student hoặc Admin đã kiểm tra | Câu hỏi với `id,text,options` **không có** đáp án |
| `POST /api/v1/attempts/start` | Student + active D1 enrollment | `attemptId`, phiên bản cố định, hạn nộp tính bởi máy chủ |
| `POST /api/v1/attempts/submit` | Student + active D1 enrollment | Server xác minh đáp án, chấm và lưu một lần; idempotent |
| `GET /api/v1/attempts/mine` | Student đã xác minh | Chỉ các kết quả thuộc UID token |
| `GET /api/v1/admin/attempts` | Google Admin xác minh | Danh sách có phân trang, audit |

Endpoint chỉ là bản thiết kế. Không tạo đường dẫn công khai hoặc cờ bật tự động
ở giai đoạn này.

## III. Nền tảng bản nháp đã thêm trên nhánh riêng

- `serverless/d1-phase5-content-model-draft.sql`: 5 bảng độc lập với Phase 4:
  `phase5_content_topics`, `phase5_content_versions`,
  `phase5_content_questions`, `phase5_content_answer_keys`,
  `phase5_content_attempts`. Có quan hệ khóa ngoại, revision và các trigger
  chặn sửa nội dung đã xuất bản / chặn sửa kết quả.
- `functions/_shared/phase5-public-content.mjs`: chỉ cho phép xuất
  `id,orderIndex,text,options` từ dữ liệu câu hỏi được xuất bản; không dùng
  spread nguyên row D1 hoặc gửi `correct_index`, `explanation`.
- `tests/phase5-content-model.test.mjs`: mô phỏng SQLite bộ nhớ bằng **câu
  hỏi giả 2+2**, không dùng dữ liệu nội bộ, không kết nối Internet hay D1 thực.
- Cấu trúc chỉ là **mô hình**, chưa có endpoint nhập, xuất bản hoặc làm bài.
  Trigger và thiết kế chỉ là một lớp bảo vệ; vẫn phải kiểm thử truy cập API,
  truy vấn không lộ đáp án, quyền Admin, cạnh tranh nộp và backup.

## IV. Các cổng bắt buộc trước khi sử dụng thật

1. Chỉ sử dụng dữ liệu nội dung/tài khoản đã được **phê duyệt phân loại và
   quyền lưu trữ trên dịch vụ bên ngoài**; kiểm tra không chứa thông tin bí mật
   nội bộ, phương án tác chiến hoặc thông tin cá nhân không được phép.
2. Thay cơ chế Admin/học viên dựa trên client password/localStorage; hoàn thành
   đăng nhập tập trung và khóa/thu hồi phiên cho tài khoản **thật**. Hiện Preview
   chỉ chứng minh DEMO `test_hv_` không chứng minh `unit_accounts` hoạt động.
3. Không dùng `QuizFlow` và `correctIndex` phía client cho chấm thi chính thức.
   Các listener Firestore public nhận `correctIndex` phải được tách khỏi
   những chuyên đề dùng cho kiểm tra có điểm.
4. Chỉ đưa bản chuyên đề đã phê duyệt vào D1 qua Admin API có kiểm tra server,
   bản nháp riêng; không tự nhập từ `localStorage` hoặc `defaultData`.
5. Test chống giả mạo UID, role, ID câu hỏi, đáp án, thời gian, phát lại request,
   hai thiết bị nộp cùng lúc, ngắt mạng, nhận trễ và dữ liệu bị chỉnh sửa.
6. Kiểm thử phân quyền âm tính đầy đủ A/B/Admin/anonymous/locked với D1 API
   và Firestore Emulator; kiểm tra không có đáp án trong browser, cache, bundle.
7. Có backup D1 được khôi phục thử, audit, cơ chế rollback và quyết định lưu
   giữ/xóa dữ liệu, giới hạn truy cập mạng, rate limits và chính sách quyền riêng tư.
8. **Mọi thay đổi chỉ staging**; có bước đánh giá/phê duyệt riêng trước khi
   merge sang main hoặc triển khai Production.

## V. Thứ tự triển khai tiếp theo

- **5A (nhánh này):** rà soát và mô hình hóa phiên bản chuyên đề, khóa đáp án
  server-only, kết quả bất biến; thử trên SQLite bộ nhớ.
- **5B:** xây dựng API **chỉ đọc** danh mục và câu hỏi giả đã publish trên D1
  Preview; kiểm chứng key không bao giờ ra trình duyệt.
- **5C:** Admin publish dữ liệu *giả* theo quyền server và ghi audit.
- **5D:** Student session + nộp bài chấm server, race/idempotency; chỉ staging,
  thử đồng bộ 2 thiết bị trước khi nghĩ tới dữ liệu thật.
- **5E:** hoàn thiện tài khoản và quyền riêng tư, phê duyệt nội dung rồi mới
  nhập một tập dữ liệu được phép vào staging, đánh giá trước production.

**Không chạy** tệp SQL bản nháp này trong Cloudflare Console. GitHub PR ở trạng
thái Draft không có nghĩa backend hay Firestore production đã được cập nhật.

## VI. Giai đoạn 5B — API chỉ đọc chuyên đề giả (nhánh tiếp theo)

**Trạng thái:** PR thử nghiệm, chưa áp dụng tệp SQL vào D1 Cloudflare,
không có dữ liệu chuyên đề 5B trên Cloudflare, **mặc định API trả 404**.
Không thay đổi giao diện hoặc luồng 3 chuyên đề cũ trong `TopicsView`.

- `GET /api/phase5/topics`: trả tối đa 25 chuyên đề **đã publish**
  có mã kỹ thuật bắt đầu bằng `p5_demo_`, chỉ revision published mới nhất.
- `GET /api/phase5/topics/{topicId}/versions/{revision}`: trả
  `topicId,revision,code,title,description,timeLimitSeconds,questions`
  và `questions[].{id,orderIndex,text,options}`.
  Không trả `correct_index`, `correctIndex`, `explanation`,
  khóa đáp án, điểm, tài khoản hoặc dữ liệu thi thật.
- Hai GET đều yêu cầu **Firebase ID Token đã xác minh chữ ký** và UID
  `student_...` có `demo_students.active=1` trong **AUTH_DB_PREVIEW**.
  Không dùng vai trò/quyền do client tự cung cấp.
- Chỉ dùng exact hostname
  `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`,
  `PHASE4_STAGING_HOSTNAME` phải trỏ đến tên này và
  `PHASE4_PREVIEW_HOST_OPT_IN=true`.
  Biến kích hoạt mới là `PHASE5_READONLY_TOPICS_ENABLED=true`
  ở môi trường Preview **sau khi** hoàn tất quy trình được phê duyệt.
  Mặc định `PHASE5_READONLY_TOPICS_ENABLED` **không có** hoặc `false`:
  API trả 404. Không bao giờ bật trên Production.
- `AUTH_DB_PREVIEW` là binding được lấy từ hostname thật trong Request URL.
  Không dùng `AUTH_DB` dự phòng trên bất kỳ Preview khác.
- API **chỉ dùng SELECT**, không ghi bảng/đổi mật khẩu,
  không tự tạo migration, không nhập dữ liệu từ `defaultData` hoặc
  `localStorage`. Thiếu bảng Phase5: trả lỗi tối giản 503, không tự tạo.
  `Cache-Control: no-store` ngăn cache nội dung qua trình duyệt/CDN.
- Không triển khai UI mới cho người dùng thật hoặc cấp phép mở rộng quyền
  truy cập học viên chỉ vì có API thử nghiệm.

### Kiểm thử

`tests/phase5-readonly-topics-http.test.mjs` dùng SQLite in-memory và
Firebase RSA tự tạo cho thử nghiệm. Những trường hợp được kiểm:
A và B đọc phiên bản publish, draft bị ẩn, namespace khác bị từ chối,
JWT sai/thiếu hoặc UID khóa bị 401, endpoint mặc định 404, chỉ host Preview
được phép, DB khác không được truy cập, thiếu bảng 503, không có câu SQL
ghi hoặc đọc bảng `phase5_content_answer_keys`. Không truy cập network thật.

### Điều kiện cho phép tiến tới Preview có dữ liệu giả

1. Review PR và đợi CI test/build thành công.
2. Backup và **xác minh khôi phục** D1 Preview nếu sau này quyết định tạo
   bảng thật; không dùng `Time Travel` thay cho thử khôi phục.
3. Review bản SQL Phase5A và thiết kế migration riêng dành cho D1 Preview;
   phải duyệt trước khi chạy, không dán SQL bản nháp vào Production.
4. Tạo duy nhất nội dung giả 2+2 ở namespace `p5_demo_` sau khi được duyệt.
   Không lấy câu hỏi thật từ các chuyên đề nội bộ.
5. Khi bật cờ chỉ-Preview, kiểm thử rằng GET trả câu hỏi nhưng không trả khóa,
   tài khoản bị khóa bị từ chối, và không làm hỏng Phase4.
6. Chỉ sau kiểm thử quyền sâu hơn mới bắt đầu thiết kế Endpoint Admin và chấm
   điểm nhiều câu ở giai đoạn 5C/5D.

**Lưu ý:** Không bao giờ nhập dữ liệu quân sự nhạy cảm, phương án hoặc hồ sơ
học viên thật lên Internet/cloud bên ngoài nếu chưa được người có thẩm quyền
phê duyệt phân loại và xử lý dữ liệu.
