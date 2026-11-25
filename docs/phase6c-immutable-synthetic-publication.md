# Giai đoạn 6C — Xuất bản phiên bản đề toán DEMO bất biến (PREVIEW, mặc định OFF)

Ngày 25/11/2026. Base: `feature/staging-demo-quiz-pilot` sau khi PR19 (6B) merge.
**Chỉ phát triển và thử offline. KHÔNG chạy SQL hoặc mở cờ trên Cloudflare.**

## Tại sao cần 6C?

6B giữ các bản nháp (có thể chỉnh sửa). 6C tạo snapshot của **một phiên bản
đã lưu** rồi xuất bản nó trong các bảng Phase5 đã có trigger chặn sửa, gồm:
- `phase5_content_topics`: mã chủ đề `p6_demo_<uuid>`;
- `phase5_content_versions`: revision = số phiên bản draft đã xác minh,
  tên cố định, thời gian 1–240 phút, `state='published'`;
- `phase5_content_questions`: 1–12 câu toán giả và 4 phương án công khai;
- `phase5_content_answer_keys`: đáp án và phần giải thích **chỉ máy chủ**;
- `phase6_admin_publications`: lịch sử revision đã phát hành, không thể UPDATE/DELETE.

Các revision cũ **không được cập nhật**. Khi sửa bản nháp và lưu lần tiếp theo,
có thể xuất một revision mới; số revision tăng theo version đã lưu (có thể
không liên tục nếu chưa phát hành một số version). Việc xóa nháp không xóa
bất kỳ revision đã publish nào. Không có chức năng unpublish/rollback phá
tính bất biến. Nếu phải thu hồi, cần thiết kế cơ chế vô hiệu hóa riêng kèm
phê duyệt/audit, không xóa đáp án hoặc điểm cũ.

Phase5 student GET hiện **chỉ** hiển thị `p5_demo_*`; đề `p6_demo_*`
đã xuất bản **chưa hiện cho học viên**, chưa có phiên thi/nộp bài Phase6D.

## API và xác thực

`POST /api/phase6/admin/publish` chỉ nhận JSON chính xác:

```json
{
  "action": "publish",
  "draftId": "p6_demo_<32 hex do server tạo>",
  "version": 2,
  "confirmation": "PUBLISH_SYNTHETIC_MATH_REVISION"
}
```

Không nhận UID, câu hỏi/đáp án từ client, điểm, token trong JSON, timestamp,
`correctIndex` hoặc nội dung tự do. Admin phải đăng nhập Google Firebase
staging, JWT được xác minh chữ ký RS256, issuer, audience, UID bootstrap,
provider tại máy chủ. Chỉ cho phép hostname Preview pin:
`feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.

**Ba cờ yêu cầu ở máy chủ (đều OFF nếu thiếu):**
`PHASE6_ADMIN_PUBLISH_ENABLED=true`,
`PHASE6_ADMIN_DRAFTS_ENABLED=true`,
`PHASE4_PREVIEW_HOST_OPT_IN=true`, đồng thời
`PHASE4_STAGING_HOSTNAME` đúng alias nói trên.
Bắt buộc `STAGING_AUTH_ENABLED` / Firebase project staging hợp lệ.

**Hai cờ trong bản build UI:**
`VITE_PHASE6_ADMIN_DRAFTS_UI=true` (để có trang 6B) và
`VITE_PHASE6_ADMIN_PUBLISH_UI=true` (để có nút 6C).
Không đặt cờ thì nút không hiện. 6C không tự bật cờ hoặc triển khai migration.

Sử dụng đúng `AUTH_DB_PREVIEW`, không fallback `AUTH_DB`, không
gắn bất kỳ hostname Production nào.

## Giao dịch và khôi phục

- Dữ liệu mô tả/đáp án đi từ **allowlist 4 mẫu toán tĩnh trên server**.
  Phiên bản nháp, mã và danh sách câu được xác nhận lại từ DB.
- `db.batch([...])` là **giao dịch nguyên tử của Cloudflare D1**:
  chỉ một giao dịch chứa topic (nếu chưa có), version ở draft state,
  tất cả câu hỏi, khóa riêng, chuyển trạng thái published và
  metadata xuất bản bất biến.
- Mỗi statement ghi phụ thuộc vào draft ID, version, title, minutes và JSON
  templates **đã xác minh**. Draft bị sửa trên thiết bị khác sẽ không được
  dùng để publish dữ liệu cũ.
- Trigger Phase5 yêu cầu đủ khóa và chặn mọi UPDATE/DELETE sau publication.
  Unique (topicId,revision) ngăn hai lượt phát hành trùng nhau.
- Mất phản hồi/retry cùng ID + version chỉ đọc lại metadata đã publish,
  không tạo revision khác, không trả đáp án đúng.
- Nếu một bước SQL lỗi, toàn bộ batch phải rollback. Bài test dùng SQLite
  in-memory có tiêm lỗi để xác nhận không có dữ liệu một phần.
- HTTP trả nội dung đã cho phép: `topicId,revision,questionCount,
  timeLimitSeconds,publishedAt,status`. Không có khóa đáp án, lời giải,
  câu trả lời của học viên, JWT hoặc dữ liệu tài khoản.

## SQL migration là **bản thiết kế, không phải lệnh thực thi**

`serverless/d1-phase6c-publication-metadata-draft.sql`
chỉ thêm metadata và trigger Phase6C; phụ thuộc schema Phase5 và 6B
đã có trên DB đích. Giai đoạn này **không tự chạy** tệp SQL và không thay
đổi schema hiện hữu. Nếu thiếu bảng, API lỗi an toàn (503), không tạo bảng.

Để thử trực tiếp Cloudflare Preview trong tương lai, cần:
1. Được phê duyệt về phân loại dữ liệu/điều kiện sử dụng Internet; chỉ dùng
   toán giả trước.
2. Xuất **backup D1 Preview mới**, thử khôi phục bản backup này cô lập, kiểm tra
   đúng `duongtrcnhiem-auth-preview` và `AUTH_DB_PREVIEW`.
3. Review và áp dụng lần lượt migration 6B và 6C, xác minh cùng các bảng
   Phase5, tuyệt đối không sửa bảng điểm Phase4/5.
4. Có rate limit, chính sách quyền Admin, rollback vận hành không phá dữ
   liệu đã publish, log tối giản và phê duyệt riêng để bật từng cờ.
5. Test Preview với A/B/Admin/anonymous/locked, hai tab publish cùng lúc,
   mất mạng và ngắt giữa giao dịch, không đưa đề thật lên dịch vụ ngoài.

## Kiểm thử

```sh
node --test tests/phase6c-synthetic-publish-http.test.mjs
bun run lint
bun run build
```

Test hợp đồng HTTP và SQLite RAM gồm: Google Admin/JWT sai, host/cờ/Origin,
publish lần 1 + replay + nhiều thiết bị, revision thứ hai, trigger immutable,
khóa đáp án không ra trình duyệt, SQL rollback, dữ liệu Phase5 A=10/10,
B=0/10 và Phase4 không đổi.

**Không khẳng định Cloudflare D1 thật đã được chỉnh sửa hoặc hoạt động.**
Bước sau là **6D**: phiên thi học viên, kiểm tra time-limit ngay tại
giao dịch ghi điểm server, chống nộp trùng/đua hai thiết bị.
